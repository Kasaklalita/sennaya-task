import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BoardDto } from '../../server/api.js';
import { SEEDED_AT, useApiServer } from './helpers.js';

/** Поднять настоящий сервер на свободном порту и ходить в него fetch'ем. */
describe('HTTP', () => {
  const context = useApiServer();

  it('GET /api/board отдаёт JSON с доской', async () => {
    const response = await fetch(`${context.baseUrl}/api/board`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');

    const board = (await response.json()) as BoardDto;
    expect(board.laptops).toHaveLength(6);
  });

  it('POST смены статуса меняет состояние', async () => {
    const response = await fetch(`${context.baseUrl}/api/laptops/nb-001/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'RESERVED', now: SEEDED_AT.toISOString() }),
    });

    expect(response.status).toBe(200);
    const { board } = (await response.json()) as { board: BoardDto };
    expect(board.laptops.find((item) => item.id === 'nb-001')?.status).toBe('RESERVED');
  });

  it('отказ бизнес-правила приходит как 409 с кодом домена', async () => {
    const response = await fetch(`${context.baseUrl}/api/laptops/nb-004/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'IN_STOCK', now: SEEDED_AT.toISOString() }),
    });

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: { code: string } };
    expect(error.code).toBe('RETURN_WINDOW_EXPIRED');
  });

  it('POST /api/laptops добавляет ноутбук и отвечает 201', async () => {
    const response = await fetch(`${context.baseUrl}/api/laptops`, { method: 'POST' });

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

  it('GET /api/attempts листать журнал', async () => {
    for (let i = 0; i < 25; i += 1) {
      // Отказ: переход в тот же статус. Каждый попадать в журнал.
      await fetch(`${context.baseUrl}/api/laptops/nb-001/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'IN_STOCK' }),
      });
    }

    const firstResponse = await fetch(`${context.baseUrl}/api/attempts?limit=10&offset=0`);
    const first = (await firstResponse.json()) as {
      items: { id: number }[];
      total: number;
      limit: number;
      offset: number;
    };

    expect(firstResponse.status).toBe(200);
    expect(first.items).toHaveLength(10);
    expect(first.total).toBe(25);

    const lastResponse = await fetch(`${context.baseUrl}/api/attempts?limit=10&offset=20`);
    const lastPage = (await lastResponse.json()) as { items: { id: number }[] };

    // Хвост короче страницы — это нормально, а не ошибка.
    expect(lastPage.items).toHaveLength(5);
    const ids = new Set([...first.items, ...lastPage.items].map((i) => i.id));
    expect(ids.size).toBe(15);
  });

  it('мусор в параметрах страницы → 400', async () => {
    const response = await fetch(`${context.baseUrl}/api/attempts?limit=abc`);

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string } };
    expect(error.code).toBe('BAD_REQUEST');
  });

  it('POST /api/reset возвращает доску в исходное состояние', async () => {
    await fetch(`${context.baseUrl}/api/laptops/nb-001/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'RESERVED', now: SEEDED_AT.toISOString() }),
    });

    const response = await fetch(`${context.baseUrl}/api/reset`, { method: 'POST' });

    expect(response.status).toBe(200);
    const { board } = (await response.json()) as { board: BoardDto };
    expect(board.laptops.find((item) => item.id === 'nb-001')?.status).toBe('IN_STOCK');
    expect(board.attempts.items).toHaveLength(0);
  });

  it('битый JSON — это ошибка клиента, а не сбой сервера', async () => {
    const response = await fetch(`${context.baseUrl}/api/laptops/nb-001/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ это не json',
    });

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string } };
    expect(error.code).toBe('BAD_REQUEST');
  });

  it('пустое тело запроса не роняет сервер', async () => {
    const response = await fetch(`${context.baseUrl}/api/laptops/nb-001/status`, { method: 'POST' });

    // Пустое тело читать как {}, дальше его отвергать разбор: поля "to" нет.
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string } };
    expect(error.code).toBe('BAD_REQUEST');
  });

  it('слишком большое тело отвергается до чтения в память', async () => {
    const response = await fetch(`${context.baseUrl}/api/laptops/nb-001/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'RESERVED', padding: 'я'.repeat(100_000) }),
    });

    expect(response.status).toBe(413);
    const { error } = (await response.json()) as { error: { code: string } };
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('неизвестный маршрут → 404', async () => {
    const response = await fetch(`${context.baseUrl}/api/нет-такого`);

    expect(response.status).toBe(404);
  });

  it('неподходящий метод на существующем маршруте → 405', async () => {
    const response = await fetch(`${context.baseUrl}/api/laptops/nb-001/status`);

    expect(response.status).toBe(405);
  });
});

/**
 * Как в проде: один процесс отдавать и API, и собранный фронт.
 * В разработке статику давать Vite, STATIC_DIR не задан.
 */
describe('сервер со встроенной раздачей фронтенда', () => {
  let staticRoot: string;

  // Каталог готовить ДО хука сервера: Vitest выполнять хуки по порядку,
  // и useApiServer прочитать уже созданный путь.
  beforeEach(() => {
    staticRoot = mkdtempSync(join(tmpdir(), 'laptop-dist-web-'));
    mkdirSync(join(staticRoot, 'assets'));
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>доска</title>');
    writeFileSync(join(staticRoot, 'assets', 'app-abc.js'), 'console.log(1)');
  });

  const context = useApiServer({ staticRoot: () => staticRoot });

  afterEach(() => {
    rmSync(staticRoot, { recursive: true, force: true });
  });

  it('корень отдаёт разметку, а не JSON', async () => {
    const response = await fetch(`${context.baseUrl}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('доска');
  });

  it('ассеты раздаются', async () => {
    expect((await fetch(`${context.baseUrl}/assets/app-abc.js`)).status).toBe(200);
  });

  it('API продолжает работать и не подменяется разметкой', async () => {
    const response = await fetch(`${context.baseUrl}/api/board`);

    expect(response.headers.get('content-type')).toContain('application/json');
    expect(((await response.json()) as BoardDto).laptops).toHaveLength(6);
  });

  it('несуществующий путь под /api остаётся JSON-ошибкой 404', async () => {
    // Иначе клиент получить HTML вместо ответа API и упасть на разборе JSON.
    const response = await fetch(`${context.baseUrl}/api/нет-такого`);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
