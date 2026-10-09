/** Время. Нужно всем слоям домена: и агрегату, и условиям, и движку. */

export const MS_IN_DAY = 24 * 60 * 60 * 1000;

/**
 * Дата живая?
 *
 * Берёт `unknown`, не `Date`: на границе (JSON, строка из БД) в поле типа `Date`
 * лежать строка — тип в рантайм не жить. `new Date('не дата')` тоже Date, но NaN.
 */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Копия даты.
 *
 * `Date` мутабельный, `Object.freeze` его не закрыть: время лежать во внутренний
 * слот, не в свойство. Значит неизменяемость держаться на копии, не на заморозке.
 */
export function copyDate(date: Date): Date {
  return new Date(date.getTime());
}
