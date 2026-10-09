import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach } from 'vitest';

import { MS_IN_DAY } from '../../src/index.js';
import { seedDatabase } from '../../server/api.js';
import { openDatabase } from '../../server/db.js';
import { createApiServer } from '../../server/http.js';

/**
 * Обвязка для тестов сервера.
 *
 * Пара «открыть базу в памяти — закрыть после теста» встречаться семнадцать
 * раз. Тут она одна. И ещё: забыть `db.close()` в новом наборе больше нельзя.
 */

/** «Сейчас» сида. Тест не должен зависеть от настоящего времени. */
export const SEEDED_AT = new Date('2026-03-01T12:00:00.000Z');

/** Момент, сдвинутый от сида на целое число суток. */
export function iso(offsetDays: number): string {
  return new Date(SEEDED_AT.getTime() + offsetDays * MS_IN_DAY).toISOString();
}

export interface DatabaseContext {
  /** Открывать заново перед каждым тестом, поэтому читать через свойство. */
  db: DatabaseSync;
}

/**
 * База в памяти на один тест.
 *
 * Свой `beforeEach` можно вешать после вызова: Vitest выполнять хуки в порядке
 * объявления, база к тому моменту уже открыта.
 */
export function useDatabase(options: { readonly seeded?: boolean } = {}): DatabaseContext {
  const context = { db: undefined as unknown as DatabaseSync };

  beforeEach(() => {
    context.db = openDatabase(':memory:');
    if (options.seeded !== false) {
      seedDatabase(context.db, SEEDED_AT);
    }
  });

  afterEach(() => {
    try {
      context.db.close();
    } catch {
      // Тест мог закрыть базу нарочно — например проверяя 503.
    }
  });

  return context;
}

export interface ServerContext extends DatabaseContext {
  /** Адрес сервера, например `http://127.0.0.1:54321`. */
  baseUrl: string;
}

/** Настоящий HTTP-сервер на свободном порту, на один тест. */
export function useApiServer(
  options: { readonly staticRoot?: () => string } = {},
): ServerContext {
  const context = useDatabase() as ServerContext;
  let server: Server;

  beforeEach(async () => {
    const staticRoot = options.staticRoot?.();
    server = createApiServer(context.db, staticRoot === undefined ? {} : { staticRoot });

    await new Promise<void>((resolve) => {
      // Порт 0 — пусть система даст свободный: файлы тестов бегать
      // параллельно и не должны драться за один номер.
      server.listen(0, '127.0.0.1', resolve);
    });

    context.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  return context;
}
