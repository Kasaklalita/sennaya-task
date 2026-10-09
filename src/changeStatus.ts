/**
 * Движок конечного автомата.
 *
 * Про конкретные правила этот файл не знает ничего — и это проверяемо: ниже нет
 * ни упоминания четырнадцати дней, ни одного статуса, кроме как в типах.
 * Движок задаёт четыре вопроса и исполняет ответы:
 *
 *  1. это вообще статусы?            — `isLaptopStatus` (status.ts)
 *  2. куда можно из текущего?        — граф `ALLOWED_TRANSITIONS` (status.ts)
 *  3. выполнено ли условие ребра?    — карта `GUARDS` (rules.ts)
 *  4. как дописать журнал?           — `appendChange` (laptop.ts)
 *
 * Поэтому новое правило добавляется данными — ребром в графе или условием
 * в карте, — а тело `changeStatus` остаётся неизменным.
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
 *   2. `INVALID_DATE` — непригодные часы или запись задним числом;
 *   3. `SAME_STATUS` — переход в тот же статус (частая ошибка интеграции,
 *      поэтому отдельное понятное сообщение, а не общее «переход запрещён»);
 *   4. `TERMINAL_STATUS` — уход из конечного статуса;
 *   5. `TRANSITION_NOT_ALLOWED` — ребра нет в графе;
 *   6. условие на ребре — ребро есть, но оно не выполнено.
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

/** Возможен ли переход прямо сейчас — с учётом условий на рёбрах. */
export function canChangeStatus(
  laptop: Laptop,
  to: LaptopStatus,
  options: ChangeStatusOptions = {},
): boolean {
  return changeStatus(laptop, to, options).ok;
}

/**
 * Переходы, доступные **фактически**: ребро есть в графе и условие пропускает.
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
