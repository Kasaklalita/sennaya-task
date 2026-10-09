/**
 * Общие фикстуры для тестов.
 *
 * Ноутбуки в нужных статусах собираются **самим автоматом** (через
 * `changeStatusOrThrow`), а не конструируются руками. Так история получается
 * настоящей, и тест не может случайно опереться на невозможное состояние.
 */

import { MS_IN_DAY, changeStatusOrThrow, createLaptop, type Laptop } from '../src/index.js';

/** Фиксированная точка отсчёта: тесты не должны зависеть от реального времени. */
export const SALE_DATE = new Date('2026-01-18T10:00:00.000Z');

export function days(count: number): number {
  return count * MS_IN_DAY;
}

export function after(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

export function inStock(): Laptop {
  return createLaptop({ id: 'nb-1' });
}

export function reserved(): Laptop {
  return changeStatusOrThrow(inStock(), 'RESERVED', { now: SALE_DATE });
}

export function sold(saleDate: Date = SALE_DATE): Laptop {
  return changeStatusOrThrow(inStock(), 'SOLD', { now: saleDate });
}

export function writtenOff(): Laptop {
  return changeStatusOrThrow(inStock(), 'WRITTEN_OFF', { now: SALE_DATE });
}
