import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Integration suite. Requires SUPABASE_DB_URL to point at a database with the
 * migrations applied; without it the suite skips rather than passing silently.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globals: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
