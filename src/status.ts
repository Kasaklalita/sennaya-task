/**
 * Статусы и граф переходов.
 *
 * ALLOWED_TRANSITIONS — один источник истины. Из него расти и проверка
 * в рантайм, и тип. Два места рассинхронить нельзя: место одно.
 */

/** Статусы из ТЗ. Значение — машинный ключ, подпись для человек в STATUS_LABELS. */
export const LaptopStatus = {
  /** «На складе» — можно продать или забронировать. */
  InStock: 'IN_STOCK',
  /** «Бронь» — отложен под покупатель. */
  Reserved: 'RESERVED',
  /** «Продан» — отсюда возможен возврат, пока срок не вышел. */
  Sold: 'SOLD',
  /** «Списан» — конец, дальше хода нет. */
  WrittenOff: 'WRITTEN_OFF',
} as const;

export type LaptopStatus = (typeof LaptopStatus)[keyof typeof LaptopStatus];

/** Все статусы. Собирать из LaptopStatus, не рука: список отстать не может. */
export const ALL_STATUSES: readonly LaptopStatus[] = Object.freeze(Object.values(LaptopStatus));

/**
 * Откуда ноутбук начинать жизнь.
 *
 * Экспортировать, потому что интерфейс хотеть знать, в какой колонка рисовать
 * кнопку «добавить». Пусть домен сказать, а не вёрстка гадать.
 */
export const INITIAL_STATUS: LaptopStatus = LaptopStatus.InStock;

/** Подписи ровно как в ТЗ. Попадать в текст ошибки. */
export const STATUS_LABELS = {
  IN_STOCK: 'На складе',
  RESERVED: 'Бронь',
  SOLD: 'Продан',
  WRITTEN_OFF: 'Списан',
} as const satisfies Record<LaptopStatus, string>;

/**
 * Граф переходов из ТЗ.
 *
 * `satisfies Record<LaptopStatus, …>` не дать забыть статус: новый статус
 * без рёбер не скомпилироваться.
 */
export const ALLOWED_TRANSITIONS = {
  IN_STOCK: ['RESERVED', 'SOLD', 'WRITTEN_OFF'],
  RESERVED: ['IN_STOCK', 'SOLD'],
  // Возврат не всегда можно — срок жить в rules.ts.
  // Граф про «куда можно», условие про «когда можно».
  SOLD: ['IN_STOCK'],
  WRITTEN_OFF: [],
} as const satisfies Record<LaptopStatus, readonly LaptopStatus[]>;

export type TransitionGraph = typeof ALLOWED_TRANSITIONS;

/**
 * Куда можно из `From`. Считать из того же графа.
 *
 * ```ts
 * AllowedTarget<'SOLD'>;        // 'IN_STOCK'
 * AllowedTarget<'WRITTEN_OFF'>; // never — тупик доказан типом
 * ```
 */
export type AllowedTarget<From extends LaptopStatus> = TransitionGraph[From][number];

/**
 * Конечные статусы: откуда рёбер нет. Считать из графа, не писать строкой.
 *
 * Обёртка `[T] extends [never]` обязательна — иначе условный тип
 * распределиться по never и дать never для всех.
 */
export type TerminalStatus = {
  [S in LaptopStatus]: [AllowedTarget<S>] extends [never] ? S : never;
}[LaptopStatus];

/** Ключ ребра. Нужен карте условий. */
export type TransitionKey = `${LaptopStatus}->${LaptopStatus}`;

export function transitionKey(from: LaptopStatus, to: LaptopStatus): TransitionKey {
  return `${from}->${to}`;
}

/** Это статус? Нужно на границе: тип в рантайм не жить, из JSON прийти что угодно. */
export function isLaptopStatus(value: unknown): value is LaptopStatus {
  return typeof value === 'string' && (ALL_STATUSES as readonly string[]).includes(value);
}

/** Куда можно по графу. Условия не учитывать. */
export function allowedTransitionsFrom(status: LaptopStatus): readonly LaptopStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

/** Конечный? Значит рёбер наружу нет. */
export function isTerminalStatus(status: LaptopStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/** Подпись для человек. */
export function statusLabel(status: LaptopStatus): string {
  return STATUS_LABELS[status];
}
