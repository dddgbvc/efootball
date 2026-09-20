import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit suite: pure engine logic, no I/O. Runs everywhere, including CI without
 * a database. The integration suite lives in vitest.integration.config.ts
 * because it needs a real PostgreSQL server.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/integration/**'],
    globals: false,
  },
});
