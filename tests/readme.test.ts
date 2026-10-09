/**
 * Исполняемая копия примера из README.
 *
 * README — тоже часть сдаваемой работы, и расхождение документации с кодом
 * это такая же ошибка, как упавший тест. Поэтому пример не просто записан
 * в разметке, а прогоняется здесь целиком: если API изменится, упадёт сборка,
 * а не доверие читателя.
 */

import { describe, expect, it } from 'vitest';

import {
  LaptopStatus,
  changeStatus,
  createLaptop,
  returnDeadline,
  type Laptop,
} from '../src/index.js';

describe('пример из README', () => {
  it('работает ровно так, как написано', () => {
    // 1. Новый ноутбук приходит на склад.
    let laptop: Laptop = createLaptop({ id: 'nb-42' });
    expect(laptop.status).toBe('IN_STOCK');

    // 2. Продаём его 18 января.
    const sale = changeStatus(laptop, LaptopStatus.Sold, {
      now: new Date('2026-01-18T10:00:00.000Z'),
    });
    expect(sale.ok).toBe(true);
    if (!sale.ok) {
      return;
    }
    laptop = sale.value;

    // Возврат возможен до этого момента включительно.
    expect(returnDeadline(laptop)?.toISOString()).toBe('2026-02-01T10:00:00.000Z');

    // 3. Покупатель приходит через 20 дней — срок истёк.
    const late = changeStatus(laptop, LaptopStatus.InStock, {
      now: new Date('2026-02-07T10:00:00.000Z'),
    });
    expect(late.ok).toBe(false);
    if (late.ok) {
      return;
    }
    expect(late.error.code).toBe('RETURN_WINDOW_EXPIRED');
    expect(late.error.message).toBe(
      'Возврат невозможен: срок возврата истёк. ' +
        'Ноутбук продан 2026-01-18T10:00:00.000Z, ' +
        'вернуть его можно было не позднее 2026-02-01T10:00:00.000Z включительно, ' +
        'сейчас 2026-02-07T10:00:00.000Z.',
    );

    // 4. А через 5 дней — успешно, и в журнале появляется вторая запись.
    const inTime = changeStatus(laptop, LaptopStatus.InStock, {
      now: new Date('2026-01-23T10:00:00.000Z'),
    });
    expect(inTime.ok).toBe(true);
    if (!inTime.ok) {
      return;
    }
    expect(inTime.value.status).toBe('IN_STOCK');
    expect(inTime.value.history).toEqual([
      { from: 'IN_STOCK', to: 'SOLD', at: new Date('2026-01-18T10:00:00.000Z') },
      { from: 'SOLD', to: 'IN_STOCK', at: new Date('2026-01-23T10:00:00.000Z') },
    ]);
  });
});
