/**
 * Агрегат «ноутбук»: как его создать, как прочитать и как дописать в журнал.
 *
 * Здесь нет ни одного правила переходов — только операции над самим объектом.
 * Куда можно ходить, описывает граф (status.ts), при каких условиях —
 * условия на рёбрах (rules.ts), а решение принимает движок (changeStatus.ts).
 */

import { INITIAL_STATUS, LaptopStatus } from './status.js';
import { invalidSaleDate, saleDateUnknown } from './errors.js';
import { copyDate, isValidDate } from './time.js';
import { err, ok, type Laptop, type Result, type StatusChange, type TransitionError } from './types.js';

/** Копия записи журнала с копией даты — чтобы на вход нельзя было подсунуть алиас. */
function cloneChange(change: StatusChange): StatusChange {
  return Object.freeze({
    from: change.from,
    to: change.to,
    at: copyDate(change.at),
  });
}

export interface CreateLaptopInput {
  readonly id: string;
  /** По умолчанию {@link INITIAL_STATUS} — новый ноутбук приезжает на склад. */
  readonly status?: LaptopStatus;
  readonly history?: readonly StatusChange[];
  /** Дата продажи для записей, импортированных без истории. */
  readonly soldAt?: Date;
}

/**
 * Конструктор ноутбука: замораживает результат и копирует все даты,
 * чтобы внешние объекты не оставались алиасами внутреннего состояния.
 */
export function createLaptop(input: CreateLaptopInput): Laptop {
  return Object.freeze({
    id: input.id,
    status: input.status ?? INITIAL_STATUS,
    history: Object.freeze((input.history ?? []).map(cloneChange)),
    ...(input.soldAt === undefined ? {} : { soldAt: copyDate(input.soldAt) }),
  });
}

/**
 * Определяет дату продажи.
 *
 * Приоритет у истории: она — единственный источник истины, и при нескольких циклах
 * «продан → возврат → продан снова» окно должно считаться от **последней** продажи.
 * Отдельное поле `soldAt` поддерживается только как запасной источник для записей,
 * импортированных из внешней системы без истории, — иначе два источника даты
 * неизбежно рассинхронизируются.
 *
 * Если даты нет нигде — возвращается ошибка, а не «молчаливое разрешить/запретить»:
 * невозможность проверить правило это не то же самое, что нарушение правила.
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
 * Дописывает запись в журнал и возвращает новый агрегат.
 *
 * Вызывается только движком и только после того, как переход уже разрешён:
 * сама функция ничего не проверяет.
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
    // Копия: если вызывающий потом поменяет переданный ему объект даты,
    // запись в журнале не должна «поехать».
    at: copyDate(at),
  });

  return Object.freeze({
    ...laptop,
    status: to,
    history: Object.freeze([...laptop.history, change]),
  });
}
