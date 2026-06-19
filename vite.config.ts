/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site: assets must be served from /<repo-name>/.
// Override with VITE_BASE for local builds or a different host.
const base = process.env.VITE_BASE ?? '/loyalty-system/';

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
