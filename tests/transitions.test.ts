import { describe, expect, it } from 'vitest';

import {
  ALL_STATUSES,
  LaptopStatus,
  STATUS_LABELS,
  allowedTransitionsFrom,
  availableTransitions,
  changeStatus,
  changeStatusOrThrow,
  canChangeStatus,
  createLaptop,
  isLaptopStatus,
  isTerminalStatus,
  statusLabel,
  transitionKey,
  StatusTransitionError,
  type Laptop,
} from '../src/index.js';
import { SALE_DATE, after, days, inStock, reserved, sold, writtenOff } from './helpers.js';

/**
 * Таблица ожиданий переписана руками прямо из ТЗ и НЕ выводится из
 * `ALLOWED_TRANSITIONS`.
 *
 * Это принципиально: тест, построенный на том же графе, что и проверяемый код,
 * не поймал бы ошибку в самом графе — он бы её добросовестно повторил. Здесь же
 * расхождение между ТЗ и реализацией сразу роняет сборку.
 */
const EXPECTED_ALLOWED: Record<LaptopStatus, Record<LaptopStatus, boolean>> = {
  // ТЗ: «На складе → Бронь, Продан, Списан»
  IN_STOCK: { IN_STOCK: false, RESERVED: true, SOLD: true, WRITTEN_OFF: true },
  // ТЗ: «Бронь → На складе, Продан»
  RESERVED: { IN_STOCK: true, RESERVED: false, SOLD: true, WRITTEN_OFF: false },
  // ТЗ: «Продан → На складе (возврат не позднее 14 дней после продажи)»
  SOLD: { IN_STOCK: true, RESERVED: false, SOLD: false, WRITTEN_OFF: false },
  // ТЗ: «Списан — дальше никуда»
  WRITTEN_OFF: { IN_STOCK: false, RESERVED: false, SOLD: false, WRITTEN_OFF: false },
};

/** Какую именно ошибку обязан увидеть пользователь — тоже выведено из ТЗ, не из кода. */
function expectedErrorCode(from: LaptopStatus, to: LaptopStatus): string {
  if (from === to) {
    return 'SAME_STATUS';
  }
  if (from === LaptopStatus.WrittenOff) {
    return 'TERMINAL_STATUS';
  }
  return 'TRANSITION_NOT_ALLOWED';
}

const FIXTURES: Record<LaptopStatus, () => Laptop> = {
  IN_STOCK: inStock,
  RESERVED: reserved,
  SOLD: () => sold(),
  WRITTEN_OFF: writtenOff,
};

/** «Сейчас» внутри окна возврата: матрица проверяет структуру графа, а не сроки. */
const NOW_WITHIN_WINDOW = after(SALE_DATE, days(1));

const ALL_PAIRS: ReadonlyArray<[LaptopStatus, LaptopStatus]> = ALL_STATUSES.flatMap((from) =>
  ALL_STATUSES.map((to): [LaptopStatus, LaptopStatus] => [from, to]),
);

describe('матрица переходов 4×4', () => {
  it('покрывает все 16 пар статусов', () => {
    expect(ALL_PAIRS).toHaveLength(16);
  });

  it.each(ALL_PAIRS)('«%s» → «%s» соответствует таблице из ТЗ', (from, to) => {
    const result = changeStatus(FIXTURES[from](), to, { now: NOW_WITHIN_WINDOW });

    expect(result.ok).toBe(EXPECTED_ALLOWED[from][to]);
  });

  it.each(ALL_PAIRS.filter(([from, to]) => !EXPECTED_ALLOWED[from][to]))(
    'запрещённый переход «%s» → «%s» возвращает ожидаемый код ошибки',
    (from, to) => {
      const result = changeStatus(FIXTURES[from](), to, { now: NOW_WITHIN_WINDOW });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe(expectedErrorCode(from, to));
      expect(result.error.message.length).toBeGreaterThan(0);
    },
  );

  it.each(ALL_STATUSES)(
    'граф переходов из «%s» совпадает с таблицей ТЗ по составу',
    (from) => {
      const expected = ALL_STATUSES.filter(
        (to) => EXPECTED_ALLOWED[from][to] && to !== from,
      );

      expect([...allowedTransitionsFrom(from)].sort()).toEqual([...expected].sort());
    },
  );
});

describe('успешный переход', () => {
  const allowedPairs = ALL_PAIRS.filter(([from, to]) => EXPECTED_ALLOWED[from][to]);

  it.each(allowedPairs)('«%s» → «%s» меняет статус и дописывает историю', (from, to) => {
    const before = FIXTURES[from]();
    const result = changeStatus(before, to, { now: NOW_WITHIN_WINDOW });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const after_ = result.value;
    expect(after_.status).toBe(to);
    expect(after_.id).toBe(before.id);
    expect(after_.history).toHaveLength(before.history.length + 1);

    const entry = after_.history.at(-1);
    expect(entry).toEqual({ from, to, at: NOW_WITHIN_WINDOW });
  });

  it('запись истории содержит ровно три поля из ТЗ: from, to, at', () => {
    const result = changeStatus(inStock(), LaptopStatus.Reserved, { now: SALE_DATE });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(Object.keys(result.value.history[0] ?? {}).sort()).toEqual(['at', 'from', 'to']);
  });

  it('накапливает историю по всей цепочке переходов', () => {
    const t1 = after(SALE_DATE, days(1));
    const t2 = after(SALE_DATE, days(2));
    const t3 = after(SALE_DATE, days(3));

    let laptop = inStock();
    laptop = changeStatusOrThrow(laptop, LaptopStatus.Reserved, { now: t1 });
    laptop = changeStatusOrThrow(laptop, LaptopStatus.Sold, { now: t2 });
    laptop = changeStatusOrThrow(laptop, LaptopStatus.InStock, { now: t3 });

    expect(laptop.status).toBe(LaptopStatus.InStock);
    expect(laptop.history).toEqual([
      { from: 'IN_STOCK', to: 'RESERVED', at: t1 },
      { from: 'RESERVED', to: 'SOLD', at: t2 },
      { from: 'SOLD', to: 'IN_STOCK', at: t3 },
    ]);
  });

  it('использует системные часы, если now не передан', () => {
    const before = Date.now();
    const result = changeStatus(inStock(), LaptopStatus.Reserved);
    const afterCall = Date.now();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const at = result.value.history[0]?.at.getTime() ?? 0;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(afterCall);
  });
});

describe('сообщения об ошибках', () => {
  it('недопустимый переход называет оба статуса и перечисляет доступные', () => {
    const result = changeStatus(reserved(), LaptopStatus.WrittenOff, { now: SALE_DATE });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('TRANSITION_NOT_ALLOWED');
    expect(result.error.message).toBe(
      'Недопустимый переход: «Бронь» → «Списан». ' +
        'Доступные переходы из статуса «Бронь»: «На складе», «Продан».',
    );
    if (result.error.code === 'TRANSITION_NOT_ALLOWED') {
      expect(result.error.allowed).toEqual(['IN_STOCK', 'SOLD']);
    }
  });

  it('уход из конечного статуса объясняет, что статус конечный', () => {
    const result = changeStatus(writtenOff(), LaptopStatus.InStock, { now: SALE_DATE });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('TERMINAL_STATUS');
    expect(result.error.message).toBe(
      'Недопустимый переход: «Списан» → «На складе». ' +
        'Статус «Списан» конечный — из него переходы невозможны.',
    );
  });

  it('переход в тот же статус даёт отдельное понятное сообщение', () => {
    const result = changeStatus(reserved(), LaptopStatus.Reserved, { now: SALE_DATE });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('SAME_STATUS');
    expect(result.error.message).toBe(
      'Ноутбук уже в статусе «Бронь»: переход в тот же статус не предусмотрен.',
    );
  });

  it.each([
    ['строка не из перечисления', 'BROKEN', 'целевой статус равен "BROKEN"'],
    ['значение не строка', 42, 'целевой статус равен 42'],
  ])('отвергает неизвестный целевой статус: %s', (_name, received, fragment) => {
    const result = changeStatus(inStock(), received as LaptopStatus, { now: SALE_DATE });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('UNKNOWN_STATUS');
    expect(result.error.message).toContain(fragment);
    expect(result.error.message).toContain('IN_STOCK, RESERVED, SOLD, WRITTEN_OFF');
  });

  it('отвергает неизвестный текущий статус ноутбука', () => {
    const broken = { id: 'nb-x', status: 'LOST' as LaptopStatus, history: [] };

    const result = changeStatus(broken, LaptopStatus.Reserved, { now: SALE_DATE });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('UNKNOWN_STATUS');
    expect(result.error.message).toContain('текущий статус ноутбука равен "LOST"');
    if (result.error.code === 'UNKNOWN_STATUS') {
      expect(result.error.field).toBe('laptop.status');
      expect(result.error.allowedValues).toEqual(ALL_STATUSES);
    }
  });
});

describe('changeStatusOrThrow', () => {
  it('возвращает новый ноутбук при успехе', () => {
    expect(changeStatusOrThrow(inStock(), LaptopStatus.Sold, { now: SALE_DATE }).status).toBe(
      'SOLD',
    );
  });

  it('бросает StatusTransitionError и сохраняет структуру ошибки', () => {
    try {
      changeStatusOrThrow(writtenOff(), LaptopStatus.Sold, { now: SALE_DATE });
      expect.unreachable('ожидалось исключение');
    } catch (error) {
      expect(error).toBeInstanceOf(StatusTransitionError);
      expect(error).toBeInstanceOf(Error);
      const typed = error as StatusTransitionError;
      expect(typed.name).toBe('StatusTransitionError');
      expect(typed.code).toBe('TERMINAL_STATUS');
      expect(typed.message).toBe(typed.details.message);
      expect(typed.details.code).toBe('TERMINAL_STATUS');
    }
  });
});

describe('canChangeStatus и availableTransitions', () => {
  it('canChangeStatus повторяет решение changeStatus', () => {
    expect(canChangeStatus(inStock(), LaptopStatus.Sold, { now: SALE_DATE })).toBe(true);
    expect(canChangeStatus(inStock(), LaptopStatus.InStock, { now: SALE_DATE })).toBe(false);
  });

  it('canChangeStatus работает и без options', () => {
    expect(canChangeStatus(inStock(), LaptopStatus.Reserved)).toBe(true);
  });

  it('availableTransitions учитывает guard: возврат исчезает после 14 дней', () => {
    const laptop = sold();

    expect(availableTransitions(laptop, { now: after(SALE_DATE, days(14)) })).toEqual([
      'IN_STOCK',
    ]);
    expect(availableTransitions(laptop, { now: after(SALE_DATE, days(15)) })).toEqual([]);
  });

  it('availableTransitions без options опирается на системные часы', () => {
    expect(availableTransitions(inStock())).toEqual(['RESERVED', 'SOLD', 'WRITTEN_OFF']);
  });

  it('у конечного статуса доступных переходов нет', () => {
    expect(availableTransitions(writtenOff(), { now: SALE_DATE })).toEqual([]);
  });
});

describe('вспомогательные функции автомата', () => {
  it('isTerminalStatus выводится из графа, а не зашит строкой', () => {
    expect(isTerminalStatus(LaptopStatus.WrittenOff)).toBe(true);
    expect(isTerminalStatus(LaptopStatus.Sold)).toBe(false);
  });

  it('isLaptopStatus отсеивает значения с границы системы', () => {
    expect(isLaptopStatus('SOLD')).toBe(true);
    expect(isLaptopStatus('sold')).toBe(false);
    expect(isLaptopStatus(undefined)).toBe(false);
    expect(isLaptopStatus({ status: 'SOLD' })).toBe(false);
  });

  it('подписи статусов совпадают с формулировками ТЗ', () => {
    expect(STATUS_LABELS).toEqual({
      IN_STOCK: 'На складе',
      RESERVED: 'Бронь',
      SOLD: 'Продан',
      WRITTEN_OFF: 'Списан',
    });
    expect(statusLabel(LaptopStatus.InStock)).toBe('На складе');
  });

  it('transitionKey формирует ключ ребра', () => {
    expect(transitionKey(LaptopStatus.Sold, LaptopStatus.InStock)).toBe('SOLD->IN_STOCK');
  });
});

describe('createLaptop', () => {
  it('по умолчанию создаёт ноутбук на складе с пустой историей', () => {
    const laptop = createLaptop({ id: 'nb-7' });

    expect(laptop).toEqual({ id: 'nb-7', status: 'IN_STOCK', history: [] });
  });

  it('принимает явный статус, историю и soldAt', () => {
    const laptop = createLaptop({
      id: 'nb-8',
      status: LaptopStatus.Sold,
      history: [{ from: 'IN_STOCK', to: 'SOLD', at: SALE_DATE }],
      soldAt: SALE_DATE,
    });

    expect(laptop.status).toBe('SOLD');
    expect(laptop.history).toHaveLength(1);
    expect(laptop.soldAt).toEqual(SALE_DATE);
  });

  it('копирует переданные даты, а не держит их алиасами', () => {
    const mutable = new Date(SALE_DATE);
    const laptop = createLaptop({
      id: 'nb-9',
      status: LaptopStatus.Sold,
      history: [{ from: 'IN_STOCK', to: 'SOLD', at: mutable }],
      soldAt: mutable,
    });

    mutable.setFullYear(1999);

    expect(laptop.history[0]?.at).toEqual(SALE_DATE);
    expect(laptop.soldAt).toEqual(SALE_DATE);
  });
});
