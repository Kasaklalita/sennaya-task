/**
 * Проверки уровня типов.
 *
 * Эти утверждения проверяет **компилятор**, а не Vitest: они срабатывают
 * на `npm run typecheck` (`tsc --noEmit` включает папку `tests`). Каждый
 * `@ts-expect-error` — такой же тест, как `expect(...)`: если на строке ниже
 * ошибки компиляции НЕ будет, сборка упадёт на «неиспользованной директиве».
 *
 * Зачем это нужно, если есть рантайм-проверки: граф переходов один и тот же,
 * но ловить ошибку дешевле всего до запуска. Там, где статус известен типу как
 * литерал, компилятор не даст даже написать невозможный переход.
 */

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TRANSITIONS,
  LaptopStatus,
  changeStatus,
  changeStatusStrict,
  createLaptop,
  type AllowedTarget,
  type Laptop,
  type TerminalStatus,
  type TransitionError,
} from '../src/index.js';

/** Строгое сравнение типов (а не взаимная присваиваемость). */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Expect<T extends true> = T;

// --- Граф переходов, выведенный в типы ---

export type AssertInStockTargets = Expect<
  Equals<AllowedTarget<'IN_STOCK'>, 'RESERVED' | 'SOLD' | 'WRITTEN_OFF'>
>;
export type AssertReservedTargets = Expect<
  Equals<AllowedTarget<'RESERVED'>, 'IN_STOCK' | 'SOLD'>
>;
export type AssertSoldTargets = Expect<Equals<AllowedTarget<'SOLD'>, 'IN_STOCK'>>;

/** Терминальность «Списан» доказана типами: из него нет ни одного перехода. */
export type AssertWrittenOffIsDeadEnd = Expect<Equals<AllowedTarget<'WRITTEN_OFF'>, never>>;

/** Множество конечных статусов вычислено из графа, а не перечислено руками. */
export type AssertTerminalStatus = Expect<Equals<TerminalStatus, 'WRITTEN_OFF'>>;

// --- Фикстуры с литеральным статусом ---

const SOLD_LAPTOP = {
  id: 'nb-sold',
  status: 'SOLD',
  history: [{ from: 'IN_STOCK', to: 'SOLD', at: new Date('2026-01-18T10:00:00.000Z') }],
} as const satisfies Laptop;

const WRITTEN_OFF_LAPTOP = {
  id: 'nb-written-off',
  status: 'WRITTEN_OFF',
  history: [{ from: 'IN_STOCK', to: 'WRITTEN_OFF', at: new Date('2026-01-18T10:00:00.000Z') }],
} as const satisfies Laptop;

const IN_STOCK_LAPTOP = {
  id: 'nb-in-stock',
  status: 'IN_STOCK',
  history: [],
} as const satisfies Laptop;

const LAPTOP: Laptop = createLaptop({ id: 'nb-typed' });

// --- Что компилятор обязан запретить ---

/**
 * Тело этой функции существует только для компилятора — она никогда не вызывается.
 *
 * Так и должно быть: часть строк ниже это не просто ошибки типов, а ещё и операции,
 * которые в рантайме честно бросят `TypeError` (объекты заморожены). Проверять их
 * нужно на этапе компиляции, а не исполнять.
 */
export function compileTimeOnlyAssertions(): void {
  // Возврат из «Продан» — единственный допустимый переход, он проходит:
  changeStatusStrict(SOLD_LAPTOP, 'IN_STOCK');

  // @ts-expect-error — «Продан» → «Списан» нет в графе, тип `to` его не допускает
  changeStatusStrict(SOLD_LAPTOP, 'WRITTEN_OFF');

  // @ts-expect-error — «Продан» → «Бронь» нет в графе
  changeStatusStrict(SOLD_LAPTOP, 'RESERVED');

  // @ts-expect-error — из «Списан» AllowedTarget = never: вызов невозможен в принципе
  changeStatusStrict(WRITTEN_OFF_LAPTOP, 'IN_STOCK');

  // @ts-expect-error — строка не из перечисления статусов
  changeStatus(LAPTOP, 'BROKEN');

  // @ts-expect-error — options.now должен быть Date, а не строкой из JSON
  changeStatus(LAPTOP, LaptopStatus.Sold, { now: '2026-01-18' });

  // @ts-expect-error — exactOptionalPropertyTypes: явный undefined запрещён
  changeStatus(LAPTOP, LaptopStatus.Sold, { now: undefined });

  // @ts-expect-error — поля Laptop только для чтения
  LAPTOP.status = LaptopStatus.Sold;

  // @ts-expect-error — журнал неизменяем на уровне типа, не только через freeze
  LAPTOP.history.push({ from: 'IN_STOCK', to: 'SOLD', at: new Date() });

  // @ts-expect-error — граф переходов нельзя дописать на ходу
  ALLOWED_TRANSITIONS.SOLD.push('RESERVED');

  const result = changeStatus(LAPTOP, LaptopStatus.Sold);

  // @ts-expect-error — обратиться к value, не проверив ok, компилятор не даёт:
  // забыть обработать ошибку невозможно
  result.value;
}

/**
 * Исчерпывающий разбор ошибок: `default` присваивает `error` в `never`.
 * Если в `TransitionError` появится новый вариант, а здесь его не обработают,
 * сборка упадёт — ни один код ошибки нельзя «потерять» молча.
 */
function describeError(error: TransitionError): string {
  switch (error.code) {
    case 'UNKNOWN_STATUS':
      return `неизвестный статус в ${error.field}`;
    case 'INVALID_DATE':
      return `некорректная дата (${error.field}: ${error.reason})`;
    case 'SAME_STATUS':
      return `уже в статусе ${error.status}`;
    case 'TERMINAL_STATUS':
      return `${error.from} — конечный статус`;
    case 'TRANSITION_NOT_ALLOWED':
      return `${error.from} -> ${error.to} запрещён, можно: ${error.allowed.join(', ')}`;
    case 'SALE_DATE_UNKNOWN':
      return 'дата продажи неизвестна';
    case 'RETURN_WINDOW_EXPIRED':
      return `срок истёк ${error.deadline.toISOString()}`;
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}

describe('проверки уровня типов', () => {
  it('выполняются компилятором на npm run typecheck', () => {
    // Рантайм-подтверждение того же факта, что доказан типами выше.
    expect(ALLOWED_TRANSITIONS.WRITTEN_OFF).toEqual([]);
    expect(ALLOWED_TRANSITIONS.SOLD).toEqual(['IN_STOCK']);
  });

  it('changeStatusStrict в рантайме делегирует в changeStatus', () => {
    // Со часами, переданными явно.
    const returned = changeStatusStrict(SOLD_LAPTOP, 'IN_STOCK', {
      now: new Date('2026-01-19T10:00:00.000Z'),
    });
    expect(returned.ok).toBe(true);

    // И без options — результат этого перехода от времени не зависит.
    const reserved = changeStatusStrict(IN_STOCK_LAPTOP, 'RESERVED');
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }
    expect(reserved.value.status).toBe('RESERVED');
  });

  it('разбор union ошибок исчерпывающий', () => {
    const notAllowed = changeStatus(SOLD_LAPTOP, LaptopStatus.Reserved, {
      now: new Date('2026-01-19T10:00:00.000Z'),
    });
    const same = changeStatus(LAPTOP, LaptopStatus.InStock);

    expect(notAllowed.ok).toBe(false);
    expect(same.ok).toBe(false);
    if (notAllowed.ok || same.ok) {
      return;
    }

    expect(describeError(notAllowed.error)).toBe('SOLD -> RESERVED запрещён, можно: IN_STOCK');
    expect(describeError(same.error)).toBe('уже в статусе IN_STOCK');
  });
});
