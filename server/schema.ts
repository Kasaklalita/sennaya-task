import { ALL_STATUSES } from '../src/index.js';

/**
 * Схема базы.
 *
 * Список статусов в CHECK печатать из ALL_STATUSES, не писать рукой: домен
 * остаться один источник истины даже для ограничений СУБД. Подстановка
 * безопасна — это константы, не ввод человека.
 */
const statusList = ALL_STATUSES.map((status) => `'${status}'`).join(', ');

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS laptops (
  id         TEXT    PRIMARY KEY,
  -- Название из каталога. Домен про модели не знать и не должен.
  model      TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN (${statusList})),
  -- Запас на случай записи без истории (см. resolveSaleDate).
  sold_at    TEXT,
  -- Версия строки: две вкладки не должны терять изменение друг друга.
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  laptop_id   TEXT    NOT NULL REFERENCES laptops(id) ON DELETE CASCADE,
  from_status TEXT    NOT NULL CHECK (from_status IN (${statusList})),
  to_status   TEXT    NOT NULL CHECK (to_status IN (${statusList})),
  -- Момент по модельным часам — то, что домен класть в StatusChange.at.
  changed_at  TEXT    NOT NULL,
  -- Момент реальной записи. Демо умеет двигать «сейчас» — без этого не
  -- отличить путешествие во времени от настоящей хронологии.
  recorded_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Тот же инвариант, что у model-based теста: переход в себя в журнал не попасть.
  CHECK (from_status <> to_status)
);

CREATE INDEX IF NOT EXISTS idx_history_laptop ON status_history (laptop_id, id);

-- Журнал ПОПЫТОК, и отказы тоже. В историю ноутбука отказ не попадать — её
-- ведёт домен, там только случившееся. Но для аудита важно именно «кто что
-- пытался и почему система сказала нет».
CREATE TABLE IF NOT EXISTS transition_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  laptop_id   TEXT    NOT NULL REFERENCES laptops(id) ON DELETE CASCADE,
  from_status TEXT    NOT NULL CHECK (from_status IN (${statusList})),
  to_status   TEXT    NOT NULL CHECK (to_status IN (${statusList})),
  ok          INTEGER NOT NULL CHECK (ok IN (0, 1)),
  -- Код ошибки домена. У успеха NULL.
  error_code  TEXT,
  message     TEXT    NOT NULL,
  model_now   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((ok = 1 AND error_code IS NULL) OR (ok = 0 AND error_code IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_attempts_recent ON transition_attempts (id DESC);

-- Журнал только дописывать. Это инвариант домена, и тут он закреплён в СУБД:
-- переписать или удалить запись нельзя даже мимо приложения. Полная чистка
-- идёт через DROP TABLE — триггеры он не задевать.
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

/** Порядок важен: сперва дети, потом родитель. */
export const DROP_SQL = `
DROP TRIGGER IF EXISTS status_history_is_append_only_update;
DROP TRIGGER IF EXISTS status_history_is_append_only_delete;
DROP TABLE IF EXISTS transition_attempts;
DROP TABLE IF EXISTS status_history;
DROP TABLE IF EXISTS laptops;
`;
