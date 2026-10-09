/**
 * Движок автомата.
 *
 * Про конкретные правила не знать ничего — и это проверяемо: ниже нет ни «14»,
 * ни одного статуса. Движок задавать четыре вопроса и слушаться ответ:
 *
 *  1. это вообще статусы?         — isLaptopStatus (status.ts)
 *  2. куда можно отсюда?          — граф ALLOWED_TRANSITIONS (status.ts)
 *  3. условие ребра выполнено?    — карта GUARDS (rules.ts)
 *  4. как дописать журнал?        — appendChange (laptop.ts)
 *
 * Новое правило добавлять данными. Тело changeStatus не трогать.
 */

import {
  LaptopStatus,
  allowedTransitionsFrom,
  isLaptopStatus,
  isTerminalStatus,
  transitionKey,
  type AllowedTarget,
} from './status.js';
import {
  StatusTransitionError,
  invalidNow,
  nowBeforeLastChange,
  sameStatus,
  terminalStatus,
  transitionNotAllowed,
  unknownStatus,
} from './errors.js';
import { appendChange } from './laptop.js';
import { GUARDS } from './rules.js';
import { isValidDate } from './time.js';
import { err, ok, type ChangeStatusOptions, type Laptop, type Result, type TransitionError } from './types.js';

/**
 * Поменять статус.
 *
 * Чистая: вход не трогать, вернуть новый замороженный Laptop с дописанной
 * записью. Ошибку ВЕРНУТЬ, не бросить (так в ТЗ). Компилятор не дать взять
 * `result.value`, пока не проверил `result.ok`.
 *
 * Порядок проверок закреплён тестом: он решать, какую из нескольких подходящих
 * ошибок увидеть человек. Идти от грубого к тонкому:
 *
 *   1. UNKNOWN_STATUS        — это вообще не статус
 *   2. INVALID_DATE          — часы кривые или запись задним числом
 *   3. SAME_STATUS           — тот же статус (частая ошибка интеграции,
 *                              поэтому свой текст, а не общий «нельзя»)
 *   4. TERMINAL_STATUS       — уход из конечного
 *   5. TRANSITION_NOT_ALLOWED — ребра в графе нет
 *   6. условие ребра         — ребро есть, условие не выполнено
 *
 * @example
 * ```ts
 * const result = changeStatus(laptop, LaptopStatus.Sold);
 * if (!result.ok) console.error(result.error.message);
 * ```
 */
export function changeStatus(
  laptop: Laptop,
  to: LaptopStatus,
  options: ChangeStatusOptions = {},
): Result<Laptop, TransitionError> {
  const from = laptop.status;

  // Граница системы. TypeScript не защищать от того, что прийти из JSON.
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

  // Журнал обязан идти по времени вперёд. Иначе «последняя продажа» по месту
  // в массиве перестать совпадать с последней по дате, а чтение из БД
  // в порядке записи дать не тот порядок.
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
 * То же, но переход проверять КОМПИЛЯТОР.
 *
 * Работать, когда тип знать статус как литерал: тогда `to` ограничен
 * вычисленным из графа `AllowedTarget<From>`.
 *
 * ```ts
 * changeStatusStrict(soldLaptop, 'WRITTEN_OFF'); // ошибка компиляции
 * changeStatusStrict(writtenOffLaptop, ???);     // позвать нельзя: AllowedTarget = never
 * ```
 *
 * Рантайм-проверка никуда не деться: статус почти всегда прийти из БД обычным
 * LaptopStatus. Это второй уровень защиты, бесплатный, а не замена первому.
 */
export function changeStatusStrict<From extends LaptopStatus>(
  laptop: Laptop & { readonly status: From },
  to: AllowedTarget<From>,
  options: ChangeStatusOptions = {},
): Result<Laptop, TransitionError> {
  return changeStatus(laptop, to, options);
}

/**
 * То же, но бросать StatusTransitionError вместо возврата ошибки.
 * Для кода, которому удобнее try/catch. Вся структура ошибки в `error.details`.
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

/** Переход возможен прямо сейчас? Условия на рёбрах учитывать. */
export function canChangeStatus(
  laptop: Laptop,
  to: LaptopStatus,
  options: ChangeStatusOptions = {},
): boolean {
  return changeStatus(laptop, to, options).ok;
}

/**
 * Куда можно ФАКТИЧЕСКИ: ребро есть И условие пропускать.
 *
 * Не то же, что allowedTransitionsFrom() — та смотреть только граф.
 * Нужно интерфейсу: проданный на 20-й день ребро «На складе» иметь,
 * а кнопку «Вернуть» показывать уже нельзя.
 */
export function availableTransitions(
  laptop: Laptop,
  options: ChangeStatusOptions = {},
): readonly LaptopStatus[] {
  return allowedTransitionsFrom(laptop.status).filter((to) =>
    canChangeStatus(laptop, to, options),
  );
}
