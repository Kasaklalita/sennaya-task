import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedDatabase, type BoardDto } from '../../server/api.js';
import { openDatabase } from '../../server/db.js';
import { createApiServer } from '../../server/http.js';

const SEEDED_AT = new Date('2026-03-01T12:00:00.000Z');

/** Поднимает настоящий HTTP-сервер на свободном порту и ходит в него fetch'ем. */
describe('HTTP', () => {
  let db: DatabaseSync;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    seedDatabase(db, SEEDED_AT);
    server = createApiServer(db);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    db.close();
  });

  it('GET /api/board отдаёт JSON с доской', async () => {
    const response = await fetch(`${baseUrl}/api/board`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');

    const board = (await response.json()) as BoardDto;
    expect(board.laptops).toHaveLength(6);
  });

  it('POST смены статуса меняет состояние', async () => {
    const response = await fetch(`${baseUrl}/api/laptops/nb-001/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'RESERVED', now: SEEDED_AT.toISOString() }),
    });

    expect(response.status).toBe(200);
    const { board } = (await response.json()) as { board: BoardDto };
    expect(board.laptops.find((item) => item.id === 'nb-001')?.status).toBe('RESERVED');
  });

  it('отказ бизнес-правила приходит как 409 с кодом домена', async () => {
    const response = await fetch(`${baseUrl}/api/laptops/nb-004/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'IN_STOCK', now: SEEDED_AT.toISOString() }),
    });

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: { code: string } };
    expect(error.code).toBe('RETURN_WINDOW_EXPIRED');
  });

  it('POST /api/laptops добавляет ноутбук и отвечает 201', async () => {
    const response = await fetch(`${baseUrl}/api/laptops`, { method: 'POST' });

    expect(response.status).toBe(201);
    const { board, createdId } = (await response.json()) as {
      board: BoardDto;
      createdId: string;
    };
    expect(board.laptops).toHaveLength(7);
    const created = board.laptops.find((item) => item.id === createdId);
    expect(created?.status).toBe('IN_STOCK');
    expect(created?.model.length).toBeGreaterThan(0);
  });

  it('POST /api/reset возвращает доску в исходное состояние', async () => {
    await fetch(`${baseUrl}/api/laptops/nb-001/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'RESERVED', now: SEEDED_AT.toISOString() }),
    });

    const response = await fetch(`${baseUrl}/api/reset`, { method: 'POST' });

    expect(response.status).toBe(200);
    const { board } = (await response.json()) as { board: BoardDto };
    expect(board.laptops.find((item) => item.id === 'nb-001')?.status).toBe('IN_STOCK');
    expect(board.attempts).toHaveLength(0);
  });

  it('битый JSON — это ошибка клиента, а не сбой сервера', async () => {
    const response = await fetch(`${baseUrl}/api/laptops/nb-001/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ это не json',
    });

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string } };
    expect(error.code).toBe('BAD_REQUEST');
  });

  it('пустое тело запроса не роняет сервер', async () => {
    const response = await fetch(`${baseUrl}/api/laptops/nb-001/status`, { method: 'POST' });

    // Пустое тело читается как {}, дальше его отвергает разбор: поля "to" нет.
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string } };
    expect(error.code).toBe('BAD_REQUEST');
  });

  it('слишком большое тело отвергается до чтения в память', async () => {
    const response = await fetch(`${baseUrl}/api/laptops/nb-001/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'RESERVED', padding: 'я'.repeat(100_000) }),
    });

    expect(response.status).toBe(413);
    const { error } = (await response.json()) as { error: { code: string } };
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('неизвестный маршрут → 404', async () => {
    const response = await fetch(`${baseUrl}/api/нет-такого`);

    expect(response.status).toBe(404);
  });

  it('неподходящий метод на существующем маршруте → 405', async () => {
    const response = await fetch(`${baseUrl}/api/laptops/nb-001/status`);

    expect(response.status).toBe(405);
  });
});

/**
 * Продакшен-режим: один процесс отдаёт и API, и собранный фронтенд.
 * В разработке статику раздаёт Vite, и STATIC_DIR не задан.
 */
describe('сервер со встроенной раздачей фронтенда', () => {
  let db: DatabaseSync;
  let server: Server;
  let baseUrl: string;
  let staticRoot: string;

  beforeEach(async () => {
    staticRoot = mkdtempSync(join(tmpdir(), 'laptop-dist-web-'));
    mkdirSync(join(staticRoot, 'assets'));
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>доска</title>');
    writeFileSync(join(staticRoot, 'assets', 'app-abc.js'), 'console.log(1)');

    db = openDatabase(':memory:');
    seedDatabase(db, SEEDED_AT);
    server = createApiServer(db, { staticRoot });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    db.close();
    rmSync(staticRoot, { recursive: true, force: true });
  });

  it('корень отдаёт разметку, а не JSON', async () => {
    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('доска');
  });

  it('ассеты раздаются', async () => {
    expect((await fetch(`${baseUrl}/assets/app-abc.js`)).status).toBe(200);
  });

  it('API продолжает работать и не подменяется разметкой', async () => {
    const response = await fetch(`${baseUrl}/api/board`);

    expect(response.headers.get('content-type')).toContain('application/json');
    expect(((await response.json()) as BoardDto).laptops).toHaveLength(6);
  });

  it('несуществующий путь под /api остаётся JSON-ошибкой 404', async () => {
    // Иначе клиент получил бы HTML вместо ответа API и упал на разборе JSON.
    const response = await fetch(`${baseUrl}/api/нет-такого`);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
