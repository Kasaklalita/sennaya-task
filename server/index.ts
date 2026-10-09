import { seedDatabase } from './api.js';
import { openDatabase } from './db.js';
import { createApiServer } from './http.js';

/**
 * Вход процесса.
 *
 * Настройки через переменные окружения — так их задавать платформа. Railway
 * сам подставить PORT, а путь к базе обязан смотреть на том: иначе данные
 * пропасть при следующем деплое.
 */

// PORT подставлять Railway. 5055 — местное умолчание: 3000/3001 часто заняты.
const PORT = Number(process.env['PORT'] ?? 5055);

// В Docker это путь внутрь тома, например /data/laptops.db.
const DB_PATH = process.env['DB_PATH'] ?? 'data/laptops.db';

// Где собранный фронт. Не задан — сервер чистый API, статику дать Vite.
const STATIC_DIR = process.env['STATIC_DIR'];

const db = openDatabase(DB_PATH);
seedDatabase(db);

const server = createApiServer(db, { staticRoot: STATIC_DIR });

// 0.0.0.0, не localhost: в контейнере петля = ноль запросов снаружи.
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

// Платформа гасить контейнер через SIGTERM. Без обработчика процесс умереть
// жёстко, не дописав WAL-журнал SQLite на диск.
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
