import type { LaptopStatus, TransitionError, TransitionErrorCode } from '../src/index.js';
import type { AttemptRecord, LaptopRecord } from './repository.js';

/**
 * Контракт сети: что уходить клиенту и как домен в это превращаться.
 *
 * Лежать отдельно, потому что это **публичный интерфейс**: сломать его —
 * сломать фронт. Когда он в одном файле с логикой запросов, такое изменение
 * легко не заметить.
 *
 * Даты тут строки ISO-8601. `Date` через JSON всё равно не пролезть, и честная
 * строка в типе лучше, чем `Date`, который на том конце стать текстом —
 * ровно эту ошибку домен ловить как INVALID_DATE.
 */

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

/**
 * Страница журнала.
 *
 * `total` обязателен: без него клиент не отличить «это всё» от «тут ещё есть,
 * но мы вам не сказали». Молчаливое обрезание — это обман.
 *
 * `limit` возвращать фактический: если клиент попросить больше потолка,
 * сервер срезать, и клиент должен об этом узнать, а не догадываться.
 */
export interface AttemptsPageDto {
  readonly items: readonly AttemptDto[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface BoardDto {
  readonly laptops: readonly LaptopDto[];
  readonly attempts: AttemptsPageDto;
}

/** Сколько записей отдавать, если клиент не попросил иначе. */
export const DEFAULT_ATTEMPTS_LIMIT = 20;

/** Потолок. Больше за один запрос не отдавать даже по просьбе. */
export const MAX_ATTEMPTS_LIMIT = 100;

export function toLaptopDto(record: LaptopRecord): LaptopDto {
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

export function toAttemptDto(record: AttemptRecord): AttemptDto {
  return {
    ...record,
    modelNow: record.modelNow.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Код домена → код HTTP.
 *
 * `satisfies Record<TransitionErrorCode, number>` делать таблицу полной: новый
 * код ошибки сломать сборку ТУТ, а не тихо уехать в 500.
 *
 * 409 — правило нарушено: запрос понятный, данные хорошие, состояние не пускать.
 * 400 — ввод битый. 422 — данных не хватать, правило вообще не проверить.
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
