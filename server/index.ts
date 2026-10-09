import { seedDatabase } from './api.js';
import { openDatabase } from './db.js';
import { createApiServer } from './http.js';

/**
 * Точка входа процесса.
 *
 * Все настройки — через переменные окружения, потому что именно так их задаёт
 * платформа: Railway сам подставляет `PORT`, а путь к базе должен указывать
 * на примонтированный том, иначе данные исчезнут при следующем деплое.
 */

// Railway подставляет PORT сам. 5055 — локальное умолчание:
// 3000/3001 слишком часто заняты чем-нибудь посторонним.
const PORT = Number(process.env['PORT'] ?? 5055);

// В Docker это путь внутрь тома (например /data/laptops.db).
const DB_PATH = process.env['DB_PATH'] ?? 'data/laptops.db';

// Каталог собранного фронтенда. Не задан — сервер работает как чистый API,
// а статику в разработке раздаёт Vite.
const STATIC_DIR = process.env['STATIC_DIR'];

const db = openDatabase(DB_PATH);
seedDatabase(db);

const server = createApiServer(db, { staticRoot: STATIC_DIR });

// 0.0.0.0, а не localhost: внутри контейнера слушать только петлю —
// значит не принять ни одного запроса снаружи.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Слушаю :${PORT} · база ${DB_PATH} · статика ${STATIC_DIR ?? 'не раздаётся'}`);
});

function shutdown(signal: string): void {
  console.log(`${signal}: закрываю сервер и базу`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

// Платформа останавливает контейнер через SIGTERM. Без обработчика процесс
// умрёт жёстко, не дописав WAL-журнал SQLite на диск.
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
