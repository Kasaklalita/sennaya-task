import { isLaptopStatus, type LaptopStatus } from '../src/index.js';

/**
 * Читать строки из БД безопасно.
 *
 * Строка из базы — такой же чужой данные, как JSON из запроса. SQLite типизирован
 * динамически: в колонке TEXT лежать BLOB, в INTEGER — строка. Тут каждое
 * значение проверять и превращать в доменный тип либо честно ронять запрос.
 *
 * Падать громко важнее, чем отдать «что-то»: NaN-дата, проскочившая в автомат,
 * молча разрешить возврат — `NaN > срок` дать `false`.
 */

/** Битые данные в хранилище — это не ошибка человека, а сбой. */
export class CorruptRowError extends Error {
  constructor(column: string, value: unknown) {
    super(`Повреждённые данные в БД: ${column} = ${JSON.stringify(value) ?? String(value)}`);
    this.name = 'CorruptRowError';
  }
}

/** Строка из запроса, ещё не проверенная. */
export type Row = Record<string, unknown>;

/** Статус из БД проверять тем же guard'ом, что и значение из JSON. */
export function readStatus(value: unknown, column: string): LaptopStatus {
  if (!isLaptopStatus(value)) {
    throw new CorruptRowError(column, value);
  }
  return value;
}

export function readDate(value: unknown, column: string): Date {
  if (typeof value !== 'string') {
    throw new CorruptRowError(column, value);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CorruptRowError(column, value);
  }
  return date;
}

export function readText(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new CorruptRowError(column, value);
  }
  return value;
}

export function readInteger(value: unknown, column: string): number {
  if (typeof value === 'number') {
    return value;
  }
  // node:sqlite отдавать BIGINT для больших чисел.
  if (typeof value === 'bigint') {
    return Number(value);
  }
  throw new CorruptRowError(column, value);
}

/** Дата в формате, который понимать и SQLite, и readDate. */
export function toIso(date: Date): string {
  return date.toISOString();
}
