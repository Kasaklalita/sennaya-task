import { describe, expect, it } from 'vitest';

import {
  ALL_STATUSES,
  LaptopStatus,
  allowedTransitionsFrom,
  availableTransitions,
  changeStatus,
  changeStatusOrThrow,
  createLaptop,
  isLaptopStatus,
  isTerminalStatus,
  TransitionErrorCode,
  type Laptop,
  type LaptopStatus as Status,
} from '../src/index.js';
import { SALE_DATE, days, inStock } from './helpers.js';

/**
 * Свой PRNG (mulberry32).
 *
 * Не `Math.random()`, чтобы падение теста повторялось: тот же сид — тот же
 * обход. Чужая библиотека тут не нужна: домен маленький, а ноль зависимостей —
 * часть ценности пакета.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const KNOWN_CODES: readonly string[] = Object.values(TransitionErrorCode);

/** Что обязано быть верно после любого числа переходов — удачных и нет. */
function expectAggregateIsConsistent(laptop: Laptop, initialStatus: Status): void {
  expect(isLaptopStatus(laptop.status)).toBe(true);

  const history = laptop.history;
  if (history.length === 0) {
    expect(laptop.status).toBe(initialStatus);
    return;
  }

  // Цепь начинаться с первого статуса и кончаться текущим.
  expect(history[0]?.from).toBe(initialStatus);
  expect(history.at(-1)?.to).toBe(laptop.status);

  for (const [index, change] of history.entries()) {
    expect(isLaptopStatus(change.from)).toBe(true);
    expect(isLaptopStatus(change.to)).toBe(true);
    // Переход в себя в журнал попасть не может.
    expect(change.from).not.toBe(change.to);
    // Каждая запись — настоящее ребро графа.
    expect(allowedTransitionsFrom(change.from)).toContain(change.to);

    if (index > 0) {
      const previous = history[index - 1];
      // Записи смыкаться: to прошлой равен from следующей.
      expect(change.from).toBe(previous?.to);
      // Время назад не идти.
      expect(change.at.getTime()).toBeGreaterThanOrEqual(previous?.at.getTime() ?? 0);
    }
  }
}

describe('model-based обход автомата', () => {
  const STEPS = 2000;
  const SEED = 20_260_118;

  it(`сохраняет все инварианты на ${STEPS} случайных шагах`, () => {
    const random = mulberry32(SEED);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

    let laptop = createLaptop({ id: 'nb-walk-0' });
    let initialStatus: Status = laptop.status;
    let now = SALE_DATE;

    let successes = 0;
    let terminalDeadEnds = 0;
    let expiredDeadEnds = 0;
    const seenCodes = new Set<string>();

    for (let step = 0; step < STEPS; step += 1) {
      // Время идти вперёд шагами 0…10 суток: так обход натыкаться и
      // на удачный возврат (шаг короче окна), и на истёкший срок (два шага).
      now = new Date(now.getTime() + Math.floor(random() * days(10)));

      const before = laptop;
      const snapshot = JSON.stringify(before);
      const target = pick(ALL_STATUSES);

      const result = changeStatus(before, target, { now });

      // Главный инвариант чистой функции: вход не меняться никогда.
      expect(JSON.stringify(before)).toBe(snapshot);

      if (result.ok) {
        successes += 1;
        laptop = result.value;

        expect(allowedTransitionsFrom(before.status)).toContain(target);
        expect(laptop.status).toBe(target);
        expect(laptop.history).toHaveLength(before.history.length + 1);
        // Журнал только дописывать: старые записи не переписывать.
        expect(laptop.history.slice(0, before.history.length)).toEqual(before.history);
        expect(laptop.history.at(-1)).toEqual({ from: before.status, to: target, at: now });
      } else {
        seenCodes.add(result.error.code);
        expect(KNOWN_CODES).toContain(result.error.code);
        expect(result.error.message.length).toBeGreaterThan(0);
      }

      expectAggregateIsConsistent(laptop, initialStatus);

      // Тупик — состояние, откуда не проходить ни один переход.
      // Их два вида, и второй нашёл именно этот обход.
      if (availableTransitions(laptop, { now }).length === 0) {
        for (const anyTarget of ALL_STATUSES) {
          const blocked = changeStatus(laptop, anyTarget, { now });
          expect(blocked.ok).toBe(false);
          if (!blocked.ok) {
            seenCodes.add(blocked.error.code);
          }
        }

        if (isTerminalStatus(laptop.status)) {
          terminalDeadEnds += 1;
        } else {
          expiredDeadEnds += 1;
        }

        laptop = createLaptop({ id: `nb-walk-${step}` });
        initialStatus = laptop.status;
      }
    }

    // Обход должен быть содержательным, а не «всё нельзя с первого шага».
    expect(successes).toBeGreaterThan(100);

    // «Списан» — тупик по графу, он ожидаем.
    expect(terminalDeadEnds).toBeGreaterThan(5);

    // А это находка обхода: «Продан» с истёкшим сроком тоже тупик, хотя
    // по графу ребро есть. Подробности в README.
    expect(expiredDeadEnds).toBeGreaterThan(5);

    // Обход должен задеть все ошибки, достижимые на хороших данных.
    expect([...seenCodes].sort()).toEqual([
      'RETURN_WINDOW_EXPIRED',
      'SAME_STATUS',
      'TERMINAL_STATUS',
      'TRANSITION_NOT_ALLOWED',
    ]);
  });

  it('воспроизводим: один и тот же сид даёт один и тот же результат', () => {
    const walk = (): string => {
      const random = mulberry32(SEED);
      let laptop = createLaptop({ id: 'nb-repeat' });
      let now = SALE_DATE;

      for (let step = 0; step < 200; step += 1) {
        now = new Date(now.getTime() + Math.floor(random() * days(20)));
        const target = ALL_STATUSES[Math.floor(random() * ALL_STATUSES.length)] as Status;
        const result = changeStatus(laptop, target, { now });
        if (result.ok) {
          laptop = result.value;
        }
      }

      return JSON.stringify(laptop);
    };

    expect(walk()).toBe(walk());
  });
});

describe('неизменяемость', () => {
  it('возвращает новый объект, а не мутирует переданный', () => {
    const before = inStock();
    const after_ = changeStatusOrThrow(before, LaptopStatus.Sold, { now: SALE_DATE });

    expect(after_).not.toBe(before);
    expect(before.status).toBe('IN_STOCK');
    expect(before.history).toHaveLength(0);
  });

  it('результат и журнал заморожены', () => {
    const laptop = changeStatusOrThrow(inStock(), LaptopStatus.Reserved, { now: SALE_DATE });

    expect(Object.isFrozen(laptop)).toBe(true);
    expect(Object.isFrozen(laptop.history)).toBe(true);
    expect(Object.isFrozen(laptop.history[0])).toBe(true);
  });

  it('попытка изменить результат падает (модули ESM работают в strict mode)', () => {
    const laptop = changeStatusOrThrow(inStock(), LaptopStatus.Reserved, { now: SALE_DATE });

    expect(() => {
      (laptop as { status: Status }).status = LaptopStatus.Sold;
    }).toThrow(TypeError);

    expect(() => {
      (laptop.history as unknown[]).push({});
    }).toThrow(TypeError);
  });

  it('createLaptop тоже отдаёт замороженный объект', () => {
    expect(Object.isFrozen(createLaptop({ id: 'nb-frozen' }))).toBe(true);
  });

  it('дата в журнале — копия: изменение переданного now историю не задевает', () => {
    const now = new Date(SALE_DATE);
    const laptop = changeStatusOrThrow(inStock(), LaptopStatus.Reserved, { now });

    now.setFullYear(1999);

    expect(laptop.history[0]?.at).toEqual(SALE_DATE);
  });

  /**
   * Это про ограничение платформы, не про желаемое поведение.
   *
   * `Object.freeze` морозить только свойства объекта, а `Date` держать время
   * во внутреннем слоте — заморозка его не закрыть. Поэтому неизменяемость
   * дат держаться на копировании, не на freeze. Нужна была бы и для уже
   * выданных наружу — журнал хранил бы ISO-строки вместо `Date`.
   */
  it('известное ограничение: Object.freeze не защищает внутреннее состояние Date', () => {
    const laptop = changeStatusOrThrow(inStock(), LaptopStatus.Reserved, { now: SALE_DATE });
    const storedDate = laptop.history[0]?.at as Date;

    expect(Object.isFrozen(storedDate)).toBe(false);
    storedDate.setFullYear(1999);
    expect(storedDate.getFullYear()).toBe(1999);
  });
});
