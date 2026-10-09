import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import {
  getBoard,
  getHealth,
  postLaptop,
  postReset,
  postTransition,
  type ApiResponse,
} from './api.js';
import { serveStatic } from './static.js';

/** Тело не может быть бесконечным. Доска маленькая, мегабайт не бывать. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Виноват клиент, не сервер: битый JSON или огромное тело.
 * Отдельный тип нужен, чтобы такое не уезжало в 500.
 */
class ClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ClientError';
    this.status = status;
    this.code = code;
  }
}

function tooLarge(): ClientError {
  return new ClientError(
    413,
    'PAYLOAD_TOO_LARGE',
    `Тело запроса больше ${MAX_BODY_BYTES} байт.`,
  );
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  // Сперва по заголовку: отказать до чтения дешевле, чем после.
  const declaredSize = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    throw tooLarge();
  }

  const chunks: Buffer[] = [];
  let size = 0;

  // Страховка для запросов без content-length (chunked).
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw tooLarge();
    }
    chunks.push(buffer);
  }

  if (size === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ClientError(400, 'BAD_REQUEST', 'Тело запроса не является корректным JSON.');
  }
}

function send(response: ServerResponse, { status, body }: ApiResponse): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

const TRANSITION_ROUTE = /^\/api\/laptops\/([^/]+)\/status$/;

export interface ServerOptions {
  /** Где лежать собранный фронт. Не задан — сервер только API, статику дать Vite. */
  readonly staticRoot?: string | undefined;
}

export async function handleRequest(
  db: DatabaseSync,
  request: IncomingMessage,
  response: ServerResponse,
  options: ServerOptions = {},
): Promise<void> {
  const method = request.method ?? 'GET';
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  try {
    if (method === 'GET' && path === '/api/health') {
      send(response, getHealth(db));
      return;
    }

    if (method === 'GET' && path === '/api/board') {
      send(response, getBoard(db));
      return;
    }

    if (method === 'POST' && path === '/api/laptops') {
      send(response, postLaptop(db));
      return;
    }

    if (method === 'POST' && path === '/api/reset') {
      send(response, postReset(db));
      return;
    }

    const transitionMatch = TRANSITION_ROUTE.exec(path);
    if (transitionMatch !== null) {
      if (method !== 'POST') {
        send(response, {
          status: 405,
          body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'Ожидается POST.' } },
        });
        return;
      }

      const laptopId = decodeURIComponent(transitionMatch[1] ?? '');
      send(response, postTransition(db, laptopId, await readJsonBody(request)));
      return;
    }

    // Не API — значит либо файл фронта, либо правда ничего.
    if (options.staticRoot !== undefined && !path.startsWith('/api/')) {
      if (await serveStatic(options.staticRoot, request, response, path)) {
        return;
      }
    }

    send(response, {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: `Маршрут ${method} ${path} не найден.` } },
    });
  } catch (error) {
    // Остаток тела дочитать и выбросить. Иначе клиент продолжать писать
    // в сокет и соединение повиснуть. Рвать нельзя — ответ ещё не ушёл.
    request.resume();

    if (error instanceof ClientError) {
      send(response, {
        status: error.status,
        body: { error: { code: error.code, message: error.message } },
      });
      return;
    }

    // Сюда падать только настоящие сбои — например битые данные в БД.
    // Отказ бизнес-правила не исключение: он прийти из домена значением.
    const message = error instanceof Error ? error.message : String(error);
    send(response, {
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message } },
    });
  }
}

export function createApiServer(db: DatabaseSync, options: ServerOptions = {}): Server {
  return createServer((request, response) => {
    void handleRequest(db, request, response, options);
  });
}
