import type { LaptopStatus } from './status.js';

/**
 * Запись журнала изменений. ТЗ требует ровно три поля: какой статус был,
 * какой стал и дата. Сознательно не добавляю `actor`/`reason`/`id` — это было бы
 * домысливанием требований; расширить структуру дешевле, чем потом убирать лишнее.
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
 * Ноутбук как агрегат: текущий статус + журнал. Журнал append-only, записи
 * смыкаются в цепочку (`history[i].to === history[i + 1].from`), а `history`
 * последней записи согласован с `status`.
 */
export interface Laptop {
  readonly id: string;
  readonly status: LaptopStatus;
  /** Журнал изменений в хронологическом порядке. */
  readonly history: readonly StatusChange[];
  /**
   * Запасной источник даты продажи — для записей, импортированных из внешней
   * системы без истории. Приоритет всегда у истории, см. `resolveSaleDate()`.
   */
  readonly soldAt?: Date;
}

/**
 * Результат операции, в котором ошибка — часть типа.
 *
 * Выбран вместо исключения потому, что ТЗ говорит буквально «возвращает понятную
 * ошибку», и потому что при `Result` компилятор не даст обратиться к `value`,
 * не проверив `ok`: забыть обработать ошибку невозможно. Для вызывающего кода,
 * которому удобнее исключение, есть `changeStatusOrThrow()`.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Параметры смены статуса. */
export interface ChangeStatusOptions {
  /**
   * Текущий момент. По умолчанию `new Date()`.
   *
   * Часы инжектируются, чтобы правило «14 дней» можно было проверить точно,
   * не подменяя глобальный таймер и не делая тесты зависимыми от реального времени.
   */
  readonly now?: Date;
}

/** Машинные коды ошибок — стабильный контракт для логов, UI и API. */
export const TransitionErrorCode = {
  /** Значение статуса не входит в перечисление (пришло извне). */
  UnknownStatus: 'UNKNOWN_STATUS',
  /** Невалидная дата или «сейчас» раньше даты продажи. */
  InvalidDate: 'INVALID_DATE',
  /** Переход в тот же самый статус. */
  SameStatus: 'SAME_STATUS',
  /** Попытка уйти из конечного статуса. */
  TerminalStatus: 'TERMINAL_STATUS',
  /** Такого ребра нет в графе переходов. */
  TransitionNotAllowed: 'TRANSITION_NOT_ALLOWED',
  /** Возврат запрошен, но дату продажи определить не удалось. */
  SaleDateUnknown: 'SALE_DATE_UNKNOWN',
  /** Возврат запрошен позже допустимого срока. */
  ReturnWindowExpired: 'RETURN_WINDOW_EXPIRED',
} as const;

export type TransitionErrorCode = (typeof TransitionErrorCode)[keyof typeof TransitionErrorCode];

interface TransitionErrorBase<C extends TransitionErrorCode> {
  /** Машинный код: по нему ветвится вызывающий код. */
  readonly code: C;
  /** Готовое сообщение на русском: его можно показать пользователю или положить в лог. */
  readonly message: string;
}

export interface UnknownStatusError extends TransitionErrorBase<'UNKNOWN_STATUS'> {
  /** Где именно встретилось плохое значение. */
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
  /** Что было можно вместо этого — чтобы вызывающий мог показать варианты. */
  readonly allowed: readonly LaptopStatus[];
}

export type SaleDateUnknownError = TransitionErrorBase<'SALE_DATE_UNKNOWN'>;

export interface ReturnWindowExpiredError extends TransitionErrorBase<'RETURN_WINDOW_EXPIRED'> {
  readonly soldAt: Date;
  readonly now: Date;
  /** Последний момент, когда возврат был возможен (включительно). */
  readonly deadline: Date;
  readonly windowDays: number;
  readonly msElapsed: number;
  /** Прошло суток с момента продажи; дробное — округление остаётся за UI. */
  readonly daysElapsed: number;
}

/**
 * Все возможные ошибки перехода. Дискриминированное объединение: `switch (error.code)`
 * проверяется компилятором на исчерпывающесть, новый код ошибки сломает сборку
 * в каждом месте, где его забыли обработать.
 */
export type TransitionError =
  | UnknownStatusError
  | InvalidDateError
  | SameStatusError
  | TerminalStatusError
  | TransitionNotAllowedError
  | SaleDateUnknownError
  | ReturnWindowExpiredError;
