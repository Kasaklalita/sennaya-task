import { seedDatabase } from './api.js';
import { openDatabase } from './db.js';
import { createApiServer } from './http.js';

// 3000/3001 слишком часто заняты чем-нибудь посторонним — берём порт поспокойнее.
// Переопределяется переменной окружения PORT (и API_PORT для прокси Vite).
const PORT = Number(process.env['PORT'] ?? 5055);
const DB_PATH = process.env['DB_PATH'] ?? 'data/laptops.db';

const db = openDatabase(DB_PATH);
seedDatabase(db);

const server = createApiServer(db);

server.listen(PORT, () => {
  console.log(`API: http://localhost:${PORT}/api/board  (база: ${DB_PATH})`);
});

function shutdown(signal: string): void {
  console.log(`\n${signal}: закрываю сервер и базу`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
