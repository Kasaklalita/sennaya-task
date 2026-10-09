import type { LaptopStatus } from './status.js';

/**
 * Запись журнала. ТЗ просить ровно три поля: был, стал, дата.
 * `actor`/`reason` НЕ добавлять — это домысел. Дописать потом дешевле,
 * чем убирать лишнее.
 */
export interface StatusChange {
  /** Статус до изменения. */
  readonly from: LaptopStatus;
  /** Статус после изменения. */
  readonly to: LaptopStatus;
  /** Момент изменения. */
  readonly at: Date;
}

/**
 * Ноутбук: статус сейчас + журнал. Журнал только дописывать. Записи смыкаться
 * в цепь (`history[i].to === history[i+1].from`), последняя сходиться со `status`.
 */
export interface Laptop {
  readonly id: string;
  readonly status: LaptopStatus;
  /** Журнал изменений в хронологическом порядке. */
  readonly history: readonly StatusChange[];
  /** Запас на случай записи без истории. История всегда главнее. */
  readonly soldAt?: Date;
}

/**
 * Результат, где ошибка — часть типа.
 *
 * Не исключение, потому что ТЗ буквально сказать «возвращает ошибку». И потому
 * что компилятор не дать взять `value`, пока не проверил `ok`: забыть обработать
 * ошибку нельзя. Кому удобнее бросок — есть changeStatusOrThrow().
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Удача. Конструкторы лежать рядом с типом, а не в каждом модуле. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Неудача. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Параметры смены статуса. */
export interface ChangeStatusOptions {
  /**
   * Сейчас. По умолчанию `new Date()`.
   *
   * Часы передавать снаружи, чтобы правило «14 дней» проверять точно —
   * без подмены глобального таймера и без зависимости от реального времени.
   */
  readonly now?: Date;
}

/** Коды ошибок. Стабильный контракт для лога, UI и API. */
export const TransitionErrorCode = {
  /** Статус не из перечисления — прийти извне. */
  UnknownStatus: 'UNKNOWN_STATUS',
  /** Битая дата или «сейчас» раньше продажи. */
  InvalidDate: 'INVALID_DATE',
  /** Переход в тот же статус. */
  SameStatus: 'SAME_STATUS',
  /** Уход из конечного статуса. */
  TerminalStatus: 'TERMINAL_STATUS',
  /** Ребра в графе нет. */
  TransitionNotAllowed: 'TRANSITION_NOT_ALLOWED',
  /** Возврат просят, а дату продажи не найти. */
  SaleDateUnknown: 'SALE_DATE_UNKNOWN',
  /** Возврат просят позже срока. */
  ReturnWindowExpired: 'RETURN_WINDOW_EXPIRED',
} as const;

export type TransitionErrorCode = (typeof TransitionErrorCode)[keyof typeof TransitionErrorCode];

interface TransitionErrorBase<C extends TransitionErrorCode> {
  /** Код для машины: по нему ветвиться вызывающий. */
  readonly code: C;
  /** Готовый русский текст: показать человеку или положить в лог. */
  readonly message: string;
}

export interface UnknownStatusError extends TransitionErrorBase<'UNKNOWN_STATUS'> {
  /** Где нашли плохое значение. */
  readonly field: 'laptop.status' | 'to';
  readonly received: unknown;
  readonly allowedValues: readonly LaptopStatus[];
}

export interface InvalidDateError extends TransitionErrorBase<'INVALID_DATE'> {
  readonly field: 'now' | 'soldAt' | 'history';
  readonly reason: 'not_a_date' | 'now_before_sale' | 'now_before_last_change';
}

export interface SameStatusError extends TransitionErrorBase<'SAME_STATUS'> {
  readonly status: LaptopStatus;
}

export interface TerminalStatusError extends TransitionErrorBase<'TERMINAL_STATUS'> {
  readonly from: LaptopStatus;
  readonly to: LaptopStatus;
}

export interface TransitionNotAllowedError extends TransitionErrorBase<'TRANSITION_NOT_ALLOWED'> {
  readonly from: LaptopStatus;
  readonly to: LaptopStatus;
  /** Что было можно вместо — чтобы показать варианты. */
  readonly allowed: readonly LaptopStatus[];
}

export type SaleDateUnknownError = TransitionErrorBase<'SALE_DATE_UNKNOWN'>;

export interface ReturnWindowExpiredError extends TransitionErrorBase<'RETURN_WINDOW_EXPIRED'> {
  readonly soldAt: Date;
  readonly now: Date;
  /** Последний момент, когда возврат был можно (включительно). */
  readonly deadline: Date;
  readonly windowDays: number;
  readonly msElapsed: number;
  /** Суток с продажи. Дробное — округлять дело UI. */
  readonly daysElapsed: number;
}

/**
 * Все ошибки перехода. Дискриминированное объединение: `switch (error.code)`
 * компилятор проверять на полноту. Новый код ошибки сломать сборку везде,
 * где его забыли обработать.
 */
export type TransitionError =
  | UnknownStatusError
  | InvalidDateError
  | SameStatusError
  | TerminalStatusError
  | TransitionNotAllowedError
  | SaleDateUnknownError
  | ReturnWindowExpiredError;
