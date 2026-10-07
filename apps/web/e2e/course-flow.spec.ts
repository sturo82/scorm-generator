import { test, expect } from '@playwright/test';

/**
 * E2E del flusso principale del frontend contro il mock client:
 * login → dashboard → creazione corso → pagina corso con tab Brief.
 * Non richiede backend né DB (dati in-memory).
 */

test('landing mostra la hero e porta al login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /generati con l'AI/i })).toBeVisible();
});

test('login → dashboard → crea corso → pagina corso', async ({ page }) => {
  // Login mock.
  await page.goto('/login');
  await page.getByTestId('login-button').click();

  // Dashboard.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Vai a nuovo corso.
  await page.goto('/courses/new');
  await page.getByTestId('course-title').fill('Corso E2E');
  await page.getByTestId('course-submit').click();

  // Atterra sulla pagina del corso con il titolo e il tab Brief.
  await expect(page).toHaveURL(/\/courses\/.+/);
  await expect(page.getByRole('heading', { name: 'Corso E2E' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Brief' })).toBeVisible();
});

test('navigazione: knowledge e brand sono raggiungibili', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-button').click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/knowledge');
  await expect(page.getByRole('heading', { name: 'Knowledge base' })).toBeVisible();

  await page.goto('/brands');
  await expect(page.getByRole('heading', { name: 'Brand' })).toBeVisible();
});
