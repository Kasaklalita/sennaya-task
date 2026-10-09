# syntax=docker/dockerfile:1

# ============================ Сборка ============================
FROM node:22-slim AS build

WORKDIR /app

# Сначала только манифесты: слой с установкой зависимостей переиспользуется,
# пока package-lock.json не изменился. Копировать весь проект до npm ci —
# значит переустанавливать зависимости после правки одной строки в компоненте.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json tsconfig.web.json vite.config.ts components.json ./
COPY src ./src
COPY server ./server
COPY web ./web

# Домен и сервер компилируются в dist-server/, фронтенд собирается в dist-web/.
RUN npm run build:server && npm run build:web

# ============================ Запуск ============================
# Сборка идёт на slim (glibc): там предсказуемо ставятся платформенные
# бинарники rollup/esbuild. Запуск — на alpine: в финальном образе остаётся
# только скомпилированный JS, нативных модулей нет, а образ на 110 МБ легче.
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    STATIC_DIR=/app/dist-web \
    DB_PATH=/data/laptops.db

# node_modules НЕ копируем: у приложения ноль рантайм-зависимостей —
# база это встроенный node:sqlite, HTTP это node:http. В образе остаётся
# только скомпилированный JavaScript.
#
# package.json нужен единственной строкой "type": "module": без него Node
# прочитает .js как CommonJS и упадёт на первом import.
COPY package.json ./
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist-web ./dist-web

# Каталог под том. Railway монтирует volume сюда; без тома база живёт
# только до следующего деплоя — файловая система контейнера эфемерна.
RUN mkdir -p /data && chown -R node:node /data /app

# Не root: процессу не нужны его права.
# Если платформа примонтирует том от имени root и приложение не сможет писать —
# оно скажет об этом понятным текстом (см. openDatabase), а чинится это либо
# правами на точку монтирования, либо удалением этой строки.
USER node

EXPOSE 5055

# Платформа обычно использует свою проверку (healthcheckPath в railway.json),
# но локальному docker run и compose она тоже пригодится.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5055)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Порт берётся из переменной PORT — её подставляет Railway.
CMD ["node", "--disable-warning=ExperimentalWarning", "dist-server/server/index.js"]
