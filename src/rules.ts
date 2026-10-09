/**
 * Условия на рёбрах — «когда можно», в дополнение к «куда можно».
 *
 * **Это единственный файл, который открывать, чтобы менять условное правило.**
 * Граф лежать в status.ts, движок в changeStatus.ts и про правила не знать:
 * он просто смотреть в карту GUARDS по ключу ребра.
 *
 * Новое правило («бронь не дольше трёх дней») добавлять сюда одной записью —
 * тело движка не трогать.
 */

import { LaptopStatus, type TransitionKey } from './status.js';
import { nowBeforeSale, returnWindowExpired } from './errors.js';
import { resolveSaleDate } from './laptop.js';
import { MS_IN_DAY } from './time.js';
import type { Laptop, TransitionError } from './types.js';

/** Срок возврата из ТЗ: «не позднее 14 дней после продажи». */
export const RETURN_WINDOW_DAYS = 14;

/**
 * Окно считать фиксированными сутками (14 × 24 ч), не календарными днями.
 *
 * Календарный вариант требовать политику таймзоны (у склада в Москве и
 * покупателя в Калининграде «день» разный) и ломаться на переходе на летнее
 * время. В ТЗ таймзоны нет. Фиксированные сутки — единственное, что можно
 * однозначно закрепить тестом.
 */
const RETURN_WINDOW_MS = RETURN_WINDOW_DAYS * MS_IN_DAY;

/**
 * Условие на ребре. `null` — можно, иначе ошибка.
 *
 * Целевой статус не передавать: он уже известен из ключа в {@link GUARDS}.
 */
export type Guard = (laptop: Laptop, now: Date) => TransitionError | null;

/** «Продан → На складе»: возврат не позднее 14 дней. */
const returnWindowGuard: Guard = (laptop, now) => {
  const sale = resolveSaleDate(laptop);
  if (!sale.ok) {
    return sale.error;
  }

  const soldAt = sale.value;
  const msElapsed = now.getTime() - soldAt.getTime();

  // Время отрицательное — это не «успели вернуть», а битые данные или
  // кривые часы. Такое показывать, а не тихо разрешать возврат.
  if (msElapsed < 0) {
    return nowBeforeSale(now, soldAt);
  }

  // Граница включительна: «не позднее 14 дней» = «≤ 14 дней».
  // Ровно 14 суток — можно. 14 суток и 1 мс — нельзя.
  if (msElapsed > RETURN_WINDOW_MS) {
    return returnWindowExpired({
      soldAt,
      now,
      deadline: new Date(soldAt.getTime() + RETURN_WINDOW_MS),
      windowDays: RETURN_WINDOW_DAYS,
      msElapsed,
      daysElapsed: msElapsed / MS_IN_DAY,
    });
  }

  return null;
};

/**
 * Карта условий. Ребро, которого тут нет, разрешено без условий.
 *
 * Ключ — ребро `ОТКУДА->КУДА`. Тип `TransitionKey` не дать опечататься в статусе.
 */
export const GUARDS: Partial<Record<TransitionKey, Guard>> = {
  'SOLD->IN_STOCK': returnWindowGuard,
};

/**
 * До какого момента можно вернуть. `null` — вопрос неуместен (не продан)
 * или дату продажи не найти.
 *
 * Растёт из того же правила, что и guard выше, поэтому лежать рядом:
 * разъехаться они смогут только вместе.
 */
export function returnDeadline(laptop: Laptop): Date | null {
  if (laptop.status !== LaptopStatus.Sold) {
    return null;
  }

  const sale = resolveSaleDate(laptop);
  if (!sale.ok) {
    return null;
  }

  return new Date(sale.value.getTime() + RETURN_WINDOW_MS);
}
