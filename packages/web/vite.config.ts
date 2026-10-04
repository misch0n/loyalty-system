/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site: assets must be served from /<repo-name>/.
// Override with VITE_BASE for local builds or a different host.
const base = process.env.VITE_BASE ?? '/loyalty-system/';

// The API a local `vite` dev server forwards `/api` to — `npm run dev -w @cafe/server`.
const apiTarget = process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig(({ command, isPreview }) => ({
  // The dev server serves from `/`, so `APP_URL=http://localhost:5173` card links resolve.
  // `vite preview` serves a built bundle, so it keeps the base that bundle was built with.
  base: command === 'serve' && !isPreview ? '/' : base,
  plugins: [react()],
  server: {
    // Same contract as `ops/nginx/default.conf`: one origin, `/api` stripped before the API
    // sees it. The browser's `Origin` stays `http://localhost:5173`, which the server's
    // ALLOWED_ORIGINS must name.
    proxy: {
      '/api': {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    globals: true,
    // Two projects — `ui` (jsdom, stubbed services) and `live` (the real server).
    workspace: './vitest.projects.ts',
  },
}));
