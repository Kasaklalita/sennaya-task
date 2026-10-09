import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const projectRoot = import.meta.dirname;

/** API живёт отдельным процессом; фронт ходит в него через прокси, без CORS. */
const API_PROXY = {
  target: `http://localhost:${process.env['API_PORT'] ?? 5055}`,
  changeOrigin: true,
};

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'web/src'),
      // Домен подключается напрямую из исходников: правила автомата существуют
      // в одном месте, фронтенд их не копирует и не знает о них ничего,
      // кроме того, что сам домен о себе рассказывает.
      '@domain': path.resolve(projectRoot, 'src/index.ts'),
    },
  },
  server: {
    // Домен лежит выше корня Vite — разрешаем его читать.
    fs: { allow: [projectRoot] },
    proxy: { '/api': API_PROXY },
  },
  preview: {
    proxy: { '/api': API_PROXY },
  },
  build: {
    outDir: path.resolve(projectRoot, 'dist-web'),
    emptyOutDir: true,
  },
});
