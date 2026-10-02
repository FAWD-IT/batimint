import { defineConfig } from '@playwright/test';

/** Captures d'écran de revue (branche revue-captures uniquement). */
export default defineConfig({
  testDir: './captures',
  timeout: 600_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    locale: 'fr-BE',
    timezoneId: 'Europe/Brussels',
  },
});
