import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Risolve i workspace e i loro subpath ai sorgenti, così i test girano
    // senza richiedere il build dei pacchetti (dist).
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
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // Gli E2E (che richiedono un DB reale) hanno una config dedicata.
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/**/src/**', 'apps/**/src/**'],
    },
  },
});
