import type { DatabaseSync } from 'node:sqlite';

import {
  createLaptop,
  isLaptopStatus,
  type Laptop,
  type LaptopStatus,
  type StatusChange,
  type TransitionErrorCode,
} from '../src/index.js';

/**
 * Слой хранения: единственное место, где доменный агрегат превращается в строки
 * таблиц и обратно.
 *
 * Домен про SQL не знает ничего — он не импортирует `node:sqlite` и не содержит
 * ни одного запроса. Обратное тоже верно: здесь нет ни одного правила переходов.
 * Репозиторий умеет только «прочитать ноутбук» и «записать уже принятое решение».
 */

/**
 * Агрегат вместе с данными, которые домену не нужны.
 *
 * `model` — каталожное название, `version` — служебное поле оптимистической
 * блокировки. Ни то, ни другое не попадает в `Laptop`: добавить их в домен
 * значило бы протащить в него заботы хранилища и каталога.
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
  /** «Сейчас», с которым считал домен. */
  readonly modelNow: Date;
  /** Реальный момент записи. */
  readonly createdAt: Date;
}

/** Повреждение данных в хранилище — это не ошибка пользователя, а сбой. */
class CorruptRowError extends Error {
  constructor(column: string, value: unknown) {
    super(`Повреждённые данные в БД: ${column} = ${JSON.stringify(value) ?? String(value)}`);
    this.name = 'CorruptRowError';
  }
}

/** Статус из БД — такое же недоверенное значение, как из JSON. Проверяем доменным guard'ом. */
function readStatus(value: unknown, column: string): LaptopStatus {
  if (!isLaptopStatus(value)) {
    throw new CorruptRowError(column, value);
  }
  return value;
}

function readDate(value: unknown, column: string): Date {
  if (typeof value !== 'string') {
    throw new CorruptRowError(column, value);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CorruptRowError(column, value);
  }
  return date;
}

function readText(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new CorruptRowError(column, value);
  }
  return value;
}

function readInteger(value: unknown, column: string): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  throw new CorruptRowError(column, value);
}

function toIso(date: Date): string {
  return date.toISOString();
}

type Row = Record<string, unknown>;

/**
 * Собирает агрегат из строк.
 *
 * История читается в порядке `id`, то есть в порядке записи. Это согласовано
 * с доменом: он требует хронологический журнал (переход «задним числом»
 * возвращает INVALID_DATE), поэтому порядок записи и порядок по датам совпадают.
 */
function toRecord(laptopRow: Row, historyRows: readonly Row[]): LaptopRecord {
  const history: StatusChange[] = historyRows.map((row) => ({
    from: readStatus(row['from_status'], 'status_history.from_status'),
    to: readStatus(row['to_status'], 'status_history.to_status'),
    at: readDate(row['changed_at'], 'status_history.changed_at'),
  }));

  const soldAtRaw = laptopRow['sold_at'];

  return {
    // Через конструктор домена, а не литералом: он заморозит объект и скопирует
    // даты — агрегат из БД получает ровно те же гарантии, что созданный в коде.
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
 * Записывает уже принятое доменом решение.
 *
 * Условие `version = ?` — оптимистическая блокировка: если между чтением
 * и записью ноутбук успела изменить другая вкладка, UPDATE не затронет
 * ни одной строки и функция вернёт `false`. Без этого изменение соседа
 * молча потерялось бы.
 *
 * Вызывать строго внутри транзакции: смена статуса и запись в журнал
 * должны попасть в базу вместе.
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

export function listAttempts(db: DatabaseSync, limit = 100): readonly AttemptRecord[] {
  const rows = db
    .prepare('SELECT * FROM transition_attempts ORDER BY id DESC LIMIT ?')
    .all(limit) as Row[];

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
