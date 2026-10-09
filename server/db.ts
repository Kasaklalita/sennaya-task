import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { DROP_SQL, SCHEMA_SQL } from './schema.js';

/**
 * Открытие базы.
 *
 * Используется встроенный в Node модуль `node:sqlite` — поэтому у проекта
 * по-прежнему ноль рантайм-зависимостей: ни драйвера, ни нативной сборки.
 */
export function openDatabase(location: string): DatabaseSync {
  if (location !== ':memory:') {
    mkdirSync(dirname(location), { recursive: true });
  }

  const db = new DatabaseSync(location);

  // Внешние ключи в SQLite выключены по умолчанию — без этого ON DELETE CASCADE
  // и ссылочная целостность просто не работают.
  db.exec('PRAGMA foreign_keys = ON');
  // WAL: читатели не блокируют писателя. Для файла на диске, не для :memory:.
  if (location !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA busy_timeout = 5000');

  db.exec(SCHEMA_SQL);

  return db;
}

/**
 * Полный сброс.
 *
 * Именно DROP, а не DELETE: журнал изменений защищён триггерами от удаления
 * строк, и это правильно — обойти их ради «кнопки сброса» значило бы ослабить
 * инвариант. DROP TABLE триггеры не задевает.
 */
export function resetDatabase(db: DatabaseSync): void {
  db.exec(DROP_SQL);
  db.exec(SCHEMA_SQL);
}

/**
 * Выполняет работу в транзакции: смена статуса и запись в журнал должны
 * попасть в базу вместе или не попасть вовсе.
 */
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
