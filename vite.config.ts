import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'chrome120', chunkSizeWarningLimit: 2500 },
  worker: { format: 'es' },
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 20000 },
});
