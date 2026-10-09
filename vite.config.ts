import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const projectRoot = import.meta.dirname;

/** API жить отдельным процессом. Фронт ходить к нему через прокси, без CORS. */
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
      // Домен брать прямо из исходников. Правила жить в одном месте, фронт
      // их не копировать и знать только то, что домен сам рассказать.
      '@domain': path.resolve(projectRoot, 'src/index.ts'),
    },
  },
  server: {
    // Домен лежать выше корня Vite — разрешить его читать.
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
