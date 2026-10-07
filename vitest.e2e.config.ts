import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Configurazione per i test end-to-end che richiedono un Postgres reale
 * (DATABASE_URL con migrazioni applicate). Separata dalla suite unitaria così
 * `npm test` resta senza dipendenze da infrastruttura.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@scorm/contracts', replacement: r('./packages/contracts/src/index.ts') },
      { find: '@scorm/domain', replacement: r('./packages/domain/src/index.ts') },
      { find: '@scorm/scorm', replacement: r('./packages/scorm/src/index.ts') },
      { find: '@scorm/adapters/testing', replacement: r('./packages/adapters/src/testing/index.ts') },
      { find: '@scorm/adapters/aws', replacement: r('./packages/adapters/src/aws/index.ts') },
      { find: '@scorm/adapters/pgvector', replacement: r('./packages/adapters/src/pgvector/index.ts') },
      { find: '@scorm/adapters/extractors', replacement: r('./packages/adapters/src/extractors/index.ts') },
      { find: '@scorm/adapters/bedrock', replacement: r('./packages/adapters/src/bedrock/index.ts') },
      { find: '@scorm/adapters', replacement: r('./packages/adapters/src/index.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/**/test/e2e/**/*.e2e.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    // Esecuzione seriale: i test E2E condividono il database.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
