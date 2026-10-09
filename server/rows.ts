import { isLaptopStatus, type LaptopStatus } from '../src/index.js';

/**
 * Безопасное чтение строк из БД.
 *
 * Строка из базы — такие же недоверенные данные, как JSON из запроса: SQLite
 * типизирован динамически, колонка `TEXT` может содержать BLOB, а `INTEGER` —
 * строку. Здесь каждое значение проверяется и превращается в доменный тип либо
 * честно роняет запрос.
 *
 * Падать громко здесь важнее, чем отдать «что-то»: `NaN`-дата, просочившаяся
 * в автомат, молча разрешила бы возврат — `NaN > срок` даёт `false`.
 */

/** Повреждение данных в хранилище — это не ошибка пользователя, а сбой. */
export class CorruptRowError extends Error {
  constructor(column: string, value: unknown) {
    super(`Повреждённые данные в БД: ${column} = ${JSON.stringify(value) ?? String(value)}`);
    this.name = 'CorruptRowError';
  }
}

/** Строка результата запроса до проверки. */
export type Row = Record<string, unknown>;

/** Статус из БД проверяется тем же guard'ом, что и значение из JSON. */
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
  // node:sqlite умеет отдавать BIGINT для больших целых.
  if (typeof value === 'bigint') {
    return Number(value);
  }
  throw new CorruptRowError(column, value);
}

/** Дата в формате, который понимает и SQLite, и `readDate`. */
export function toIso(date: Date): string {
  return date.toISOString();
}
