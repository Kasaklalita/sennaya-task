import type { DatabaseSync } from 'node:sqlite';

import {
  createLaptop,
  type Laptop,
  type LaptopStatus,
  type StatusChange,
  type TransitionErrorCode,
} from '../src/index.js';
import {
  readDate,
  readInteger,
  readStatus,
  readText,
  toIso,
  type Row,
} from './rows.js';

/**
 * Хранение: одно место, где агрегат превращаться в строки таблиц и обратно.
 *
 * Домен про SQL не знать ничего: ни импорта node:sqlite, ни одного запроса.
 * Обратно тоже: тут нет ни одного правила переходов. Репозиторий уметь две
 * вещи — «прочитать ноутбук» и «записать уже принятое решение».
 */

/**
 * Агрегат плюс то, что домену не нужно.
 *
 * `model` — из каталога, `version` — для блокировки. В `Laptop` они не лезут:
 * иначе в домен протащить заботы хранилища и каталога.
 */
export interface LaptopRecord {
  readonly laptop: Laptop;
  readonly model: string;
  readonly version: number;
}

export interface AttemptRecord {
  readonly id: number;
  readonly laptopId: string;
  readonly from: LaptopStatus;
  readonly to: LaptopStatus;
  readonly ok: boolean;
  readonly errorCode: TransitionErrorCode | null;
  readonly message: string;
  /** «Сейчас», с которым считать домен. */
  readonly modelNow: Date;
  /** Реальный момент записи. */
  readonly createdAt: Date;
}

/**
 * Собрать агрегат из строк.
 *
 * История читать по `id`, то есть в порядке записи. Так можно, потому что
 * домен требовать хронологию (запись задним числом дать INVALID_DATE) —
 * значит порядок записи и порядок по датам совпадать.
 */
function toRecord(laptopRow: Row, historyRows: readonly Row[]): LaptopRecord {
  const history: StatusChange[] = historyRows.map((row) => ({
    from: readStatus(row['from_status'], 'status_history.from_status'),
    to: readStatus(row['to_status'], 'status_history.to_status'),
    at: readDate(row['changed_at'], 'status_history.changed_at'),
  }));

  const soldAtRaw = laptopRow['sold_at'];

  return {
    // Через конструктор домена, не литералом: он заморозить объект и
    // скопировать даты. Агрегат из БД получить те же гарантии, что из кода.
    laptop: createLaptop({
      id: readText(laptopRow['id'], 'laptops.id'),
      status: readStatus(laptopRow['status'], 'laptops.status'),
      history,
      ...(soldAtRaw === null || soldAtRaw === undefined
        ? {}
        : { soldAt: readDate(soldAtRaw, 'laptops.sold_at') }),
    }),
    model: readText(laptopRow['model'], 'laptops.model'),
    version: readInteger(laptopRow['version'], 'laptops.version'),
  };
}

export function listLaptops(db: DatabaseSync): readonly LaptopRecord[] {
  const laptopRows = db.prepare('SELECT * FROM laptops ORDER BY created_at, id').all() as Row[];
  const historyRows = db
    .prepare('SELECT * FROM status_history ORDER BY laptop_id, id')
    .all() as Row[];

  const historyByLaptop = new Map<string, Row[]>();
  for (const row of historyRows) {
    const laptopId = readText(row['laptop_id'], 'status_history.laptop_id');
    const bucket = historyByLaptop.get(laptopId);
    if (bucket === undefined) {
      historyByLaptop.set(laptopId, [row]);
    } else {
      bucket.push(row);
    }
  }

  return laptopRows.map((row) =>
    toRecord(row, historyByLaptop.get(readText(row['id'], 'laptops.id')) ?? []),
  );
}

export function getLaptop(db: DatabaseSync, id: string): LaptopRecord | undefined {
  const laptopRow = db.prepare('SELECT * FROM laptops WHERE id = ?').get(id) as Row | undefined;
  if (laptopRow === undefined) {
    return undefined;
  }

  const historyRows = db
    .prepare('SELECT * FROM status_history WHERE laptop_id = ? ORDER BY id')
    .all(id) as Row[];

  return toRecord(laptopRow, historyRows);
}

/**
 * Следующий свободный номер вида `nb-007`.
 *
 * Считать `MAX(…) + 1` по ЧИСЛУ, не по строке: иначе `nb-010` оказаться
 * «меньше» `nb-009`. Звать внутри той же транзакции, что и вставку — тогда
 * два одновременных добавления не получить один номер.
 */
export function nextLaptopId(db: DatabaseSync): string {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INTEGER)), 0) + 1 AS next
       FROM laptops
       WHERE id GLOB 'nb-[0-9]*'`,
    )
    .get() as Row | undefined;

  const next = row === undefined ? 1 : readInteger(row['next'], 'laptops.next_id');
  return `nb-${String(next).padStart(3, '0')}`;
}

export function insertLaptop(
  db: DatabaseSync,
  record: { readonly laptop: Laptop; readonly model: string },
): void {
  db.prepare('INSERT INTO laptops (id, model, status, sold_at, version) VALUES (?, ?, ?, ?, 1)').run(
    record.laptop.id,
    record.model,
    record.laptop.status,
    record.laptop.soldAt === undefined ? null : toIso(record.laptop.soldAt),
  );

  const insertChange = db.prepare(
    'INSERT INTO status_history (laptop_id, from_status, to_status, changed_at) VALUES (?, ?, ?, ?)',
  );
  for (const change of record.laptop.history) {
    insertChange.run(record.laptop.id, change.from, change.to, toIso(change.at));
  }
}

/**
 * Записать решение, которое домен уже принял.
 *
 * `version = ?` — оптимистическая блокировка. Если между чтением и записью
 * ноутбук успела поменять другая вкладка, UPDATE не тронуть ни строки и
 * функция вернуть `false`. Без этого чужое изменение молча пропасть.
 *
 * Звать строго в транзакции: статус и журнал попасть в базу вместе.
 */
export function applyTransition(
  db: DatabaseSync,
  params: {
    readonly id: string;
    readonly expectedVersion: number;
    readonly next: Laptop;
    readonly change: StatusChange;
  },
): boolean {
  const updated = db
    .prepare('UPDATE laptops SET status = ?, sold_at = ?, version = version + 1 WHERE id = ? AND version = ?')
    .run(
      params.next.status,
      params.next.soldAt === undefined ? null : toIso(params.next.soldAt),
      params.id,
      params.expectedVersion,
    );

  if (updated.changes === 0) {
    return false;
  }

  db.prepare(
    'INSERT INTO status_history (laptop_id, from_status, to_status, changed_at) VALUES (?, ?, ?, ?)',
  ).run(params.id, params.change.from, params.change.to, toIso(params.change.at));

  return true;
}

export function recordAttempt(
  db: DatabaseSync,
  entry: {
    readonly laptopId: string;
    readonly from: LaptopStatus;
    readonly to: LaptopStatus;
    readonly ok: boolean;
    readonly errorCode: TransitionErrorCode | null;
    readonly message: string;
    readonly modelNow: Date;
  },
): void {
  db.prepare(
    `INSERT INTO transition_attempts
       (laptop_id, from_status, to_status, ok, error_code, message, model_now)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.laptopId,
    entry.from,
    entry.to,
    entry.ok ? 1 : 0,
    entry.errorCode,
    entry.message,
    toIso(entry.modelNow),
  );
}

/** Сколько всего попыток лежать в базе. Нужно, чтобы листание знало свой размер. */
export function countAttempts(db: DatabaseSync): number {
  const row = db.prepare('SELECT count(*) AS total FROM transition_attempts').get() as
    | Row
    | undefined;
  return row === undefined ? 0 : readInteger(row['total'], 'transition_attempts.total');
}

/**
 * Страница журнала попыток, новые сверху.
 *
 * Отдавать страницу, а не «последние сто»: сто — это молчаливое обрезание.
 * Записи сто первая и дальше просто пропадать, и никто об этом не узнать.
 */
export function listAttempts(
  db: DatabaseSync,
  page: { readonly limit?: number; readonly offset?: number } = {},
): readonly AttemptRecord[] {
  const rows = db
    .prepare('SELECT * FROM transition_attempts ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(page.limit ?? 20, page.offset ?? 0) as Row[];

  return rows.map((row) => {
    const errorCode = row['error_code'];
    return {
      id: readInteger(row['id'], 'transition_attempts.id'),
      laptopId: readText(row['laptop_id'], 'transition_attempts.laptop_id'),
      from: readStatus(row['from_status'], 'transition_attempts.from_status'),
      to: readStatus(row['to_status'], 'transition_attempts.to_status'),
      ok: readInteger(row['ok'], 'transition_attempts.ok') === 1,
      errorCode:
        errorCode === null || errorCode === undefined
          ? null
          : (readText(errorCode, 'transition_attempts.error_code') as TransitionErrorCode),
      message: readText(row['message'], 'transition_attempts.message'),
      modelNow: readDate(row['model_now'], 'transition_attempts.model_now'),
      createdAt: readDate(row['created_at'], 'transition_attempts.created_at'),
    };
  });
}
