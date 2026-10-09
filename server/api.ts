import type { DatabaseSync } from 'node:sqlite';

import {
  changeStatus,
  createLaptop,
  isLaptopStatus,
  type LaptopStatus,
  type TransitionError,
  type TransitionErrorCode,
} from '../src/index.js';
import { inTransaction, resetDatabase } from './db.js';
import { randomModelName } from './catalog.js';
import {
  applyTransition,
  getLaptop,
  insertLaptop,
  listAttempts,
  listLaptops,
  nextLaptopId,
  recordAttempt,
  type AttemptRecord,
  type LaptopRecord,
} from './repository.js';
import { buildSeed } from './seed.js';

/**
 * HTTP-слой.
 *
 * Решение о том, можно ли переход, принимает **домен** — тот же модуль, что
 * работает в браузере и покрыт тестами. Здесь только три вещи: разобрать запрос,
 * сохранить результат и перевести ответ домена в код HTTP.
 */

// --- DTO: то, что уходит по сети. Даты — строки ISO-8601 ---

export interface StatusChangeDto {
  readonly from: LaptopStatus;
  readonly to: LaptopStatus;
  readonly at: string;
}

export interface LaptopDto {
  readonly id: string;
  readonly model: string;
  readonly status: LaptopStatus;
  readonly version: number;
  readonly soldAt: string | null;
  readonly history: readonly StatusChangeDto[];
}

export interface AttemptDto {
  readonly id: number;
  readonly laptopId: string;
  readonly from: LaptopStatus;
  readonly to: LaptopStatus;
  readonly ok: boolean;
  readonly errorCode: TransitionErrorCode | null;
  readonly message: string;
  readonly modelNow: string;
  readonly createdAt: string;
}

export interface BoardDto {
  readonly laptops: readonly LaptopDto[];
  readonly attempts: readonly AttemptDto[];
}

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

function toLaptopDto(record: LaptopRecord): LaptopDto {
  return {
    id: record.laptop.id,
    model: record.model,
    status: record.laptop.status,
    version: record.version,
    soldAt: record.laptop.soldAt === undefined ? null : record.laptop.soldAt.toISOString(),
    history: record.laptop.history.map((change) => ({
      from: change.from,
      to: change.to,
      at: change.at.toISOString(),
    })),
  };
}

function toAttemptDto(record: AttemptRecord): AttemptDto {
  return {
    ...record,
    modelNow: record.modelNow.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

function readBoard(db: DatabaseSync): BoardDto {
  return {
    laptops: listLaptops(db).map(toLaptopDto),
    attempts: listAttempts(db).map(toAttemptDto),
  };
}

/**
 * Код домена → код HTTP.
 *
 * `satisfies Record<TransitionErrorCode, number>` делает таблицу исчерпывающей:
 * новый код ошибки в домене сломает сборку здесь, а не тихо уедет в 500.
 *
 * 409 — нарушение бизнес-правила: запрос понятен и данные корректны, но
 * состояние ресурса его не допускает. 400 — испорченный ввод. 422 — данных
 * не хватает, чтобы правило вообще можно было проверить.
 */
const HTTP_STATUS_BY_ERROR_CODE = {
  UNKNOWN_STATUS: 400,
  INVALID_DATE: 400,
  SAME_STATUS: 409,
  TERMINAL_STATUS: 409,
  TRANSITION_NOT_ALLOWED: 409,
  RETURN_WINDOW_EXPIRED: 409,
  SALE_DATE_UNKNOWN: 422,
} as const satisfies Record<TransitionErrorCode, number>;

export function httpStatusFor(error: TransitionError): number {
  return HTTP_STATUS_BY_ERROR_CODE[error.code];
}

// --- Разбор запроса ---

interface TransitionRequest {
  readonly to: LaptopStatus;
  readonly now: Date;
  readonly expectedVersion: number | null;
}

type ParseResult =
  | { readonly ok: true; readonly value: TransitionRequest }
  | { readonly ok: false; readonly message: string };

function parseTransitionRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'Тело запроса должно быть JSON-объектом.' };
  }

  const raw = body as Record<string, unknown>;

  if (!isLaptopStatus(raw['to'])) {
    return {
      ok: false,
      message: `Поле "to" должно быть одним из допустимых статусов, получено ${JSON.stringify(raw['to']) ?? 'undefined'}.`,
    };
  }

  // Клиент может задать «сейчас» — это осознанная поблажка демонстрации:
  // окно возврата иначе не показать. В реальной системе сервер использовал бы
  // только свои часы, потому что клиентскому времени доверять нельзя.
  const rawNow = raw['now'];
  let now = new Date();
  if (rawNow !== undefined && rawNow !== null) {
    if (typeof rawNow !== 'string') {
      return { ok: false, message: 'Поле "now" должно быть строкой ISO-8601.' };
    }
    now = new Date(rawNow);
    if (Number.isNaN(now.getTime())) {
      return { ok: false, message: `Поле "now" не является корректной датой: "${rawNow}".` };
    }
  }

  const rawVersion = raw['expectedVersion'];
  if (rawVersion !== undefined && rawVersion !== null && !Number.isInteger(rawVersion)) {
    return { ok: false, message: 'Поле "expectedVersion" должно быть целым числом.' };
  }

  return {
    ok: true,
    value: {
      to: raw['to'],
      now,
      expectedVersion: typeof rawVersion === 'number' ? rawVersion : null,
    },
  };
}

// --- Обработчики ---

/**
 * Проверка живости для платформы.
 *
 * Делает тривиальный запрос к базе, а не просто возвращает 200: сервис,
 * который отвечает «жив» при недоступной базе, бесполезен — балансировщик
 * продолжит слать на него трафик.
 */
export function getHealth(db: DatabaseSync): ApiResponse {
  try {
    db.prepare('SELECT 1').get();
    return { status: 200, body: { ok: true } };
  } catch (error) {
    return {
      status: 503,
      body: {
        ok: false,
        error: { code: 'DB_UNAVAILABLE', message: error instanceof Error ? error.message : '' },
      },
    };
  }
}

export function getBoard(db: DatabaseSync): ApiResponse {
  return { status: 200, body: readBoard(db) };
}

export function postTransition(db: DatabaseSync, laptopId: string, body: unknown): ApiResponse {
  const parsed = parseTransitionRequest(body);
  if (!parsed.ok) {
    return {
      status: 400,
      body: { error: { code: 'BAD_REQUEST', message: parsed.message } },
    };
  }

  const { to, now, expectedVersion } = parsed.value;

  const record = getLaptop(db, laptopId);
  if (record === undefined) {
    return {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: `Ноутбук "${laptopId}" не найден.` } },
    };
  }

  // Решение принимает домен. Сервер его не перепроверяет и не дополняет.
  const decision = changeStatus(record.laptop, to, { now });

  if (!decision.ok) {
    // Отказ тоже пишется в аудит — это самое интересное в журнале попыток.
    inTransaction(db, () => {
      recordAttempt(db, {
        laptopId,
        from: record.laptop.status,
        to,
        ok: false,
        errorCode: decision.error.code,
        message: decision.error.message,
        modelNow: now,
      });
    });

    return {
      status: httpStatusFor(decision.error),
      // Доска возвращается и при отказе: клиент остаётся в синхронном состоянии,
      // не делая второй запрос.
      body: { error: decision.error, board: readBoard(db) },
    };
  }

  const change = decision.value.history.at(-1);
  if (change === undefined) {
    throw new Error('Домен вернул успех без записи в журнале — это невозможно');
  }

  const applied = inTransaction(db, () => {
    const ok = applyTransition(db, {
      id: laptopId,
      expectedVersion: expectedVersion ?? record.version,
      next: decision.value,
      change,
    });

    if (ok) {
      recordAttempt(db, {
        laptopId,
        from: record.laptop.status,
        to,
        ok: true,
        errorCode: null,
        message: 'Переход выполнен, запись добавлена в историю',
        modelNow: now,
      });
    }

    return ok;
  });

  if (!applied) {
    return {
      status: 409,
      body: {
        error: {
          code: 'VERSION_CONFLICT',
          message:
            'Ноутбук успели изменить в другом месте, пока вы смотрели на старое состояние. ' +
            'Доска обновлена — повторите действие.',
        },
        board: readBoard(db),
      },
    };
  }

  return { status: 200, body: { board: readBoard(db) } };
}

/**
 * Добавляет новый ноутбук.
 *
 * Статус не выбирается здесь: его задаёт домен через `createLaptop()`, который
 * по умолчанию ставит {@link INITIAL_STATUS}. Сервер приносит только то, чего
 * домен не знает, — идентификатор и название модели.
 */
export function postLaptop(
  db: DatabaseSync,
  random: () => number = Math.random,
): ApiResponse {
  const created = inTransaction(db, () => {
    // Номер и вставка — в одной транзакции, иначе два одновременных
    // добавления могли бы получить одинаковый идентификатор.
    const id = nextLaptopId(db);
    const laptop = createLaptop({ id });
    insertLaptop(db, { laptop, model: randomModelName(random) });
    return id;
  });

  return { status: 201, body: { createdId: created, board: readBoard(db) } };
}

export function postReset(db: DatabaseSync, now: Date = new Date()): ApiResponse {
  resetDatabase(db);
  seedDatabase(db, now);
  return { status: 200, body: { board: readBoard(db) } };
}

/** Наполняет пустую базу. Если ноутбуки уже есть — ничего не делает. */
export function seedDatabase(db: DatabaseSync, now: Date = new Date()): void {
  const existing = db.prepare('SELECT count(*) AS count FROM laptops').get() as
    | { count: number }
    | undefined;

  if (existing !== undefined && existing.count > 0) {
    return;
  }

  inTransaction(db, () => {
    for (const entry of buildSeed(now)) {
      insertLaptop(db, entry);
    }
  });
}
