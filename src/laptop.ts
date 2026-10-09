/**
 * Агрегат «ноутбук»: создать, прочитать, дописать в журнал.
 *
 * Правил переходов тут нет. Куда можно — status.ts, когда можно — rules.ts,
 * решать — changeStatus.ts.
 */

import { INITIAL_STATUS, LaptopStatus } from './status.js';
import { invalidSaleDate, saleDateUnknown } from './errors.js';
import { copyDate, isValidDate } from './time.js';
import { err, ok, type Laptop, type Result, type StatusChange, type TransitionError } from './types.js';

/** Копия записи с копией даты — чтобы снаружи нельзя было подсунуть алиас. */
function cloneChange(change: StatusChange): StatusChange {
  return Object.freeze({
    from: change.from,
    to: change.to,
    at: copyDate(change.at),
  });
}

export interface CreateLaptopInput {
  readonly id: string;
  /** По умолчанию {@link INITIAL_STATUS} — новый ноутбук ехать на склад. */
  readonly status?: LaptopStatus;
  readonly history?: readonly StatusChange[];
  /** Дата продажи для записей, привезённых без истории. */
  readonly soldAt?: Date;
}

/** Создать ноутбук: заморозить объект, скопировать все даты. */
export function createLaptop(input: CreateLaptopInput): Laptop {
  return Object.freeze({
    id: input.id,
    status: input.status ?? INITIAL_STATUS,
    history: Object.freeze((input.history ?? []).map(cloneChange)),
    ...(input.soldAt === undefined ? {} : { soldAt: copyDate(input.soldAt) }),
  });
}

/**
 * Найти дату продажи.
 *
 * История главнее. При цикле «продан → возврат → продан снова» срок считать
 * от ПОСЛЕДНЕЙ продажи. Поле `soldAt` — только запас для записей без истории:
 * два равноправных источника одной даты неизбежно разъехаться.
 *
 * Даты нет нигде — вернуть ошибку, не угадывать. «Проверить нельзя» и
 * «правило нарушено» — разные вещи.
 */
export function resolveSaleDate(laptop: Laptop): Result<Date, TransitionError> {
  const lastSale = laptop.history.findLast((change) => change.to === LaptopStatus.Sold);

  if (lastSale !== undefined) {
    return isValidDate(lastSale.at) ? ok(copyDate(lastSale.at)) : err(invalidSaleDate('history'));
  }

  if (laptop.soldAt !== undefined) {
    return isValidDate(laptop.soldAt)
      ? ok(copyDate(laptop.soldAt))
      : err(invalidSaleDate('soldAt'));
  }

  return err(saleDateUnknown());
}

/**
 * Дописать запись и вернуть новый агрегат.
 *
 * Зовёт только движок и только после того, как переход уже разрешён:
 * сама функция ничего не проверять.
 */
export function appendChange(
  laptop: Laptop,
  from: LaptopStatus,
  to: LaptopStatus,
  at: Date,
): Laptop {
  const change: StatusChange = Object.freeze({
    from,
    to,
    // Копия: вызывающий потом поменять свой объект даты — журнал не поехать.
    at: copyDate(at),
  });

  return Object.freeze({
    ...laptop,
    status: to,
    history: Object.freeze([...laptop.history, change]),
  });
}
