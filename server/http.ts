import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import { getBoard, postReset, postTransition, type ApiResponse } from './api.js';

/** Защита от бесконечного тела запроса. Доска маленькая, мегабайт не бывает. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Ошибка клиента, а не сбой сервера: битый JSON или слишком большое тело.
 * Отдельный тип нужен, чтобы такие случаи не превращались в 500.
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
  // Сначала по заголовку: отказать до чтения дешевле, чем после.
  const declaredSize = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    throw tooLarge();
  }

  const chunks: Buffer[] = [];
  let size = 0;

  // Страховка для запросов без content-length (chunked transfer-encoding).
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

export async function handleRequest(
  db: DatabaseSync,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? 'GET';
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  try {
    if (method === 'GET' && path === '/api/board') {
      send(response, getBoard(db));
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

    send(response, {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: `Маршрут ${method} ${path} не найден.` } },
    });
  } catch (error) {
    // Остаток тела нужно дочитать и выбросить: если этого не сделать, клиент
    // продолжит писать в сокет, а соединение повиснет. Рвать его нельзя —
    // ответ ещё не ушёл.
    request.resume();

    if (error instanceof ClientError) {
      send(response, {
        status: error.status,
        body: { error: { code: error.code, message: error.message } },
      });
      return;
    }

    // Сюда попадают только настоящие сбои — например повреждённые данные в БД.
    // Отказы бизнес-правил исключениями не являются: они приходят из домена
    // как значение и обрабатываются выше.
    const message = error instanceof Error ? error.message : String(error);
    send(response, {
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message } },
    });
  }
}

export function createApiServer(db: DatabaseSync): Server {
  return createServer((request, response) => {
    void handleRequest(db, request, response);
  });
}
