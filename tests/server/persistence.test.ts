import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LaptopStatus, changeStatusOrThrow, createLaptop } from '../../src/index.js';
import { seedDatabase } from '../../server/api.js';
import { inTransaction, openDatabase, resetDatabase } from '../../server/db.js';
import {
  applyTransition,
  getLaptop,
  insertLaptop,
  listAttempts,
  listLaptops,
  recordAttempt,
} from '../../server/repository.js';

const SALE_DATE = new Date('2026-01-18T10:00:00.000Z');

function sold(id: string, at: Date = SALE_DATE) {
  return changeStatusOrThrow(createLaptop({ id }), LaptopStatus.Sold, { now: at });
}

describe('хранение', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('агрегат переживает запись и чтение без потерь', () => {
    const laptop = sold('nb-1');
    inTransaction(db, () => insertLaptop(db, { laptop, model: 'MacBook Pro 16"' }));

    const loaded = getLaptop(db, 'nb-1');

    expect(loaded?.model).toBe('MacBook Pro 16"');
    expect(loaded?.version).toBe(1);
    expect(loaded?.laptop.status).toBe('SOLD');
    expect(loaded?.laptop.history).toEqual([
      { from: 'IN_STOCK', to: 'SOLD', at: SALE_DATE },
    ]);
  });

  it('восстановленный из БД агрегат заморожен так же, как созданный в коде', () => {
    inTransaction(db, () => insertLaptop(db, { laptop: sold('nb-1'), model: 'X' }));

    const loaded = getLaptop(db, 'nb-1');

    expect(Object.isFrozen(loaded?.laptop)).toBe(true);
    expect(Object.isFrozen(loaded?.laptop.history)).toBe(true);
  });

  it('поле soldAt импортированных записей сохраняется', () => {
    const imported = createLaptop({
      id: 'nb-legacy',
      status: LaptopStatus.Sold,
      soldAt: SALE_DATE,
    });
    inTransaction(db, () => insertLaptop(db, { laptop: imported, model: 'Legacy' }));

    expect(getLaptop(db, 'nb-legacy')?.laptop.soldAt).toEqual(SALE_DATE);
  });

  it('отсутствующий ноутбук — это undefined, а не исключение', () => {
    expect(getLaptop(db, 'нет такого')).toBeUndefined();
  });

  it('listLaptops раскладывает историю по своим ноутбукам', () => {
    inTransaction(db, () => {
      insertLaptop(db, { laptop: createLaptop({ id: 'nb-1' }), model: 'A' });
      insertLaptop(db, { laptop: sold('nb-2'), model: 'B' });
    });

    const all = listLaptops(db);

    expect(all.map((record) => record.laptop.id).sort()).toEqual(['nb-1', 'nb-2']);
    expect(all.find((r) => r.laptop.id === 'nb-1')?.laptop.history).toHaveLength(0);
    expect(all.find((r) => r.laptop.id === 'nb-2')?.laptop.history).toHaveLength(1);
  });
});

describe('инварианты на уровне СУБД', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    inTransaction(db, () => insertLaptop(db, { laptop: sold('nb-1'), model: 'A' }));
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Журнал append-only не только в домене, но и в базе: переписать историю
   * нельзя даже запросом в обход приложения.
   */
  it('запись журнала невозможно изменить', () => {
    expect(() =>
      db.prepare("UPDATE status_history SET to_status = 'WRITTEN_OFF'").run(),
    ).toThrow(/только дописывается/);
  });

  it('запись журнала невозможно удалить', () => {
    expect(() => db.prepare('DELETE FROM status_history').run()).toThrow(/только дописывается/);
    expect(db.prepare('SELECT count(*) AS c FROM status_history').get()).toEqual({ c: 1 });
  });

  it('статус вне перечисления в базу не попадёт', () => {
    expect(() =>
      db.prepare("UPDATE laptops SET status = 'СЛОМАН' WHERE id = 'nb-1'").run(),
    ).toThrow(/CHECK/i);
  });

  it('переход в тот же статус в журнал не попадёт', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO status_history (laptop_id, from_status, to_status, changed_at)
           VALUES ('nb-1', 'SOLD', 'SOLD', '2026-01-19T10:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK/i);
  });

  it('история без своего ноутбука невозможна — внешние ключи включены', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO status_history (laptop_id, from_status, to_status, changed_at)
           VALUES ('нет-такого', 'IN_STOCK', 'SOLD', '2026-01-19T10:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('отказ без кода ошибки в аудит не попадёт', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO transition_attempts
             (laptop_id, from_status, to_status, ok, error_code, message, model_now)
           VALUES ('nb-1', 'SOLD', 'RESERVED', 0, NULL, 'без кода', '2026-01-19T10:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK/i);
  });

  it('сброс очищает базу, несмотря на защиту журнала от удаления', () => {
    resetDatabase(db);

    expect(listLaptops(db)).toEqual([]);
    expect(db.prepare('SELECT count(*) AS c FROM status_history').get()).toEqual({ c: 0 });
  });
});

describe('повреждённые данные в хранилище', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    inTransaction(db, () => insertLaptop(db, { laptop: sold('nb-1'), model: 'A' }));
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Такие строки приложение создать не может — только внешнее вмешательство
   * или неудачная миграция. Репозиторий обязан падать громко, а не отдавать
   * домену мусор: NaN-дата, просочившаяся в автомат, молча разрешила бы возврат
   * (см. соответствующий разбор в README).
   */
  it('нечитаемая дата в журнале', () => {
    db.prepare(
      `INSERT INTO status_history (laptop_id, from_status, to_status, changed_at)
       VALUES ('nb-1', 'SOLD', 'IN_STOCK', 'не дата')`,
    ).run();

    expect(() => getLaptop(db, 'nb-1')).toThrow(/Повреждённые данные/);
  });

  it('нечитаемая дата в soldAt', () => {
    db.prepare("UPDATE laptops SET sold_at = 'не дата' WHERE id = 'nb-1'").run();

    expect(() => getLaptop(db, 'nb-1')).toThrow(/laptops\.sold_at/);
  });

  it('не строка в названии модели', () => {
    // Именно BLOB: у колонки TEXT-аффинность, поэтому число SQLite молча
    // привёл бы к строке, а BLOB оставляет как есть.
    db.prepare("UPDATE laptops SET model = x'616263' WHERE id = 'nb-1'").run();

    expect(() => getLaptop(db, 'nb-1')).toThrow(/laptops\.model/);
  });

  it('не число в версии', () => {
    db.prepare("UPDATE laptops SET version = 'абв' WHERE id = 'nb-1'").run();

    expect(() => getLaptop(db, 'nb-1')).toThrow(/laptops\.version/);
  });

  it('статус вне перечисления, если ограничение СУБД обойдено', () => {
    // PRAGMA позволяет сымитировать то, что иначе защищено CHECK: строку,
    // попавшую в базу мимо приложения.
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.prepare("UPDATE laptops SET status = 'СЛОМАН' WHERE id = 'nb-1'").run();

    expect(() => getLaptop(db, 'nb-1')).toThrow(/laptops\.status/);
  });

  it('битая запись в аудите тоже не проходит молча', () => {
    db.prepare(
      `INSERT INTO transition_attempts
         (laptop_id, from_status, to_status, ok, error_code, message, model_now)
       VALUES ('nb-1', 'SOLD', 'IN_STOCK', 0, 'SAME_STATUS', 'текст', 'не дата')`,
    ).run();

    expect(() => listAttempts(db)).toThrow(/model_now/);
  });
});

describe('транзакции', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('при ошибке внутри транзакции откатывается всё', () => {
    expect(() =>
      inTransaction(db, () => {
        insertLaptop(db, { laptop: createLaptop({ id: 'nb-1' }), model: 'A' });
        throw new Error('что-то пошло не так на полпути');
      }),
    ).toThrow('что-то пошло не так на полпути');

    // Ноутбук не должен остаться записанным наполовину.
    expect(listLaptops(db)).toEqual([]);
  });

  it('успешная транзакция возвращает результат работы', () => {
    const result = inTransaction(db, () => {
      insertLaptop(db, { laptop: createLaptop({ id: 'nb-1' }), model: 'A' });
      return 'готово';
    });

    expect(result).toBe('готово');
    expect(listLaptops(db)).toHaveLength(1);
  });
});

describe('оптимистическая блокировка', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    inTransaction(db, () =>
      insertLaptop(db, { laptop: createLaptop({ id: 'nb-1' }), model: 'A' }),
    );
  });

  afterEach(() => {
    db.close();
  });

  it('успешная запись поднимает версию и дописывает журнал', () => {
    const record = getLaptop(db, 'nb-1');
    const next = changeStatusOrThrow(record!.laptop, LaptopStatus.Reserved, { now: SALE_DATE });

    const applied = inTransaction(db, () =>
      applyTransition(db, {
        id: 'nb-1',
        expectedVersion: record!.version,
        next,
        change: next.history[0]!,
      }),
    );

    expect(applied).toBe(true);
    const reloaded = getLaptop(db, 'nb-1');
    expect(reloaded?.version).toBe(2);
    expect(reloaded?.laptop.status).toBe('RESERVED');
    expect(reloaded?.laptop.history).toHaveLength(1);
  });

  /**
   * Сценарий двух вкладок: обе прочитали версию 1, обе шлют изменение.
   * Второе не должно молча затереть первое.
   */
  it('устаревшая версия не затирает чужое изменение', () => {
    const stale = getLaptop(db, 'nb-1')!;

    // Первая вкладка успевает.
    const first = changeStatusOrThrow(stale.laptop, LaptopStatus.Reserved, { now: SALE_DATE });
    inTransaction(db, () =>
      applyTransition(db, {
        id: 'nb-1',
        expectedVersion: stale.version,
        next: first,
        change: first.history[0]!,
      }),
    );

    // Вторая всё ещё думает, что версия 1.
    const second = changeStatusOrThrow(stale.laptop, LaptopStatus.Sold, { now: SALE_DATE });
    const applied = inTransaction(db, () =>
      applyTransition(db, {
        id: 'nb-1',
        expectedVersion: stale.version,
        next: second,
        change: second.history[0]!,
      }),
    );

    expect(applied).toBe(false);

    const reloaded = getLaptop(db, 'nb-1');
    expect(reloaded?.laptop.status).toBe('RESERVED');
    expect(reloaded?.version).toBe(2);
    // И в журнал ничего лишнего не дописалось.
    expect(reloaded?.laptop.history).toHaveLength(1);
  });
});

describe('аудит попыток', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    inTransaction(db, () =>
      insertLaptop(db, { laptop: createLaptop({ id: 'nb-1' }), model: 'A' }),
    );
  });

  afterEach(() => {
    db.close();
  });

  it('хранит и успехи, и отказы, новые сверху', () => {
    inTransaction(db, () => {
      recordAttempt(db, {
        laptopId: 'nb-1',
        from: 'IN_STOCK',
        to: 'RESERVED',
        ok: true,
        errorCode: null,
        message: 'ок',
        modelNow: SALE_DATE,
      });
      recordAttempt(db, {
        laptopId: 'nb-1',
        from: 'IN_STOCK',
        to: 'IN_STOCK',
        ok: false,
        errorCode: 'SAME_STATUS',
        message: 'уже в этом статусе',
        modelNow: SALE_DATE,
      });
    });

    const attempts = listAttempts(db);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.ok).toBe(false);
    expect(attempts[0]?.errorCode).toBe('SAME_STATUS');
    expect(attempts[1]?.ok).toBe(true);
    expect(attempts[1]?.errorCode).toBeNull();
    expect(attempts[0]?.modelNow).toEqual(SALE_DATE);
  });
});

describe('данные переживают перезапуск процесса', () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'laptop-db-'));
    file = join(directory, 'laptops.db');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /** Ровно то, ради чего заводилась база: перезагрузка страницы ничего не теряет. */
  it('ноутбуки, история и аудит читаются после повторного открытия файла', () => {
    const first = openDatabase(file);
    seedDatabase(first, SALE_DATE);

    const record = getLaptop(first, 'nb-001')!;
    const next = changeStatusOrThrow(record.laptop, LaptopStatus.Reserved, { now: SALE_DATE });
    inTransaction(first, () => {
      applyTransition(first, {
        id: 'nb-001',
        expectedVersion: record.version,
        next,
        change: next.history.at(-1)!,
      });
      recordAttempt(first, {
        laptopId: 'nb-001',
        from: 'IN_STOCK',
        to: 'RESERVED',
        ok: true,
        errorCode: null,
        message: 'ок',
        modelNow: SALE_DATE,
      });
    });
    first.close();

    // Новое соединение — как после перезапуска сервера.
    const second = openDatabase(file);

    expect(listLaptops(second)).toHaveLength(6);
    const reloaded = getLaptop(second, 'nb-001');
    expect(reloaded?.laptop.status).toBe('RESERVED');
    expect(reloaded?.laptop.history).toEqual([
      { from: 'IN_STOCK', to: 'RESERVED', at: SALE_DATE },
    ]);
    expect(reloaded?.version).toBe(2);
    expect(listAttempts(second)).toHaveLength(1);

    // Повторный сид на непустой базе ничего не ломает и не дублирует.
    seedDatabase(second, SALE_DATE);
    expect(listLaptops(second)).toHaveLength(6);

    second.close();
  });
});
