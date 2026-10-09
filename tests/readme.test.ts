/**
 * Пример из README, который правда бегает.
 *
 * README тоже часть работы. Документация разошлась с кодом — такая же ошибка,
 * как упавший тест. Поэтому пример не просто лежать в разметке, а гоняться
 * тут целиком: API изменится — упасть сборка, а не доверие читателя.
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
    // 1. Новый ноутбук приехать на склад.
    let laptop: Laptop = createLaptop({ id: 'nb-42' });
    expect(laptop.status).toBe('IN_STOCK');

    // 2. Продать 18 января.
    const sale = changeStatus(laptop, LaptopStatus.Sold, {
      now: new Date('2026-01-18T10:00:00.000Z'),
    });
    expect(sale.ok).toBe(true);
    if (!sale.ok) {
      return;
    }
    laptop = sale.value;

    // Вернуть можно до этого момента включительно.
    expect(returnDeadline(laptop)?.toISOString()).toBe('2026-02-01T10:00:00.000Z');

    // 3. Покупатель прийти через 20 дней — срок вышел.
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

    // 4. А через 5 дней всё хорошо, в журнале появиться вторая запись.
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
