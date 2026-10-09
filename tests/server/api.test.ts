import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LaptopStatus,
  MS_IN_DAY,
  TransitionErrorCode,
  createLaptop,
  type TransitionError,
} from '../../src/index.js';
import {
  getBoard,
  httpStatusFor,
  postReset,
  postTransition,
  seedDatabase,
  type BoardDto,
} from '../../server/api.js';
import { inTransaction, openDatabase } from '../../server/db.js';
import { insertLaptop } from '../../server/repository.js';

/** Фиксированное «сейчас» сида: тесты не должны зависеть от реального времени. */
const SEEDED_AT = new Date('2026-03-01T12:00:00.000Z');
const iso = (offsetDays: number): string =>
  new Date(SEEDED_AT.getTime() + offsetDays * MS_IN_DAY).toISOString();

function boardOf(body: unknown): BoardDto {
  return (body as { board: BoardDto }).board;
}

function errorOf(body: unknown): { code: string; message: string } {
  return (body as { error: { code: string; message: string } }).error;
}

function laptop(board: BoardDto, id: string) {
  return board.laptops.find((item) => item.id === id);
}

describe('API доски', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    seedDatabase(db, SEEDED_AT);
  });

  afterEach(() => {
    db.close();
  });

  it('GET возвращает все ноутбуки с историей и пустым аудитом', () => {
    const response = getBoard(db);
    const board = response.body as BoardDto;

    expect(response.status).toBe(200);
    expect(board.laptops).toHaveLength(6);
    expect(board.attempts).toHaveLength(0);
    expect(laptop(board, 'nb-001')?.status).toBe('IN_STOCK');
    expect(laptop(board, 'nb-006')?.history).toHaveLength(3);
  });

  it('даты в DTO — строки ISO-8601, а не объекты Date', () => {
    const board = getBoard(db).body as BoardDto;
    const entry = laptop(board, 'nb-003')?.history[0];

    expect(typeof entry?.at).toBe('string');
    expect(entry?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('успешный переход', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    seedDatabase(db, SEEDED_AT);
  });

  afterEach(() => {
    db.close();
  });

  it('меняет статус, поднимает версию и дописывает журнал', () => {
    const response = postTransition(db, 'nb-001', { to: LaptopStatus.Reserved, now: iso(0) });
    const updated = laptop(boardOf(response.body), 'nb-001');

    expect(response.status).toBe(200);
    expect(updated?.status).toBe('RESERVED');
    expect(updated?.version).toBe(2);
    expect(updated?.history).toEqual([
      { from: 'IN_STOCK', to: 'RESERVED', at: iso(0) },
    ]);
  });

  it('пишет успех в аудит', () => {
    postTransition(db, 'nb-001', { to: LaptopStatus.Sold, now: iso(0) });
    const board = getBoard(db).body as BoardDto;

    expect(board.attempts).toHaveLength(1);
    expect(board.attempts[0]).toMatchObject({
      laptopId: 'nb-001',
      from: 'IN_STOCK',
      to: 'SOLD',
      ok: true,
      errorCode: null,
    });
  });

  it('возврат внутри окна проходит', () => {
    // nb-003 продан за 3 дня до SEEDED_AT — срок ещё не истёк.
    expect(postTransition(db, 'nb-003', { to: LaptopStatus.InStock, now: iso(0) }).status).toBe(
      200,
    );
  });

  it('без поля now используются часы сервера', () => {
    const response = postTransition(db, 'nb-001', { to: LaptopStatus.Reserved });

    expect(response.status).toBe(200);
    const at = laptop(boardOf(response.body), 'nb-001')?.history[0]?.at ?? '';
    expect(Date.parse(at)).toBeGreaterThan(SEEDED_AT.getTime());
  });
});

describe('отказы домена переводятся в коды HTTP', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    seedDatabase(db, SEEDED_AT);
  });

  afterEach(() => {
    db.close();
  });

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly id: string;
    readonly to: LaptopStatus;
    readonly nowDays: number;
    readonly code: string;
    readonly status: number;
  }> = [
    {
      name: 'переход в тот же статус',
      id: 'nb-001',
      to: LaptopStatus.InStock,
      nowDays: 0,
      code: 'SAME_STATUS',
      status: 409,
    },
    {
      name: 'уход из конечного статуса',
      id: 'nb-005',
      to: LaptopStatus.InStock,
      nowDays: 0,
      code: 'TERMINAL_STATUS',
      status: 409,
    },
    {
      name: 'ребра нет в графе',
      id: 'nb-003',
      to: LaptopStatus.Reserved,
      nowDays: 0,
      code: 'TRANSITION_NOT_ALLOWED',
      status: 409,
    },
    {
      name: 'срок возврата истёк',
      id: 'nb-004',
      to: LaptopStatus.InStock,
      nowDays: 0,
      code: 'RETURN_WINDOW_EXPIRED',
      status: 409,
    },
    {
      name: 'часы отведены назад за последнюю запись',
      id: 'nb-002',
      to: LaptopStatus.Sold,
      nowDays: -10,
      code: 'INVALID_DATE',
      status: 400,
    },
  ];

  it.each(cases)('$name → $status $code', ({ id, to, nowDays, code, status }) => {
    const response = postTransition(db, id, { to, now: iso(nowDays) });

    expect(response.status).toBe(status);
    expect(errorOf(response.body).code).toBe(code);
  });

  it('при отказе состояние не меняется, но попытка попадает в аудит', () => {
    const response = postTransition(db, 'nb-004', { to: LaptopStatus.InStock, now: iso(0) });
    const board = boardOf(response.body);

    expect(laptop(board, 'nb-004')?.status).toBe('SOLD');
    expect(laptop(board, 'nb-004')?.version).toBe(1);
    expect(laptop(board, 'nb-004')?.history).toHaveLength(1);
    expect(board.attempts[0]).toMatchObject({
      laptopId: 'nb-004',
      ok: false,
      errorCode: 'RETURN_WINDOW_EXPIRED',
    });
  });

  it('при отказе возвращается актуальная доска — клиенту не нужен второй запрос', () => {
    const response = postTransition(db, 'nb-001', { to: LaptopStatus.InStock, now: iso(0) });

    expect(boardOf(response.body).laptops).toHaveLength(6);
  });

  it('невозможно определить дату продажи → 422', () => {
    inTransaction(db, () =>
      insertLaptop(db, {
        laptop: createLaptop({ id: 'nb-mystery', status: LaptopStatus.Sold }),
        model: 'Импорт без истории',
      }),
    );

    const response = postTransition(db, 'nb-mystery', { to: LaptopStatus.InStock, now: iso(0) });

    expect(response.status).toBe(422);
    expect(errorOf(response.body).code).toBe('SALE_DATE_UNKNOWN');
  });

  /**
   * Таблица соответствия проверяется целиком: `satisfies` в api.ts гарантирует,
   * что она исчерпывающая на этапе компиляции, а этот тест — что значения
   * именно те, которые задумывались.
   */
  it('таблица кодов покрывает все ошибки домена', () => {
    const expected: Record<string, number> = {
      UNKNOWN_STATUS: 400,
      INVALID_DATE: 400,
      SAME_STATUS: 409,
      TERMINAL_STATUS: 409,
      TRANSITION_NOT_ALLOWED: 409,
      RETURN_WINDOW_EXPIRED: 409,
      SALE_DATE_UNKNOWN: 422,
    };

    for (const code of Object.values(TransitionErrorCode)) {
      const fake = { code, message: 'тест' } as TransitionError;
      expect(httpStatusFor(fake)).toBe(expected[code]);
    }
  });
});

describe('разбор запроса', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    seedDatabase(db, SEEDED_AT);
  });

  afterEach(() => {
    db.close();
  });

  it('несуществующий ноутбук → 404', () => {
    const response = postTransition(db, 'нет-такого', { to: LaptopStatus.Sold });

    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('NOT_FOUND');
  });

  it.each([
    ['тело не объект', 'строка'],
    ['нет поля to', {}],
    ['статус вне перечисления', { to: 'СЛОМАН' }],
    ['now не строка', { to: 'SOLD', now: 12345 }],
    ['now не дата', { to: 'SOLD', now: 'вчера' }],
    ['expectedVersion не целое', { to: 'SOLD', expectedVersion: 1.5 }],
  ])('%s → 400', (_name, body) => {
    const response = postTransition(db, 'nb-001', body);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('BAD_REQUEST');
  });
});

describe('конкурентное изменение', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    seedDatabase(db, SEEDED_AT);
  });

  afterEach(() => {
    db.close();
  });

  it('устаревшая версия → 409 VERSION_CONFLICT с актуальной доской', () => {
    // Первая вкладка успевает.
    expect(
      postTransition(db, 'nb-001', {
        to: LaptopStatus.Reserved,
        now: iso(0),
        expectedVersion: 1,
      }).status,
    ).toBe(200);

    // Вторая всё ещё думает, что версия 1.
    const response = postTransition(db, 'nb-001', {
      to: LaptopStatus.Sold,
      now: iso(0),
      expectedVersion: 1,
    });

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('VERSION_CONFLICT');
    expect(laptop(boardOf(response.body), 'nb-001')?.status).toBe('RESERVED');
    expect(laptop(boardOf(response.body), 'nb-001')?.version).toBe(2);
  });

  it('без expectedVersion изменение применяется к текущему состоянию', () => {
    postTransition(db, 'nb-001', { to: LaptopStatus.Reserved, now: iso(0) });

    expect(postTransition(db, 'nb-001', { to: LaptopStatus.Sold, now: iso(0) }).status).toBe(200);
  });
});

describe('сброс', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    seedDatabase(db, SEEDED_AT);
  });

  afterEach(() => {
    db.close();
  });

  it('возвращает доску в исходное состояние и чистит аудит', () => {
    postTransition(db, 'nb-001', { to: LaptopStatus.Reserved, now: iso(0) });
    postTransition(db, 'nb-004', { to: LaptopStatus.InStock, now: iso(0) });

    const response = postReset(db, SEEDED_AT);
    const board = boardOf(response.body);

    expect(response.status).toBe(200);
    expect(board.laptops).toHaveLength(6);
    expect(board.attempts).toHaveLength(0);
    expect(laptop(board, 'nb-001')?.status).toBe('IN_STOCK');
    expect(laptop(board, 'nb-001')?.version).toBe(1);
  });
});
