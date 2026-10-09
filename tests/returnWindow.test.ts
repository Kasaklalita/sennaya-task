import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LaptopStatus,
  MS_IN_DAY,
  RETURN_WINDOW_DAYS,
  allowedTransitionsFrom,
  availableTransitions,
  changeStatus,
  changeStatusOrThrow,
  createLaptop,
  isTerminalStatus,
  resolveSaleDate,
  returnDeadline,
  type Laptop,
  type StatusChange,
} from '../src/index.js';
import { SALE_DATE, after, days, inStock, sold } from './helpers.js';

/** Попробовать вернуть проданный в момент `now`. */
function tryReturn(laptop: Laptop, now: Date) {
  return changeStatus(laptop, LaptopStatus.InStock, { now });
}

describe('граница окна возврата (14 дней)', () => {
  const allowed: ReadonlyArray<[string, number]> = [
    ['в тот же миг', 0],
    ['через минуту', 60_000],
    ['за 1 мс до истечения срока', days(14) - 1],
    ['ровно через 14 суток — граница включительна', days(14)],
  ];

  it.each(allowed)('возврат разрешён %s', (_name, offsetMs) => {
    const result = tryReturn(sold(), after(SALE_DATE, offsetMs));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.status).toBe('IN_STOCK');
  });

  const rejected: ReadonlyArray<[string, number]> = [
    ['через 14 суток и 1 мс', days(14) + 1],
    ['через 15 суток', days(15)],
    ['через 100 суток', days(100)],
  ];

  it.each(rejected)('возврат запрещён %s', (_name, offsetMs) => {
    const result = tryReturn(sold(), after(SALE_DATE, offsetMs));

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('RETURN_WINDOW_EXPIRED');
  });

  it('ровно 14 суток — можно, 14 суток и 1 мс — уже нельзя', () => {
    const laptop = sold();

    expect(tryReturn(laptop, after(SALE_DATE, days(14))).ok).toBe(true);
    expect(tryReturn(laptop, after(SALE_DATE, days(14) + 1)).ok).toBe(false);
  });
});

describe('ошибка истёкшего срока', () => {
  it('содержит структурированные детали для UI', () => {
    const now = after(SALE_DATE, days(15));
    const result = tryReturn(sold(), now);

    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== 'RETURN_WINDOW_EXPIRED') {
      expect.unreachable('ожидалась ошибка RETURN_WINDOW_EXPIRED');
      return;
    }

    expect(result.error.soldAt).toEqual(SALE_DATE);
    expect(result.error.now).toEqual(now);
    expect(result.error.deadline).toEqual(after(SALE_DATE, days(RETURN_WINDOW_DAYS)));
    expect(result.error.windowDays).toBe(14);
    expect(result.error.msElapsed).toBe(15 * MS_IN_DAY);
    expect(result.error.daysElapsed).toBe(15);
  });

  it('сообщение называет дату продажи, крайний срок и текущий момент', () => {
    const result = tryReturn(sold(), after(SALE_DATE, days(15)));

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toBe(
      'Возврат невозможен: срок возврата истёк. ' +
        'Ноутбук продан 2026-01-18T10:00:00.000Z, ' +
        'вернуть его можно было не позднее 2026-02-01T10:00:00.000Z включительно, ' +
        'сейчас 2026-02-02T10:00:00.000Z.',
    );
  });

  it('daysElapsed дробный — округление остаётся за презентационным слоем', () => {
    const result = tryReturn(sold(), after(SALE_DATE, days(14.5)));

    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== 'RETURN_WINDOW_EXPIRED') {
      return;
    }
    expect(result.error.daysElapsed).toBe(14.5);
  });
});

describe('несколько циклов продажи', () => {
  it('срок считается от последней продажи, а не от первой', () => {
    const firstSale = SALE_DATE;
    const returnDate = after(firstSale, days(1));
    const secondSale = after(firstSale, days(30));

    let laptop = changeStatusOrThrow(inStock(), LaptopStatus.Sold, { now: firstSale });
    laptop = changeStatusOrThrow(laptop, LaptopStatus.InStock, { now: returnDate });
    laptop = changeStatusOrThrow(laptop, LaptopStatus.Sold, { now: secondSale });

    // 40 дней с первой продажи, но всего 10 со второй: можно.
    expect(tryReturn(laptop, after(firstSale, days(40))).ok).toBe(true);
    // 20 дней со второй продажи: срок вышел.
    expect(tryReturn(laptop, after(firstSale, days(50))).ok).toBe(false);
  });

  it('списать проданный ноутбук можно только через склад — так следует из ТЗ', () => {
    const sale = changeStatusOrThrow(inStock(), LaptopStatus.Sold, { now: SALE_DATE });

    // Прямого ребра «Продан» → «Списан» в ТЗ нет.
    expect(changeStatus(sale, LaptopStatus.WrittenOff, { now: SALE_DATE }).ok).toBe(false);

    // Значит путь один: вернуть на склад, оттуда списать.
    let laptop = changeStatusOrThrow(sale, LaptopStatus.InStock, {
      now: after(SALE_DATE, days(1)),
    });
    laptop = changeStatusOrThrow(laptop, LaptopStatus.Sold, { now: after(SALE_DATE, days(2)) });
    laptop = changeStatusOrThrow(laptop, LaptopStatus.InStock, {
      now: after(SALE_DATE, days(3)),
    });
    laptop = changeStatusOrThrow(laptop, LaptopStatus.WrittenOff, {
      now: after(SALE_DATE, days(4)),
    });

    expect(laptop.history.map((change) => `${change.from}->${change.to}`)).toEqual([
      'IN_STOCK->SOLD',
      'SOLD->IN_STOCK',
      'IN_STOCK->SOLD',
      'SOLD->IN_STOCK',
      'IN_STOCK->WRITTEN_OFF',
    ]);
  });
});

describe('фактический тупик: проданный ноутбук после истечения срока', () => {
  /**
   * Находка обхода автомата (invariants.test.ts): он застревать не в «Списан»,
   * а в «Продан».
   *
   * Из «Продан» по ТЗ одно ребро — возврат на склад. После 14 дней условие
   * закрыть его навсегда. Прямого «Продан → Списан» в ТЗ нет. Значит такой
   * ноутбук ни вернуть, ни списать — он остаться «Продан» навсегда.
   * Формально не конечный, фактически конечный. Тест закрепить поведение
   * как в ТЗ; вопрос вынести в README, а не «починить» домыслом.
   */
  it('нельзя ни вернуть, ни списать, хотя «Продан» формально не конечный статус', () => {
    const laptop = sold();
    const now = after(SALE_DATE, days(15));

    expect(availableTransitions(laptop, { now })).toEqual([]);
    expect(isTerminalStatus(laptop.status)).toBe(false);
    expect(allowedTransitionsFrom(laptop.status)).toEqual(['IN_STOCK']);

    for (const target of [LaptopStatus.Reserved, LaptopStatus.WrittenOff, LaptopStatus.InStock]) {
      expect(changeStatus(laptop, target, { now }).ok).toBe(false);
    }
  });
});

describe('откуда берётся дата продажи', () => {
  it('приоритет у истории, а не у поля soldAt', () => {
    const laptop = createLaptop({
      id: 'nb-imported',
      status: LaptopStatus.Sold,
      history: [{ from: 'IN_STOCK', to: 'SOLD', at: after(SALE_DATE, days(20)) }],
      soldAt: SALE_DATE,
    });

    // По истории прошло 5 дней (можно), по soldAt — 25 (было бы нельзя).
    expect(tryReturn(laptop, after(SALE_DATE, days(25))).ok).toBe(true);
  });

  it('soldAt используется как запасной источник для импортированных записей', () => {
    const laptop = createLaptop({
      id: 'nb-legacy',
      status: LaptopStatus.Sold,
      soldAt: SALE_DATE,
    });

    expect(tryReturn(laptop, after(SALE_DATE, days(3))).ok).toBe(true);
    expect(tryReturn(laptop, after(SALE_DATE, days(20))).ok).toBe(false);
  });

  it('без истории и без soldAt возвращает SALE_DATE_UNKNOWN, а не угадывает', () => {
    const laptop = createLaptop({ id: 'nb-mystery', status: LaptopStatus.Sold });

    const result = tryReturn(laptop, after(SALE_DATE, days(1)));

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('SALE_DATE_UNKNOWN');
    expect(result.error.message).toContain('Не удалось определить дату продажи');
  });

  it('resolveSaleDate отдаёт дату последней продажи', () => {
    const laptop = sold();
    const resolved = resolveSaleDate(laptop);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.value).toEqual(SALE_DATE);
    // Копия, не ссылка на дату внутри истории.
    expect(resolved.value).not.toBe(laptop.history[0]?.at);
  });

  it('resolveSaleDate сообщает об ошибке, если продажи не было', () => {
    expect(resolveSaleDate(inStock()).ok).toBe(false);
  });
});

describe('некорректные даты', () => {
  it('«сейчас» раньше даты продажи — это испорченные данные, а не успешный возврат', () => {
    // Запись без истории. Когда история есть, раньше срабатывать проверка
    // хронологии: последняя запись там и есть продажа. А эта ошибка нужна
    // для привезённых записей, где дата продажи лежать в soldAt.
    const imported = createLaptop({
      id: 'nb-legacy-clock',
      status: LaptopStatus.Sold,
      soldAt: SALE_DATE,
    });
    const now = after(SALE_DATE, -days(1));
    const result = tryReturn(imported, now);

    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== 'INVALID_DATE') {
      expect.unreachable('ожидалась ошибка INVALID_DATE');
      return;
    }
    expect(result.error.reason).toBe('now_before_sale');
    expect(result.error.field).toBe('now');
    expect(result.error.message).toContain('раньше даты продажи');
  });

  it('невалидный now отвергается до любых проверок автомата', () => {
    const result = changeStatus(inStock(), LaptopStatus.Reserved, { now: new Date(NaN) });

    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== 'INVALID_DATE') {
      return;
    }
    expect(result.error.field).toBe('now');
    expect(result.error.reason).toBe('not_a_date');
  });

  it('now, не являющийся Date (например, строка из JSON), тоже отвергается', () => {
    const result = changeStatus(inStock(), LaptopStatus.Reserved, {
      now: '2026-01-18T10:00:00.000Z' as unknown as Date,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('INVALID_DATE');
  });

  it('битая дата в истории даёт понятную ошибку, а не NaN в расчётах', () => {
    const broken: Laptop = {
      id: 'nb-broken',
      status: LaptopStatus.Sold,
      history: [{ from: 'IN_STOCK', to: 'SOLD', at: new Date(NaN) }],
    };

    const result = tryReturn(broken, SALE_DATE);

    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== 'INVALID_DATE') {
      return;
    }
    expect(result.error.field).toBe('history');
    expect(result.error.message).toContain('запись в истории');
  });

  it('дата из JSON, оставшаяся строкой, распознаётся как битая', () => {
    const fromJson: Laptop = {
      id: 'nb-json',
      status: LaptopStatus.Sold,
      history: [
        {
          from: 'IN_STOCK',
          to: 'SOLD',
          at: '2026-01-18T10:00:00.000Z' as unknown as Date,
        } as StatusChange,
      ],
    };

    const result = tryReturn(fromJson, after(SALE_DATE, days(1)));

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('INVALID_DATE');
  });

  it('битый soldAt даёт ошибку с указанием поля', () => {
    const broken: Laptop = {
      id: 'nb-broken-soldat',
      status: LaptopStatus.Sold,
      history: [],
      soldAt: new Date(NaN),
    };

    const result = tryReturn(broken, SALE_DATE);

    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== 'INVALID_DATE') {
      return;
    }
    expect(result.error.field).toBe('soldAt');
    expect(result.error.message).toContain('поле soldAt');
  });
});

describe('хронология журнала', () => {
  /**
   * Дыру вскрыть база: журнал переживать перезагрузку и читаться в порядке
   * записи, а в демо есть кнопка «−1 день». Без этой проверки можно получить
   * историю, где время идти вспять, — и тогда «последняя продажа» ПО МЕСТУ
   * в массиве перестать совпадать с последней ПО ВРЕМЕНИ.
   */
  it('нельзя записать переход задним числом — раньше последней записи', () => {
    const reserved = changeStatusOrThrow(inStock(), LaptopStatus.Reserved, { now: SALE_DATE });

    const result = changeStatus(reserved, LaptopStatus.Sold, {
      now: after(SALE_DATE, -days(1)),
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== 'INVALID_DATE') {
      expect.unreachable('ожидалась ошибка INVALID_DATE');
      return;
    }
    expect(result.error.reason).toBe('now_before_last_change');
    expect(result.error.message).toContain('Журнал изменений должен быть хронологическим');
  });

  it('тот же момент, что у последней записи, допустим — граница включительна', () => {
    const reserved = changeStatusOrThrow(inStock(), LaptopStatus.Reserved, { now: SALE_DATE });

    expect(changeStatus(reserved, LaptopStatus.Sold, { now: SALE_DATE }).ok).toBe(true);
    expect(
      changeStatus(reserved, LaptopStatus.Sold, { now: after(SALE_DATE, -1) }).ok,
    ).toBe(false);
  });

  it('при пустом журнале проверять нечего — любой момент подходит', () => {
    expect(
      changeStatus(inStock(), LaptopStatus.Sold, { now: new Date('2000-01-01T00:00:00.000Z') })
        .ok,
    ).toBe(true);
  });

  it('битая дата в журнале не блокирует переход, который от неё не зависит', () => {
    // Проверку хронологии пропустить, если сравнивать не с чем. Данные,
    // от которых переход правда зависеть, проверять там, где их читают.
    const broken: Laptop = {
      id: 'nb-broken-history',
      status: LaptopStatus.Reserved,
      history: [{ from: 'IN_STOCK', to: 'RESERVED', at: new Date(NaN) }],
    };

    expect(changeStatus(broken, LaptopStatus.Sold, { now: SALE_DATE }).ok).toBe(true);
  });
});

describe('returnDeadline', () => {
  it('для проданного ноутбука возвращает крайний срок возврата', () => {
    expect(returnDeadline(sold())).toEqual(after(SALE_DATE, days(14)));
  });

  it('для непроданного неприменим', () => {
    expect(returnDeadline(inStock())).toBeNull();
  });

  it('для проданного без известной даты продажи возвращает null', () => {
    expect(returnDeadline(createLaptop({ id: 'nb-x', status: LaptopStatus.Sold }))).toBeNull();
  });
});

describe('системные часы по умолчанию', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('возврат на 3-й день без options.now проходит', () => {
    vi.useFakeTimers();
    vi.setSystemTime(after(SALE_DATE, days(3)));

    const result = changeStatus(sold(), LaptopStatus.InStock);

    expect(result.ok).toBe(true);
  });

  it('возврат на 20-й день без options.now отклоняется', () => {
    vi.useFakeTimers();
    vi.setSystemTime(after(SALE_DATE, days(20)));

    const result = changeStatus(sold(), LaptopStatus.InStock);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('RETURN_WINDOW_EXPIRED');
  });
});
