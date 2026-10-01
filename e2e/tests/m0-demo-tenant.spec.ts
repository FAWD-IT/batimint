import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, login } from './helpers';

// Le seed de démo (SEED_DEMO=true ou pnpm db:seed) crée Rénov'Habitat et les personas de docs/02.
test.describe('tenant de démonstration', () => {
  test.skip(!process.env['E2E_DEMO'] && !process.env['CI'], 'nécessite le seed de démo (E2E_DEMO=1)');

  test('Marc (Owner) se connecte sur Rénov’Habitat', async ({ page }) => {
    await login(page, 'marc@renov-habitat.be', 'batimint-demo');
    await expect(page.getByRole('heading', { name: 'Bonjour Marc' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Marc Lefèvre/ })).toContainText("Rénov'Habitat");
    await expect(page.getByRole('button', { name: /Marc Lefèvre/ })).toContainText('Patron');
  });

  test('Luca (Ouvrier) ne voit que son compte dans les paramètres', async ({ page }) => {
    await login(page, 'luca@renov-habitat.be', 'batimint-demo');
    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await expect(nav.getByRole('link', { name: 'Équipes' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Paramètres' }).click();
    await expect(page.getByRole('link', { name: /Mon compte/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Entreprise/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Diagnostic/ })).toHaveCount(0);
    await page.goto('/parametres/diagnostic');
    await expect(page.getByText('Accès réservé')).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
