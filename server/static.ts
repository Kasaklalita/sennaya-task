import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

/**
 * Раздать собранный фронт.
 *
 * В разработке статику давать Vite, этот модуль спать: корень не задан, всё
 * кроме /api/* получать 404. В проде Vite нет — один процесс обслуживать и
 * API, и файлы. Проще и дешевле, чем второй сервис ради трёх файлов.
 */

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Путь из URL → путь на диске, не давая вылезти за корень.
 *
 * `null`, если путь лезть вверх (`../../etc/passwd` и закодированные
 * варианты). Без этой проверки раздача статики стать чтением любого
 * файла на сервере.
 */
export function resolveWithinRoot(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    // Процентная кодировка битая — отказать, не угадывать.
    return null;
  }

  // Нулевой байт обрезать путь на уровне системного вызова.
  if (decoded.includes('\0')) {
    return null;
  }

  const safeRoot = resolve(root);

  // Ведущие слэши убрать, чтобы resolve() считал путь ОТ корня раздачи,
  // а не от корня диска. Без этого `/etc/passwd` уйти мимо, а проверка ниже
  // стать недостижимой — выглядеть защитой, не защищая ничего.
  const candidate = resolve(safeRoot, decoded.replace(/^\/+/, ''));

  if (candidate !== safeRoot && !candidate.startsWith(safeRoot + sep)) {
    return null;
  }

  return candidate;
}

async function readFileIfExists(filePath: string): Promise<Buffer | null> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return null;
    }
    return await readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Попробовать отдать файл. `false` — запрос не про статику, пусть вызывающий
 * отвечает своим 404.
 *
 * Файл с хешем в имени (их делать Vite) кешировать навсегда, `index.html` —
 * никогда: иначе после деплоя браузер тянуть старую разметку со ссылками
 * на уже удалённые файлы.
 */
export async function serveStatic(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }

  const resolved = resolveWithinRoot(root, pathname);
  if (resolved === null) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return true;
  }

  const isDirectoryRequest = pathname.endsWith('/') || extname(pathname) === '';
  const candidate = isDirectoryRequest ? join(resolved, 'index.html') : resolved;

  let body = await readFileIfExists(candidate);
  let filePath = candidate;

  if (body === null) {
    // Путь без расширения — маршрут приложения: дать index.html, чтобы
    // навигация работала. А пропавший `.js` — это пропавший файл,
    // подменять его разметкой нельзя.
    if (extname(pathname) !== '') {
      return false;
    }

    filePath = join(resolve(root), 'index.html');
    body = await readFileIfExists(filePath);
    if (body === null) {
      return false;
    }
  }

  const isHtml = extname(filePath) === '.html';

  response.writeHead(200, {
    'content-type': contentTypeFor(filePath),
    'content-length': body.length,
    'cache-control': isHtml ? 'no-store' : 'public, max-age=31536000, immutable',
  });

  response.end(method === 'HEAD' ? undefined : body);
  return true;
}
