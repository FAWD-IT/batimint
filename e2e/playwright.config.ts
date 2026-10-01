import { defineConfig, devices } from '@playwright/test';

/**
 * Parcours E2E (09) : l'application doit tourner (pnpm dev, ou la stack Docker en CI).
 * E2E_BASE_URL : URL de l'interface ; MAILPIT_URL : API Mailpit pour lire les e-mails.
 */
const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 2 : 3,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    locale: 'fr-BE',
    timezoneId: 'Europe/Brussels',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env['PLAYWRIGHT_CHROMIUM_PATH'] ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, grep: /@mobile/ },
  ],
});
