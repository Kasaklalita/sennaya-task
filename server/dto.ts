import type { LaptopStatus, TransitionError, TransitionErrorCode } from '../src/index.js';
import type { AttemptRecord, LaptopRecord } from './repository.js';

/**
 * Контракт сети: что именно уходит клиенту и как доменные объекты в это
 * превращаются.
 *
 * Вынесено из обработчиков отдельно, потому что это **публичный интерфейс**:
 * его ломать нельзя, не сломав фронтенд. Когда он лежит в одном файле
 * с логикой запросов, такое изменение легко не заметить.
 *
 * Даты здесь — строки ISO-8601. Объект `Date` через JSON всё равно не проходит,
 * и явная строка в типе честнее, чем `Date`, который на том конце окажется
 * текстом (ровно эту ошибку домен ловит как `INVALID_DATE`).
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

export interface BoardDto {
  readonly laptops: readonly LaptopDto[];
  readonly attempts: readonly AttemptDto[];
}

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
 * `satisfies Record<TransitionErrorCode, number>` делает таблицу исчерпывающей:
 * новый код ошибки в домене сломает сборку здесь, а не тихо уедет в 500.
 *
 * 409 — нарушение бизнес-правила: запрос понятен и данные корректны, но
 * состояние ресурса его не допускает. 400 — испорченный ввод. 422 — данных
 * не хватает, чтобы правило вообще можно было проверить.
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
