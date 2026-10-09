import type { DatabaseSync } from 'node:sqlite';

import { changeStatus, createLaptop, isLaptopStatus, type LaptopStatus } from '../src/index.js';
import { inTransaction, resetDatabase } from './db.js';
import {
  httpStatusFor,
  toAttemptDto,
  toLaptopDto,
  type BoardDto,
} from './dto.js';
import { randomModelName } from './catalog.js';
import {
  applyTransition,
  getLaptop,
  insertLaptop,
  listAttempts,
  listLaptops,
  nextLaptopId,
  recordAttempt,
} from './repository.js';
import { buildSeed } from './seed.js';

/**
 * Обработчики запросов.
 *
 * Решать, можно переход или нет, — дело **домена**. Того же модуля, что
 * крутиться в браузере и покрыт тестами. Тут только три вещи: разобрать
 * запрос, сохранить результат, перевести ответ в код HTTP.
 */

// Ответ обработчика, пока его не записали в сокет.
export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

function readBoard(db: DatabaseSync): BoardDto {
  return {
    laptops: listLaptops(db).map(toLaptopDto),
    attempts: listAttempts(db).map(toAttemptDto),
  };
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

  // Клиент может задать «сейчас». Это поблажка демо: окно возврата иначе
  // не показать. В настоящей системе сервер брать только свои часы —
  // времени клиента верить нельзя.
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

// DTO и таблица кодов лежать в dto.ts. Реэкспорт — чтобы вход был один.
export { httpStatusFor } from './dto.js';
export type { AttemptDto, BoardDto, LaptopDto, StatusChangeDto } from './dto.js';

// --- Обработчики ---

/**
 * «Я жив?» для платформы.
 *
 * Делать пустяковый запрос в базу, а не просто отвечать 200. Сервис, который
 * кричать «жив» при мёртвой базе, вреднее молчащего: балансировщик продолжить
 * слать на него трафик.
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

  // Решать домен. Сервер не перепроверять и не дополнять.
  const decision = changeStatus(record.laptop, to, { now });

  if (!decision.ok) {
    // Отказ тоже писать в аудит — он в журнале самое интересное.
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
      // Доску вернуть и при отказе: клиент остаться в синхроне без второго запроса.
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
 * Добавить ноутбук.
 *
 * Статус тут не выбирать: его ставить домен через `createLaptop()`.
 * Сервер приносить только то, чего домен не знать: номер и название.
 */
export function postLaptop(
  db: DatabaseSync,
  random: () => number = Math.random,
): ApiResponse {
  const created = inTransaction(db, () => {
    // Номер и вставка в одной транзакции: иначе два нажатия подряд
    // получить один и тот же номер.
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

/** Наполнить пустую базу. Ноутбуки уже есть — ничего не делать. */
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
