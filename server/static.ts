import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

/**
 * Раздача собранного фронтенда.
 *
 * В разработке статику отдаёт Vite, а этот модуль не используется: корень
 * не задан, и всё, что не `/api/*`, получает 404. В продакшене (Docker, Railway)
 * Vite нет, поэтому один процесс обслуживает и API, и файлы — это проще
 * и дешевле, чем поднимать второй сервис ради трёх файлов.
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
 * Превращает путь из URL в путь на диске, не давая выйти за пределы корня.
 *
 * Возвращает `null`, если путь пытается подняться выше (`../../etc/passwd`,
 * закодированные варианты того же). Без этой проверки раздача статики
 * становится чтением произвольного файла на сервере.
 */
export function resolveWithinRoot(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    // Битая процентная кодировка — отказываем, а не угадываем.
    return null;
  }

  // Нулевой байт обрезал бы путь на уровне системного вызова.
  if (decoded.includes('\0')) {
    return null;
  }

  const safeRoot = resolve(root);

  // Ведущие слэши убираем, чтобы resolve() считал путь относительным корню
  // раздачи, а не абсолютным от корня файловой системы. Без этого `/etc/passwd`
  // ушёл бы мимо корня, а проверка ниже оказалась бы недостижимой — она
  // выглядела бы защитой, ничего не защищая.
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
 * Пытается отдать файл. Возвращает `false`, если запрос не про статику, —
 * тогда вызывающий отвечает своим 404.
 *
 * Файлы с хешем в имени (их генерирует Vite) кешируются навсегда, `index.html` —
 * никогда: иначе после деплоя браузер продолжит грузить старую разметку
 * со ссылками на уже удалённые ассеты.
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
    // Путь без расширения — это маршрут приложения: отдаём index.html,
    // чтобы клиентская навигация работала. Отсутствующий `.js` или `.css` —
    // это именно отсутствующий файл, и подменять его разметкой нельзя.
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
