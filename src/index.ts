/**
 * Статусы ноутбука на складе — конечный автомат с условным переходом и журналом.
 *
 * Точка входа. Экспорты перечислены явно, а не через `export *`: публичный API —
 * это решение, а не побочный эффект того, что лежит в файлах.
 */

// --- Автомат: статусы и граф переходов ---
export {
  ALLOWED_TRANSITIONS,
  ALL_STATUSES,
  LaptopStatus,
  STATUS_LABELS,
  allowedTransitionsFrom,
  isLaptopStatus,
  isTerminalStatus,
  statusLabel,
  transitionKey,
  type AllowedTarget,
  type TerminalStatus,
  type TransitionGraph,
  type TransitionKey,
} from './status.js';

// --- Операции ---
export {
  MS_IN_DAY,
  RETURN_WINDOW_DAYS,
  availableTransitions,
  canChangeStatus,
  changeStatus,
  changeStatusOrThrow,
  changeStatusStrict,
  createLaptop,
  resolveSaleDate,
  returnDeadline,
  type CreateLaptopInput,
} from './changeStatus.js';

// --- Ошибки ---
export { StatusTransitionError } from './errors.js';

// --- Типы домена ---
export {
  TransitionErrorCode,
  type ChangeStatusOptions,
  type InvalidDateError,
  type Laptop,
  type Result,
  type ReturnWindowExpiredError,
  type SaleDateUnknownError,
  type SameStatusError,
  type StatusChange,
  type TerminalStatusError,
  type TransitionError,
  type TransitionNotAllowedError,
  type UnknownStatusError,
} from './types.js';
