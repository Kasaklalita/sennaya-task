/**
 * Движок конечного автомата: смена статуса ноутбука.
 *
 * Разделение ответственности:
 *  - `ALLOWED_TRANSITIONS` (status.ts) отвечает на вопрос «куда можно» — структура графа;
 *  - `GUARDS` (здесь) отвечает на вопрос «когда можно» — условия на ребре;
 *  - `changeStatus` — универсальный движок, который про конкретные правила ничего не знает.
 *
 * Поэтому новое правило («нельзя бронировать дольше 3 дней», «списание только
 * со склада») добавляется данными — ребром в графе или guard'ом в карте, — а тело
 * `changeStatus` остаётся неизменным.
 */

import {
  LaptopStatus,
  allowedTransitionsFrom,
  isLaptopStatus,
  isTerminalStatus,
  transitionKey,
  type AllowedTarget,
  type TransitionKey,
} from './status.js';
import {
  StatusTransitionError,
  invalidNow,
  invalidSaleDate,
  nowBeforeLastChange,
  nowBeforeSale,
  returnWindowExpired,
  saleDateUnknown,
  sameStatus,
  terminalStatus,
  transitionNotAllowed,
  unknownStatus,
} from './errors.js';
import type {
  ChangeStatusOptions,
  Laptop,
  Result,
  StatusChange,
  TransitionError,
} from './types.js';

/** Срок возврата из ТЗ: «не позднее 14 дней после продажи». */
export const RETURN_WINDOW_DAYS = 14;

export const MS_IN_DAY = 24 * 60 * 60 * 1000;

/**
 * Окно возврата считается фиксированными сутками (14 × 24 ч), а не календарными днями.
 *
 * Календарный вариант потребовал бы политики таймзоны («день» у склада в Москве и у
 * покупателя в Калининграде разный) и ломался бы на переходах на летнее время. В ТЗ
 * таймзона не задана, поэтому выбран детерминированный вариант; он же единственный,
 * который можно однозначно закрепить тестами. Подробнее — в README.
 */
const RETURN_WINDOW_MS = RETURN_WINDOW_DAYS * MS_IN_DAY;

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Проверяет, что перед нами именно живая дата.
 *
 * Принимает `unknown`, а не `Date`, намеренно: на границе системы (JSON из запроса,
 * строка из БД) в поле типа `Date` вполне может оказаться строка — типы в рантайме
 * не существуют. `new Date('не дата')` тоже валиден по типу, но содержит `NaN`.
 */
function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Копия записи журнала с копией даты — чтобы на вход нельзя было подсунуть алиас. */
function cloneChange(change: StatusChange): StatusChange {
  return Object.freeze({
    from: change.from,
    to: change.to,
    at: new Date(change.at.getTime()),
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
    return isValidDate(lastSale.at)
      ? ok(new Date(lastSale.at.getTime()))
      : err(invalidSaleDate('history'));
  }

  if (laptop.soldAt !== undefined) {
    return isValidDate(laptop.soldAt)
      ? ok(new Date(laptop.soldAt.getTime()))
      : err(invalidSaleDate('soldAt'));
  }

  return err(saleDateUnknown());
}

/**
 * Условие на ребре графа. Возвращает `null`, если переход разрешён, иначе — ошибку.
 */
type Guard = (laptop: Laptop, now: Date) => TransitionError | null;

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

/** Условия на рёбрах. Рёбра без записи здесь разрешены безусловно. */
const GUARDS: Partial<Record<TransitionKey, Guard>> = {
  'SOLD->IN_STOCK': returnWindowGuard,
};

function appendChange(laptop: Laptop, from: LaptopStatus, to: LaptopStatus, now: Date): Laptop {
  const change: StatusChange = Object.freeze({
    from,
    to,
    // Копия: если вызывающий потом поменяет переданный ему объект `now`,
    // запись в журнале не должна «поехать».
    at: new Date(now.getTime()),
  });

  return Object.freeze({
    ...laptop,
    status: to,
    history: Object.freeze([...laptop.history, change]),
  });
}

/**
 * Меняет статус ноутбука.
 *
 * Чистая функция: входной объект не мутируется, возвращается новый замороженный
 * `Laptop` с дописанной записью журнала. Ошибка возвращается, а не бросается
 * (ТЗ: «недопустимый переход возвращает понятную ошибку»); компилятор не даст
 * обратиться к `result.value`, не проверив `result.ok`.
 *
 * Порядок проверок зафиксирован тестами, потому что он определяет, какую именно
 * из нескольких одновременно применимых ошибок увидит пользователь. Он идёт
 * от самых грубых нарушений к самым тонким:
 *
 *   1. `UNKNOWN_STATUS` — значения вообще не из перечисления;
 *   2. `INVALID_DATE` — непригодные часы;
 *   3. `SAME_STATUS` — переход в тот же статус (частая ошибка интеграции,
 *      поэтому отдельное понятное сообщение, а не общее «переход запрещён»);
 *   4. `TERMINAL_STATUS` — уход из конечного статуса;
 *   5. `TRANSITION_NOT_ALLOWED` — ребра нет в графе;
 *   6. guard — ребро есть, но условие не выполнено.
 *
 * @example
 * ```ts
 * const result = changeStatus(laptop, LaptopStatus.Sold);
 * if (!result.ok) {
 *   console.error(result.error.message);
 * } else {
 *   console.log(result.value.status, result.value.history.length);
 * }
 * ```
 */
export function changeStatus(
  laptop: Laptop,
  to: LaptopStatus,
  options: ChangeStatusOptions = {},
): Result<Laptop, TransitionError> {
  const from = laptop.status;

  // Данные с границы системы: TypeScript не защищает от того, что пришло из JSON.
  if (!isLaptopStatus(from)) {
    return err(unknownStatus('laptop.status', from));
  }
  if (!isLaptopStatus(to)) {
    return err(unknownStatus('to', to));
  }

  const now = options.now ?? new Date();
  if (!isValidDate(now)) {
    return err(invalidNow());
  }

  // Журнал обязан быть хронологическим: иначе «последняя продажа» по позиции
  // в массиве перестаёт совпадать с последней по времени, и восстановление
  // истории из хранилища в порядке записи даёт не тот порядок, что по датам.
  const lastChange = laptop.history.at(-1);
  if (
    lastChange !== undefined &&
    isValidDate(lastChange.at) &&
    now.getTime() < lastChange.at.getTime()
  ) {
    return err(nowBeforeLastChange(now, lastChange.at));
  }

  if (from === to) {
    return err(sameStatus(from));
  }
  if (isTerminalStatus(from)) {
    return err(terminalStatus(from, to));
  }
  if (!allowedTransitionsFrom(from).includes(to)) {
    return err(transitionNotAllowed(from, to));
  }

  const violation = GUARDS[transitionKey(from, to)]?.(laptop, now) ?? null;
  if (violation !== null) {
    return err(violation);
  }

  return ok(appendChange(laptop, from, to, now));
}

/**
 * Версия `changeStatus` с проверкой перехода **на этапе компиляции**.
 *
 * Работает, когда статус известен типу как литерал: тогда `to` ограничен
 * вычисленным из графа множеством `AllowedTarget<From>`.
 *
 * ```ts
 * changeStatusStrict(soldLaptop, 'WRITTEN_OFF');  // ошибка компиляции
 * changeStatusStrict(writtenOffLaptop, ???);      // позвать невозможно: AllowedTarget = never
 * ```
 *
 * Рантайм-проверки при этом никуда не деваются: статус почти всегда приходит из БД
 * или запроса как обычный `LaptopStatus`, и тогда работает основная `changeStatus`.
 * Это второй, бесплатный уровень защиты, а не замена первому.
 */
export function changeStatusStrict<From extends LaptopStatus>(
  laptop: Laptop & { readonly status: From },
  to: AllowedTarget<From>,
  options: ChangeStatusOptions = {},
): Result<Laptop, TransitionError> {
  return changeStatus(laptop, to, options);
}

/**
 * То же, что `changeStatus`, но бросает `StatusTransitionError` вместо возврата ошибки.
 * Для кода, которому удобнее `try/catch`; вся структурированная информация
 * об ошибке доступна в `error.details`.
 */
export function changeStatusOrThrow(
  laptop: Laptop,
  to: LaptopStatus,
  options: ChangeStatusOptions = {},
): Laptop {
  const result = changeStatus(laptop, to, options);
  if (!result.ok) {
    throw new StatusTransitionError(result.error);
  }
  return result.value;
}

/** Возможен ли переход прямо сейчас — с учётом guard'ов. */
export function canChangeStatus(
  laptop: Laptop,
  to: LaptopStatus,
  options: ChangeStatusOptions = {},
): boolean {
  return changeStatus(laptop, to, options).ok;
}

/**
 * Переходы, доступные **фактически**: ребро есть в графе и guard пропускает.
 *
 * Отличается от `allowedTransitionsFrom()`, которая смотрит только на структуру графа.
 * Нужна интерфейсу: проданный ноутбук на 20-й день формально имеет ребро «На складе»,
 * но кнопку «Вернуть» показывать уже нельзя.
 */
export function availableTransitions(
  laptop: Laptop,
  options: ChangeStatusOptions = {},
): readonly LaptopStatus[] {
  return allowedTransitionsFrom(laptop.status).filter((to) =>
    canChangeStatus(laptop, to, options),
  );
}

/**
 * До какого момента включительно возможен возврат, или `null`, если вопрос
 * неприменим (ноутбук не продан) либо дату продажи определить нельзя.
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

export interface CreateLaptopInput {
  readonly id: string;
  /** По умолчанию «На складе» — статус нового ноутбука на складе. */
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
    status: input.status ?? LaptopStatus.InStock,
    history: Object.freeze((input.history ?? []).map(cloneChange)),
    ...(input.soldAt === undefined ? {} : { soldAt: new Date(input.soldAt.getTime()) }),
  });
}
