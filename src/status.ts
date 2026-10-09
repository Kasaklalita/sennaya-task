/**
 * Статусы ноутбука и граф допустимых переходов.
 *
 * `ALLOWED_TRANSITIONS` — единственный источник истины об автомате: из него выводятся
 * и рантайм-проверки, и типы уровня компиляции. Поэтому граф физически невозможно
 * рассинхронизировать с валидацией: добавили ребро в объект — изменились и проверки,
 * и типы, и список доступных переходов в UI.
 */

/**
 * Статусы из ТЗ. Значения — стабильные машинные ключи (их не стыдно хранить в БД
 * и отдавать по API), человекочитаемые подписи лежат в {@link STATUS_LABELS}.
 */
export const LaptopStatus = {
  /** «На складе» — ноутбук доступен к продаже или брони. */
  InStock: 'IN_STOCK',
  /** «Бронь» — отложен под покупателя. */
  Reserved: 'RESERVED',
  /** «Продан» — из этого статуса возможен возврат в течение окна возврата. */
  Sold: 'SOLD',
  /** «Списан» — конечный статус, дальше переходов нет. */
  WrittenOff: 'WRITTEN_OFF',
} as const;

export type LaptopStatus = (typeof LaptopStatus)[keyof typeof LaptopStatus];

/**
 * Все статусы. Собирается из {@link LaptopStatus}, а не перечисляется руками, —
 * список не может отстать от перечисления.
 */
export const ALL_STATUSES: readonly LaptopStatus[] = Object.freeze(Object.values(LaptopStatus));

/**
 * Статус, с которого начинается жизнь ноутбука: он приезжает на склад.
 *
 * Значение по умолчанию в `createLaptop()` и начальная вершина автомата —
 * одно и то же, поэтому константа экспортируется: интерфейсу нужно знать,
 * в какой колонке появится новая карточка, и он не должен выяснять это
 * собственным предположением.
 */
export const INITIAL_STATUS: LaptopStatus = LaptopStatus.InStock;

/** Подписи ровно в формулировках ТЗ — попадают в тексты ошибок. */
export const STATUS_LABELS = {
  IN_STOCK: 'На складе',
  RESERVED: 'Бронь',
  SOLD: 'Продан',
  WRITTEN_OFF: 'Списан',
} as const satisfies Record<LaptopStatus, string>;

/**
 * Граф переходов из ТЗ.
 *
 * `satisfies Record<LaptopStatus, ...>` гарантирует, что ни один статус не забыт:
 * новый статус без описанных переходов не скомпилируется.
 */
export const ALLOWED_TRANSITIONS = {
  IN_STOCK: ['RESERVED', 'SOLD', 'WRITTEN_OFF'],
  RESERVED: ['IN_STOCK', 'SOLD'],
  // Возврат разрешён не всегда — ограничение по сроку живёт в guard'е перехода,
  // см. GUARDS в rules.ts. Граф отвечает за «куда можно», условие — за «когда можно».
  SOLD: ['IN_STOCK'],
  WRITTEN_OFF: [],
} as const satisfies Record<LaptopStatus, readonly LaptopStatus[]>;

export type TransitionGraph = typeof ALLOWED_TRANSITIONS;

/**
 * Статусы, достижимые из `From`, — вычисляются из того же графа.
 *
 * ```ts
 * type A = AllowedTarget<'SOLD'>;        // 'IN_STOCK'
 * type B = AllowedTarget<'WRITTEN_OFF'>; // never — терминальность доказана типами
 * ```
 */
export type AllowedTarget<From extends LaptopStatus> = TransitionGraph[From][number];

/**
 * Конечные статусы — те, из которых не ведёт ни одно ребро. Выводится из графа,
 * а не зашито строкой `'WRITTEN_OFF'`.
 *
 * Обёртка в кортеж `[T] extends [never]` обязательна: без неё условный тип
 * распределился бы по `never` и дал бы `never` для всех статусов.
 */
export type TerminalStatus = {
  [S in LaptopStatus]: [AllowedTarget<S>] extends [never] ? S : never;
}[LaptopStatus];

/** Ключ ребра графа — используется для карты guard'ов. */
export type TransitionKey = `${LaptopStatus}->${LaptopStatus}`;

export function transitionKey(from: LaptopStatus, to: LaptopStatus): TransitionKey {
  return `${from}->${to}`;
}

/**
 * Проверка значения, пришедшего извне (JSON, запрос, БД). Нужна потому, что
 * типы TypeScript не существуют в рантайме: на границе системы `status` — это `unknown`.
 */
export function isLaptopStatus(value: unknown): value is LaptopStatus {
  return typeof value === 'string' && (ALL_STATUSES as readonly string[]).includes(value);
}

/** Куда разрешено уходить из статуса по графу (без учёта guard'ов). */
export function allowedTransitionsFrom(status: LaptopStatus): readonly LaptopStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

/** Конечный ли статус. Определяется отсутствием исходящих рёбер. */
export function isTerminalStatus(status: LaptopStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/** Подпись статуса для человека. */
export function statusLabel(status: LaptopStatus): string {
  return STATUS_LABELS[status];
}
