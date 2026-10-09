import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { DROP_SQL, SCHEMA_SQL } from './schema.js';

/**
 * Открыть базу.
 *
 * Модуль node:sqlite встроен в Node. Поэтому зависимость рантайм по-прежнему
 * ноль: ни драйвера, ни нативной сборки.
 */
export function openDatabase(location: string): DatabaseSync {
  if (location !== ':memory:') {
    try {
      mkdirSync(dirname(location), { recursive: true });
    } catch (error) {
      // Самый частый сбой при деплое: том есть, а процесс не от root и
      // писать не может. Голый EACCES об этом молчать, подсказка — нет.
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Не удалось подготовить каталог для базы (${dirname(location)}): ${reason}. ` +
          'Проверьте права на точку монтирования тома или задайте DB_PATH в доступный каталог.',
      );
    }
  }

  const db = new DatabaseSync(location);

  // В SQLite внешние ключи по умолчанию ВЫКЛЮЧЕНЫ. Без этого ни CASCADE,
  // ни ссылочная целостность не работать.
  db.exec('PRAGMA foreign_keys = ON');
  // WAL: читатель не мешать писателю. Только для файла, не для :memory:.
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
 * Именно DROP, не DELETE: журнал защищён триггерами от удаления, и это
 * правильно. Обойти их ради кнопки «сбросить» — ослабить инвариант.
 * DROP TABLE триггеры не задевать.
 */
export function resetDatabase(db: DatabaseSync): void {
  db.exec(DROP_SQL);
  db.exec(SCHEMA_SQL);
}

/** Работа в транзакции: статус и журнал попасть в базу вместе или никак. */
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
