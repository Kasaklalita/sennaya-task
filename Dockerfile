# syntax=docker/dockerfile:1

# ============================ Сборка ============================
FROM node:22-slim AS build

WORKDIR /app

# Сперва только манифесты: слой с зависимостями переиспользоваться, пока
# package-lock.json не менялся. Копировать весь проект до npm ci — значит
# ставить зависимости заново после правки одной строки.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json tsconfig.web.json vite.config.ts components.json ./
COPY src ./src
COPY server ./server
COPY web ./web

# Домен и сервер идти в dist-server/, фронт в dist-web/.
RUN npm run build:server && npm run build:web

# ============================ Запуск ============================
# Собирать на slim (glibc): там предсказуемо ставиться бинарники rollup
# и esbuild. Запускать на alpine: в финальном образе только скомпилированный
# JS, нативных модулей нет, образ легче на 110 МБ.
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    STATIC_DIR=/app/dist-web \
    DB_PATH=/data/laptops.db

# node_modules НЕ копировать: рантайм-зависимость ноль. База — встроенный
# node:sqlite, HTTP — node:http. В образе остаться только готовый JavaScript.
#
# package.json нужен одной строкой "type": "module". Без неё Node прочитать
# .js как CommonJS и упасть на первом import.
COPY package.json ./
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist-web ./dist-web

# Каталог под том. Railway монтировать volume сюда. Без тома база жить
# только до следующего деплоя: файловая система контейнера эфемерна.
RUN mkdir -p /data && chown -R node:node /data /app

# Не root: процессу его права не нужны.
# Платформа примонтирует том от root и писать не выйдет — приложение скажет
# это текстом (см. openDatabase). Чинить правами на точку монтирования
# либо удалением этой строки.
USER node

EXPOSE 5055

# Платформа обычно звать свою проверку (healthcheckPath в railway.json),
# но локальному docker run она тоже пригодиться.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5055)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Порт брать из PORT — его подставлять Railway.
CMD ["node", "--disable-warning=ExperimentalWarning", "dist-server/server/index.js"]
