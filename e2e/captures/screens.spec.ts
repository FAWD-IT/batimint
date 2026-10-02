/**
 * Revue visuelle : captures des écrans livrés sur le tenant de démo (seed).
 * Chaque capture est indépendante : un écran en erreur n'empêche pas les suivants.
 */
import { type Browser, type Page, test } from '@playwright/test';

const PASSWORD = 'batimint-demo';
const OUT = 'captures-out';
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function session(browser: Browser, email: string, viewport: { width: number; height: number }, dark = false) {
  const ctx = await browser.newContext({
    viewport,
    locale: 'fr-BE',
    timezoneId: 'Europe/Brussels',
    colorScheme: dark ? 'dark' : 'light',
    deviceScaleFactor: viewport.width < 500 ? 2 : 1,
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
  });
  const page = await ctx.newPage();
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/connexion'), { timeout: 30_000 });
  return page;
}

async function shot(page: Page, name: string, path?: string, prepare?: (p: Page) => Promise<void>) {
  try {
    if (path) await page.goto(path, { waitUntil: 'load', timeout: 45_000 });
    if (prepare) await prepare(page);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log(`OK   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${(e as Error).message.split('\n')[0]}`);
    await page.screenshot({ path: `${OUT}/${name}--erreur.png`, fullPage: true }).catch(() => {});
  }
}

test('captures des écrans livrés', async ({ browser }) => {
  // Bureau — Sophie (rôle Bureau)
  const office = await session(browser, 'sophie@renov-habitat.be', DESKTOP);
  await shot(office, '01-aujourdhui', '/aujourdhui');
  await shot(office, '02-chantiers-liste', '/chantiers');

  let projectId: string | null = null;
  await shot(office, '03-cockpit-dupont', '/chantiers', async (p) => {
    await p.getByRole('tab', { name: /En cours/ }).click().catch(() => {});
    await p.getByRole('link', { name: /Dupont/ }).first().click();
    await p.waitForURL(/\/chantiers\/[0-9a-f-]{36}/);
    projectId = /\/chantiers\/([0-9a-f-]{36})/.exec(p.url())?.[1] ?? null;
  });
  for (const tab of ['Tâches', 'Photos', 'Avenants', 'Budget', 'Terrain']) {
    await shot(office, `04-cockpit-onglet-${tab.toLowerCase()}`, undefined, async (p) => {
      await p.getByRole('tab', { name: new RegExp(tab) }).first().click();
    });
  }
  await shot(office, '05-palette-cmdk', projectId ? `/chantiers/${projectId}` : '/chantiers', async (p) => {
    await p.waitForTimeout(1500);
    await p.keyboard.press('Control+k');
  });
  await shot(office, '06-planning', '/planning');
  await shot(office, '07-devis-liste', '/devis');
  await shot(office, '08-devis-editeur', '/devis', async (p) => {
    await p.locator('a[href^="/devis/"]').first().click();
    await p.waitForURL(/\/devis\/[0-9a-f-]{36}/);
  });
  await shot(office, '09-opportunites-kanban', '/opportunites');
  await shot(office, '10-clients', '/clients');
  await shot(office, '11-bibliotheque', '/bibliotheque');
  await shot(office, '12-equipes', '/equipes');
  await shot(office, '13-parametres-entreprise', '/parametres/entreprise');
  await shot(office, '14-parametres-metier', '/parametres/metier');

  // Portail client (lien généré comme depuis le cockpit)
  let portal: string | null = null;
  if (projectId) {
    const res = await office.request.post(`/api/v1/projects/${projectId}/portal-link`, { data: {} });
    if (res.ok()) portal = new URL(((await res.json()) as { url: string }).url).pathname;
    else console.log(`FAIL portal-link: ${res.status()} ${await res.text()}`);
  }

  // Mode sombre du cockpit
  const dark = await session(browser, 'marc@renov-habitat.be', DESKTOP, true);
  if (projectId) await shot(dark, '15-cockpit-sombre', `/chantiers/${projectId}`);
  await shot(dark, '16-aujourdhui-marc', '/aujourdhui');

  // Cockpit sur téléphone (bureau en déplacement)
  const officePhone = await session(browser, 'sophie@renov-habitat.be', PHONE);
  if (projectId) await shot(officePhone, '17-cockpit-telephone', `/chantiers/${projectId}`);

  // Terrain — Luca (Ouvrier) et Karim (chef de chantier)
  const luca = await session(browser, 'luca@renov-habitat.be', PHONE);
  await shot(luca, '20-terrain-luca', '/terrain');
  await shot(luca, '21-terrain-planning', '/terrain/planning');
  await shot(luca, '22-terrain-heures', '/terrain/heures');
  const karim = await session(browser, 'karim@renov-habitat.be', PHONE);
  await shot(karim, '23-terrain-karim-chef', '/terrain');
  await shot(karim, '24-terrain-rapport', '/terrain/rapport');

  // Portail client — M. Dupont, sans compte
  if (portal) {
    const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-BE' });
    const client = await ctx.newPage();
    await shot(client, '30-portail-client', portal);
  }

  // Écrans publics
  const anon = await (await browser.newContext({ viewport: DESKTOP, locale: 'fr-BE' })).newPage();
  await shot(anon, '40-connexion', '/connexion');
  await shot(anon, '41-inscription', '/inscription');
});
