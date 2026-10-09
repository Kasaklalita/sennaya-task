import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveWithinRoot, serveStatic } from '../../server/static.js';

describe('защита от выхода за пределы каталога', () => {
  const root = '/srv/app/dist-web';

  /**
   * Проверять напрямую, не запросом: `new URL()` нормализовать путь раньше,
   * чем до него дойти приложение, и через сеть сюда не достучаться. Но
   * полагаться на чужую нормализацию как на единственную защиту нельзя —
   * раздача статики без своей проверки стать чтением любого файла.
   */
  it.each([
    ['выход вверх', '/../../etc/passwd'],
    ['выход вверх из подкаталога', '/assets/../../../etc/passwd'],
    ['закодированный выход', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd'],
    ['путь не от корня', '../etc/passwd'],
    ['нулевой байт', '/index.html%00.png'],
    ['битая процентная кодировка', '/%E0%A4%A'],
  ])('отвергает: %s', (_name, path) => {
    expect(resolveWithinRoot(root, path)).toBeNull();
  });

  it.each([
    ['корень', '/', '/srv/app/dist-web'],
    ['файл', '/index.html', '/srv/app/dist-web/index.html'],
    ['вложенный ассет', '/assets/index-abc123.js', '/srv/app/dist-web/assets/index-abc123.js'],
    ['безопасный подъём внутри корня', '/assets/../index.html', '/srv/app/dist-web/index.html'],
    ['кириллица в имени', '/файл.css', '/srv/app/dist-web/файл.css'],
  ])('пропускает: %s', (_name, path, expected) => {
    expect(resolveWithinRoot(root, path)).toBe(expected);
  });
});

describe('раздача собранного фронтенда', () => {
  let directory: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'laptop-static-'));
    mkdirSync(join(directory, 'assets'));
    writeFileSync(join(directory, 'index.html'), '<!doctype html><title>доска</title>');
    writeFileSync(join(directory, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(directory, 'assets', 'index-abc123.css'), 'body{}');

    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      void serveStatic(directory, request, response, pathname).then((handled) => {
        if (!handled) {
          response.writeHead(404).end('нет');
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    rmSync(directory, { recursive: true, force: true });
  });

  it('корень отдаёт index.html и запрещает его кешировать', async () => {
    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    // Иначе после деплоя браузер тянуть старую разметку со ссылками
    // на уже удалённые файлы.
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('доска');
  });

  it.each([
    ['/assets/index-abc123.js', 'text/javascript'],
    ['/assets/index-abc123.css', 'text/css'],
  ])('отдаёт %s с правильным типом и вечным кешем', async (path, type) => {
    const response = await fetch(`${baseUrl}${path}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(type);
    // В имени хеш содержимого — файл неизменен по определению.
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('неизвестный путь без расширения — это маршрут приложения, отдаём index.html', async () => {
    const response = await fetch(`${baseUrl}/какой-то/маршрут`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('доска');
  });

  it('отсутствующий ассет — это 404, а не разметка', async () => {
    // Подменять пропавший .js разметкой нельзя: браузер попробовать
    // выполнить HTML как скрипт и выдать муть вместо честного 404.
    expect((await fetch(`${baseUrl}/assets/нет-такого.js`)).status).toBe(404);
  });

  it('HEAD отвечает заголовками без тела', async () => {
    const response = await fetch(`${baseUrl}/assets/index-abc123.js`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('14');
    expect(await response.text()).toBe('');
  });

  it('не-GET запросы статика не обслуживает', async () => {
    expect((await fetch(`${baseUrl}/index.html`, { method: 'POST' })).status).toBe(404);
  });

  it('попытка выхода за корень получает 403', async () => {
    const request = { method: 'GET', headers: {} } as never;
    let status = 0;
    const response = {
      writeHead(code: number) {
        status = code;
        return this;
      },
      end() {
        return this;
      },
    } as never;

    // Путь идти мимо `new URL()`, как будто его собрал другой слой.
    // Не от корня — значит подъём не схлопнуться и сработать отказ.
    const handled = await serveStatic(directory, request, response, '../../etc/passwd');

    expect(handled).toBe(true);
    expect(status).toBe(403);
  });

  it('каталог без index.html запрос не обслуживает', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'laptop-empty-'));
    const request = { method: 'GET', headers: {} } as never;
    const response = { writeHead: () => response, end: () => response } as never;

    // Отдавать нечего — пусть вызывающий ответит своим 404,
    // а не выдумывает пустую страницу.
    expect(await serveStatic(empty, request, response, '/')).toBe(false);

    rmSync(empty, { recursive: true, force: true });
  });

  it('каталог никогда не отдаётся листингом', async () => {
    // /assets/ — путь без расширения, значит маршрут приложения: дать
    // index.html. Главное, чего тут быть не должно, — списка файлов.
    const response = await fetch(`${baseUrl}/assets/`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('доска');
    expect(body).not.toContain('index-abc123.js');
  });

  it('каталог, притворившийся файлом, не отдаётся', async () => {
    // Защита: на диске окажется каталог с именем вида `app.js` — отдавать
    // его как файл нельзя. Это 404, а не попытка чтения.
    mkdirSync(join(directory, 'assets', 'подделка.js'));

    expect((await fetch(`${baseUrl}/assets/подделка.js`)).status).toBe(404);
  });
});
