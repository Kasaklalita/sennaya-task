/**
 * Условия на рёбрах графа — «когда можно», в дополнение к «куда можно».
 *
 * **Это единственный файл, который нужно открыть, чтобы изменить или добавить
 * условное правило перехода.** Граф живёт в `status.ts`, движок в
 * `changeStatus.ts` и про конкретные правила не знает ничего: он просто смотрит
 * в карту `GUARDS` по ключу ребра.
 *
 * Новое правило («бронь не дольше трёх дней», «списывать только со склада»)
 * добавляется сюда одной записью — тело движка при этом не меняется.
 */

import { LaptopStatus, type TransitionKey } from './status.js';
import { nowBeforeSale, returnWindowExpired } from './errors.js';
import { resolveSaleDate } from './laptop.js';
import { MS_IN_DAY } from './time.js';
import type { Laptop, TransitionError } from './types.js';

/** Срок возврата из ТЗ: «не позднее 14 дней после продажи». */
export const RETURN_WINDOW_DAYS = 14;

/**
 * Окно возврата считается фиксированными сутками (14 × 24 ч), а не календарными днями.
 *
 * Календарный вариант потребовал бы политики таймзоны («день» у склада в Москве и у
 * покупателя в Калининграде разный) и ломался бы на переходах на летнее время. В ТЗ
 * таймзона не задана, поэтому выбран детерминированный вариант; он же единственный,
 * который можно однозначно закрепить тестами. Подробнее — в README.
 */
const RETURN_WINDOW_MS = RETURN_WINDOW_DAYS * MS_IN_DAY;

/**
 * Условие на ребре. Возвращает `null`, если переход разрешён, иначе — ошибку.
 *
 * Сигнатура намеренно узкая: условию доступен агрегат и момент времени, но не
 * целевой статус — он уже известен из ключа в {@link GUARDS}.
 */
export type Guard = (laptop: Laptop, now: Date) => TransitionError | null;

/** «Продан → На складе»: возврат не позднее 14 дней после продажи. */
const returnWindowGuard: Guard = (laptop, now) => {
  const sale = resolveSaleDate(laptop);
  if (!sale.ok) {
    return sale.error;
  }

  const soldAt = sale.value;
  const msElapsed = now.getTime() - soldAt.getTime();

  // Отрицательное время — это не «успели вернуть», а испорченные данные
  // или рассинхрон часов. Такое надо показывать, а не тихо разрешать возврат.
  if (msElapsed < 0) {
    return nowBeforeSale(now, soldAt);
  }

  // Граница включительна: «не позднее 14 дней» читается как «≤ 14 дней»,
  // поэтому ровно 14 суток — ещё можно, 14 суток + 1 мс — уже нет.
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
 * Карта условий. Рёбра, которых здесь нет, разрешены безусловно.
 *
 * Ключ — ребро графа в виде `ОТКУДА->КУДА`; тип `TransitionKey` не даст
 * опечататься в статусе.
 */
export const GUARDS: Partial<Record<TransitionKey, Guard>> = {
  'SOLD->IN_STOCK': returnWindowGuard,
};

/**
 * До какого момента включительно возможен возврат, или `null`, если вопрос
 * неприменим (ноутбук не продан) либо дату продажи определить нельзя.
 *
 * Производная от того же правила, что и guard выше, поэтому живёт рядом с ним:
 * разъедутся они только вместе.
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
