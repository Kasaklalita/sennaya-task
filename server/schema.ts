import { ALL_STATUSES } from '../src/index.js';

/**
 * Схема базы.
 *
 * Список допустимых статусов в `CHECK` печатается из `ALL_STATUSES`, а не
 * переписывается руками: домен остаётся единственным источником истины даже
 * для ограничений на уровне БД. Подстановка безопасна — это константы
 * перечисления, а не пользовательский ввод.
 */
const statusList = ALL_STATUSES.map((status) => `'${status}'`).join(', ');

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS laptops (
  id         TEXT    PRIMARY KEY,
  -- Каталожное название. Домен про модели не знает и знать не должен:
  -- это данные соседнего контекста, которые живут только здесь и в DTO.
  model      TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN (${statusList})),
  -- Запасной источник даты продажи для импортированных записей (см. resolveSaleDate).
  sold_at    TEXT,
  -- Оптимистическая блокировка: две вкладки не должны «потерять» изменение друг друга.
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  laptop_id   TEXT    NOT NULL REFERENCES laptops(id) ON DELETE CASCADE,
  from_status TEXT    NOT NULL CHECK (from_status IN (${statusList})),
  to_status   TEXT    NOT NULL CHECK (to_status IN (${statusList})),
  -- Момент изменения по модельным часам — то, что домен кладёт в StatusChange.at.
  changed_at  TEXT    NOT NULL,
  -- Момент реальной записи в БД. Нужен, потому что демо умеет двигать «сейчас»:
  -- без этого нельзя отличить путешествие во времени от настоящей хронологии.
  recorded_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Тот же инвариант, что проверяет model-based тест домена: переход в себя
  -- в журнал попасть не может.
  CHECK (from_status <> to_status)
);

CREATE INDEX IF NOT EXISTS idx_history_laptop ON status_history (laptop_id, id);

-- Журнал ПОПЫТОК, включая отклонённые. В историю ноутбука отказы не попадают
-- (её ведёт домен, и там только случившиеся изменения), но для аудита важно
-- именно то, что кто-то пытался сделать и почему система отказала.
CREATE TABLE IF NOT EXISTS transition_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  laptop_id   TEXT    NOT NULL REFERENCES laptops(id) ON DELETE CASCADE,
  from_status TEXT    NOT NULL CHECK (from_status IN (${statusList})),
  to_status   TEXT    NOT NULL CHECK (to_status IN (${statusList})),
  ok          INTEGER NOT NULL CHECK (ok IN (0, 1)),
  -- Код ошибки домена; NULL у успешных попыток.
  error_code  TEXT,
  message     TEXT    NOT NULL,
  model_now   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((ok = 1 AND error_code IS NULL) OR (ok = 0 AND error_code IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_attempts_recent ON transition_attempts (id DESC);

-- Журнал изменений только дописывается — это инвариант домена, и здесь он
-- закреплён на уровне СУБД: переписать или удалить запись не получится даже
-- в обход приложения. Полная очистка в тестах и при сбросе демо делается
-- через DROP TABLE, который триггеры не задевает.
CREATE TRIGGER IF NOT EXISTS status_history_is_append_only_update
BEFORE UPDATE ON status_history
BEGIN
  SELECT RAISE(ABORT, 'status_history: журнал только дописывается, UPDATE запрещён');
END;

CREATE TRIGGER IF NOT EXISTS status_history_is_append_only_delete
BEFORE DELETE ON status_history
BEGIN
  SELECT RAISE(ABORT, 'status_history: журнал только дописывается, DELETE запрещён');
END;
`;

/** Порядок важен: сначала зависимые таблицы, потом родительская. */
export const DROP_SQL = `
DROP TRIGGER IF EXISTS status_history_is_append_only_update;
DROP TRIGGER IF EXISTS status_history_is_append_only_delete;
DROP TABLE IF EXISTS transition_attempts;
DROP TABLE IF EXISTS status_history;
DROP TABLE IF EXISTS laptops;
`;
