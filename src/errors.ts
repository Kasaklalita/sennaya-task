/**
 * Как делать ошибки перехода.
 *
 * У каждой три части:
 *  - `code` — для машины: ветвиться и класть в HTTP-статус;
 *  - `message` — готовый русский текст, статусы как в ТЗ;
 *  - детали — чтобы UI не парсил текст (`allowed`, `deadline`, …).
 *
 * Даты писать ISO-8601 UTC. Формат одинаковый везде, от локали сервера не
 * зависеть — значит тест может его закрепить. «18 января, 13:00» рисовать
 * интерфейс: у него есть таймзона человека.
 */

import {
  ALL_STATUSES,
  allowedTransitionsFrom,
  statusLabel,
  type LaptopStatus,
} from './status.js';
import type {
  InvalidDateError,
  ReturnWindowExpiredError,
  SaleDateUnknownError,
  SameStatusError,
  TerminalStatusError,
  TransitionError,
  TransitionErrorCode,
  TransitionNotAllowedError,
  UnknownStatusError,
} from './types.js';

/** `«На складе», «Продан»` — список статусов в текст ошибки. */
function labelList(statuses: readonly LaptopStatus[]): string {
  return statuses.map((status) => `«${statusLabel(status)}»`).join(', ');
}

function iso(date: Date): string {
  return date.toISOString();
}

/** Описать чужое значение для текста ошибки, не сломавшись. */
function describeValue(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

const UNKNOWN_STATUS_FIELD_LABEL = {
  'laptop.status': 'текущий статус ноутбука',
  to: 'целевой статус',
} as const satisfies Record<UnknownStatusError['field'], string>;

const SALE_DATE_SOURCE_LABEL = {
  soldAt: 'поле soldAt',
  history: 'запись в истории',
} as const satisfies Record<'soldAt' | 'history', string>;

export function unknownStatus(
  field: UnknownStatusError['field'],
  received: unknown,
): UnknownStatusError {
  return Object.freeze({
    code: 'UNKNOWN_STATUS',
    message:
      `Неизвестный статус: ${UNKNOWN_STATUS_FIELD_LABEL[field]} равен ${describeValue(received)}. ` +
      `Допустимые значения: ${ALL_STATUSES.join(', ')}.`,
    field,
    received,
    allowedValues: ALL_STATUSES,
  });
}

export function invalidNow(): InvalidDateError {
  return Object.freeze({
    code: 'INVALID_DATE',
    message: 'Некорректная дата: options.now не является корректной датой.',
    field: 'now',
    reason: 'not_a_date',
  });
}

export function invalidSaleDate(field: 'soldAt' | 'history'): InvalidDateError {
  return Object.freeze({
    code: 'INVALID_DATE',
    message:
      `Некорректная дата продажи: ${SALE_DATE_SOURCE_LABEL[field]} содержит значение, ` +
      'не являющееся корректной датой.',
    field,
    reason: 'not_a_date',
  });
}

export function nowBeforeSale(now: Date, soldAt: Date): InvalidDateError {
  return Object.freeze({
    code: 'INVALID_DATE',
    message:
      `Некорректная дата: текущий момент (${iso(now)}) раньше даты продажи (${iso(soldAt)}). ` +
      'Похоже на рассинхрон часов или испорченные данные.',
    field: 'now',
    reason: 'now_before_sale',
  });
}

/**
 * Часы отвели назад, за последнюю запись.
 *
 * Журнал обязан идти вперёд: на этом держаться и чтение «последней продажи»,
 * и восстановление истории из БД в порядке записи. Разрешить запись задним
 * числом — разрешить журнал, где время идти вспять.
 */
export function nowBeforeLastChange(now: Date, lastChangeAt: Date): InvalidDateError {
  return Object.freeze({
    code: 'INVALID_DATE',
    message:
      `Некорректная дата: текущий момент (${iso(now)}) раньше последней записи ` +
      `в истории (${iso(lastChangeAt)}). Журнал изменений должен быть хронологическим.`,
    field: 'now',
    reason: 'now_before_last_change',
  });
}

export function sameStatus(status: LaptopStatus): SameStatusError {
  return Object.freeze({
    code: 'SAME_STATUS',
    message: `Ноутбук уже в статусе «${statusLabel(status)}»: переход в тот же статус не предусмотрен.`,
    status,
  });
}

export function terminalStatus(from: LaptopStatus, to: LaptopStatus): TerminalStatusError {
  return Object.freeze({
    code: 'TERMINAL_STATUS',
    message:
      `Недопустимый переход: «${statusLabel(from)}» → «${statusLabel(to)}». ` +
      `Статус «${statusLabel(from)}» конечный — из него переходы невозможны.`,
    from,
    to,
  });
}

export function transitionNotAllowed(
  from: LaptopStatus,
  to: LaptopStatus,
): TransitionNotAllowedError {
  const allowed = allowedTransitionsFrom(from);
  return Object.freeze({
    code: 'TRANSITION_NOT_ALLOWED',
    message:
      `Недопустимый переход: «${statusLabel(from)}» → «${statusLabel(to)}». ` +
      `Доступные переходы из статуса «${statusLabel(from)}»: ${labelList(allowed)}.`,
    from,
    to,
    allowed,
  });
}

export function saleDateUnknown(): SaleDateUnknownError {
  return Object.freeze({
    code: 'SALE_DATE_UNKNOWN',
    message:
      'Не удалось определить дату продажи: в истории нет перехода в статус «Продан», ' +
      'и поле soldAt не заполнено. Добавьте запись в историю или передайте soldAt.',
  });
}

export function returnWindowExpired(details: {
  readonly soldAt: Date;
  readonly now: Date;
  readonly deadline: Date;
  readonly windowDays: number;
  readonly msElapsed: number;
  readonly daysElapsed: number;
}): ReturnWindowExpiredError {
  return Object.freeze({
    code: 'RETURN_WINDOW_EXPIRED',
    message:
      `Возврат невозможен: срок возврата истёк. Ноутбук продан ${iso(details.soldAt)}, ` +
      `вернуть его можно было не позднее ${iso(details.deadline)} включительно, ` +
      `сейчас ${iso(details.now)}.`,
    ...details,
  });
}

/**
 * Исключение для тех, кому try/catch удобнее Result.
 * Вся структура ошибки лежать в `details` — ничего не теряться.
 */
export class StatusTransitionError extends Error {
  readonly code: TransitionErrorCode;
  readonly details: TransitionError;

  constructor(error: TransitionError) {
    super(error.message);
    this.name = 'StatusTransitionError';
    this.code = error.code;
    this.details = error;
  }
}
