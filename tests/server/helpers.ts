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
 * Одна и та же пара «открыть базу в памяти — закрыть после теста» встречалась
 * семнадцать раз. Здесь она описана один раз, и у неё есть ещё одно свойство:
 * забыть `db.close()` в новом наборе тестов больше нельзя.
 */

/** Фиксированное «сейчас» сида: тесты не должны зависеть от реального времени. */
export const SEEDED_AT = new Date('2026-03-01T12:00:00.000Z');

/** Момент, сдвинутый относительно сида на целое число суток. */
export function iso(offsetDays: number): string {
  return new Date(SEEDED_AT.getTime() + offsetDays * MS_IN_DAY).toISOString();
}

export interface DatabaseContext {
  /** Переоткрывается перед каждым тестом, поэтому читается через свойство. */
  db: DatabaseSync;
}

/**
 * База в памяти на время одного теста.
 *
 * Свои `beforeEach` можно регистрировать после вызова — Vitest выполняет хуки
 * в порядке объявления, так что база к тому моменту уже открыта.
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
      // Тест мог закрыть базу намеренно — например проверяя, что сервис
      // отвечает 503 при недоступном хранилище.
    }
  });

  return context;
}

export interface ServerContext extends DatabaseContext {
  /** Адрес поднятого сервера, например `http://127.0.0.1:54321`. */
  baseUrl: string;
}

/** Настоящий HTTP-сервер на свободном порту — на время одного теста. */
export function useApiServer(
  options: { readonly staticRoot?: () => string } = {},
): ServerContext {
  const context = useDatabase() as ServerContext;
  let server: Server;

  beforeEach(async () => {
    const staticRoot = options.staticRoot?.();
    server = createApiServer(context.db, staticRoot === undefined ? {} : { staticRoot });

    await new Promise<void>((resolve) => {
      // Порт 0 — пусть операционная система выдаст свободный:
      // параллельные файлы тестов не должны драться за один номер.
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
