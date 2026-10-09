/**
 * Статусы ноутбука на складе: автомат с условным переходом и журналом.
 *
 * Вход. Экспорты перечислены руками, не через `export *`: публичный API —
 * это решение, а не побочный эффект того, что лежит в файлах.
 *
 * Карта:
 *  status.ts        граф — «куда можно»
 *  rules.ts         условия на рёбрах — «когда можно», срок возврата
 *  laptop.ts        агрегат: создать, дата продажи, дописать журнал
 *  changeStatus.ts  движок, сводить всё вместе
 *  errors.ts        ошибки: код, текст, детали
 *  types.ts         типы домена и Result
 *  time.ts          даты
 */

// --- Статусы и граф ---
export {
  ALLOWED_TRANSITIONS,
  ALL_STATUSES,
  INITIAL_STATUS,
  LaptopStatus,
  STATUS_LABELS,
  allowedTransitionsFrom,
  isLaptopStatus,
  isTerminalStatus,
  statusLabel,
  transitionKey,
  type AllowedTarget,
  type TerminalStatus,
  type TransitionKey,
} from './status.js';

// --- Условия на рёбрах ---
export { RETURN_WINDOW_DAYS, returnDeadline } from './rules.js';

// --- Агрегат ---
export { createLaptop, resolveSaleDate, type CreateLaptopInput } from './laptop.js';

// --- Операции ---
export {
  availableTransitions,
  canChangeStatus,
  changeStatus,
  changeStatusOrThrow,
  changeStatusStrict,
} from './changeStatus.js';

// --- Ошибки ---
export { StatusTransitionError } from './errors.js';

// --- Время ---
export { MS_IN_DAY } from './time.js';

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
