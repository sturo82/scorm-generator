import { defineConfig, devices } from '@playwright/test';

/**
 * Configurazione E2E del frontend. I test girano contro il mock client
 * in-memory (deterministico, nessun backend/DB richiesto): Playwright avvia il
 * dev server del web e lo pilota con Chromium headless.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build già prodotta; avvia il server di produzione per stabilità.
    command: 'npm run start',
    url: 'http://localhost:3100',
    reuseExistingServer: true,
    timeout: 60_000,
    // Forza il mock client indipendentemente dall'ambiente.
    env: { NEXT_PUBLIC_API_MODE: 'mock' },
  },
});
