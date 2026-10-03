/**
 * M11 — Parcours P11 « Le pilotage de Marc » et P12 « Comptable ».
 * P11 : Aujourd'hui (chiffres du mois, alertes, qui est où, ce qui a bougé), tableau de bord
 * recalculé et filtrable, solde bancaire pour la trésorerie à 90 jours, rapports et export CSV.
 * P12 : connexion comptable, erreur lisible (compte inexistant) corrigée puis relancée, achats et
 * paiements synchronisés, la comptable lit les écritures et exporte par période sans rien modifier.
 */
import { expect, type Page, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  acceptInvitation,
  call,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  signedProject,
  signup,
  uniqueEmail,
} from './helpers';

async function companyReady(page: Page) {
  await call(page.request, 'PATCH', '/company', {
    enterpriseNumber: '0123.456.749',
    street: 'Rue de Montigny 112',
    postalCode: '6000',
    city: 'Charleroi',
    iban: 'BE71 0961 2345 6769',
    bic: 'GKCCBEBB',
  });
}

/** Chantier signé dont l'acompte est émis puis payé en partie aujourd'hui. */
async function billedProject(page: Page, prefix: string) {
  const r = page.request;
  await companyReady(page);
  const { projectId } = await signedProject(page, uniqueEmail(prefix));
  const drafts = await call<{ items: { id: string; type: string }[] }>(
    r,
    'GET',
    `/invoices?view=draft&projectId=${projectId}`,
  );
  const deposit = drafts.items.find((i) => i.type === 'deposit')!;
  await call(r, 'POST', `/invoices/${deposit.id}/issue`);
  const inv = await call<{ number: string; totalGross: number }>(r, 'GET', `/invoices/${deposit.id}`);
  await call(r, 'POST', `/invoices/${deposit.id}/payments`, {
    id: crypto.randomUUID(),
    amount: 100_000,
    receivedOn: new Date().toISOString().slice(0, 10),
    method: 'transfer',
  });
  return { projectId, invoiceId: deposit.id, invoiceNumber: inv.number };
}

test('P11 : Aujourd’hui, tableau de bord filtrable, trésorerie, rapports et export', async ({ page }) => {
  test.setTimeout(240_000);
  await signup(page, { name: 'Marc Pilotage', company: 'Rénov Pilotage P11' });
  const r = page.request;
  const { projectId } = await billedProject(page, 'dupont-p11');
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await call(r, 'POST', `/projects/${projectId}/status`, { to: 'in_progress' });
  await call(r, 'PATCH', `/projects/${projectId}`, {
    startDate: new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10),
    endDate: yesterday,
  });
  const karim = await call<{ id: string }>(r, 'POST', '/employees', {
    firstName: 'Karim',
    lastName: 'Benali',
    hourlyCost: 4400,
  });
  const team = await call<{ id: string }>(r, 'POST', '/teams', {
    name: 'Équipe Karim',
    color: '#2F4BFF',
    leaderEmployeeId: karim.id,
    memberIds: [karim.id],
  });
  await call(r, 'PATCH', `/projects/${projectId}`, { teamId: team.id });
  await call(r, 'POST', '/field/clock', {
    id: crypto.randomUUID(),
    projectId,
    employeeId: karim.id,
    kind: 'in',
    at: new Date(Date.now() - 3_600_000).toISOString(),
  });

  // 1. Aujourd'hui : chiffres du mois, alertes, qui est où, ce qui a bougé depuis hier.
  await page.goto('/aujourdhui');
  await expect(page.getByRole('heading', { name: 'Bonjour Marc' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Encaissé ce mois\s*1\s000,00\s€/ })).toBeVisible();
  const alerts = page.getByTestId('today-alerts');
  await expect(alerts).toContainText('En retard : Rénovation salle de bain');
  const sites = page.getByTestId('today-sites');
  await expect(sites).toContainText('Rénovation salle de bain');
  await expect(sites).toContainText(/Karim Benali · Sur place depuis \d{2}:\d{2}/);
  await expect(page.getByRole('heading', { name: 'Ce qui a bougé depuis hier' })).toBeVisible();
  await expectNoA11yViolations(page);

  // 2. Tableau de bord : chiffres recalculés, filtres par période et équipe.
  await page.getByRole('link', { name: 'Voir le tableau de bord' }).click();
  await expect(page.getByRole('heading', { name: 'Pilotage' })).toBeVisible();
  const kpis = page.getByTestId('dashboard-kpis');
  await expect(kpis).toContainText(/Encaissé\s*1\s000,00\s€/);
  await expect(kpis).toContainText('Carnet de commandes');
  await page.getByRole('tab', { name: 'Année' }).click();
  await expect(page).toHaveURL(/periode=year/);
  await page.getByLabel('Équipe').selectOption({ label: 'Équipe Karim' });
  await expect(
    page.getByText('L’équipe et le responsable filtrent les chiffres des chantiers'),
  ).toBeVisible();
  await expect(page.getByRole('table', { name: 'Marge par chantier' })).toContainText(
    'Rénovation salle de bain',
  );
  await page.locator('summary', { hasText: 'Tableau des montants par mois' }).click();
  await expect(page.getByRole('table', { name: 'Tableau des montants par mois' })).toBeVisible();
  await expectNoA11yViolations(page);

  // 3. Trésorerie : le solde bancaire devient le point de départ.
  const cash = page.getByTestId('dashboard-cash');
  await expect(cash).toContainText('Flux nets cumulés');
  await cash.getByRole('button', { name: 'Solde bancaire' }).click();
  const dialog = page.getByRole('dialog', { name: 'Solde bancaire actuel' });
  await dialog.getByLabel('Solde').fill('25000');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(cash).toContainText(/Solde de 25\s000,00\s€ au/);
  await expect(cash).toContainText('Salaires estimés');

  // 4. Rapports : rentabilité par client, carnet de commandes, export CSV.
  await page.getByRole('link', { name: 'Rapports et exports' }).click();
  await expect(page.getByRole('heading', { name: 'Rapports' })).toBeVisible();
  await page.getByRole('tab', { name: 'Client' }).click();
  await expect(page.getByRole('table', { name: 'Rentabilité' })).toContainText('Jean Dupont');
  await page.getByRole('tab', { name: 'Carnet de commandes' }).click();
  await expect(page.getByRole('table', { name: 'Carnet de commandes' })).toContainText(
    'Rénovation salle de bain',
  );
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Exporter en CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^carnet-commandes-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('Chantier;Client;Contrat HTVA;Facturé HTVA;Reste à facturer;Fin prévue');
  expect(csv).toContain('Rénovation salle de bain;Jean Dupont;');

  // 5. Carte des chantiers actifs : position approchée par le code postal, qui est sur place.
  await page.goto('/chantiers');
  await page.getByRole('link', { name: 'Carte' }).click();
  await expect(page.getByRole('heading', { name: 'Carte des chantiers' })).toBeVisible();
  const list = page.getByRole('list', { name: 'Chantiers actifs' });
  await expect(list).toContainText('Rénovation salle de bain');
  await expect(list).toContainText('1 sur place');
  await expect(
    page.getByRole('link', { name: /Rénovation salle de bain · En cours · 1 sur place/ }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // 6. Mobile : rien ne déborde.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pilotage');
  await expect(page.getByTestId('dashboard-kpis')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('P12 : synchro comptable, erreur lisible corrigée, la comptable lit et exporte', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await signup(page, { name: 'Marc Compta', company: 'Rénov Compta P12' });
  const r = page.request;
  const { projectId, invoiceNumber } = await billedProject(page, 'dupont-p12');
  const supplier = await call<{ id: string }>(r, 'POST', '/suppliers', {
    name: 'Brico Pro SA',
    enterpriseNumber: '0456.789.034',
  });
  const si = await call<{ id: string; totalNet: number }>(
    r,
    'POST',
    '/integrations/peppol/simulate-inbound',
    {
      supplierId: supplier.id,
      number: 'F-P12-1',
      lines: [{ description: 'Colle carrelage', quantity: '10', unitPrice: 1890, vatRate: '21' }],
    },
  );

  // 1. Non connectée : un compte de ventes mal saisi, puis connexion.
  await page.goto('/comptabilite');
  await expect(page.getByRole('heading', { name: 'Comptabilité' })).toBeVisible();
  await expect(page.getByText('Connectez le logiciel de votre comptable')).toBeVisible();
  await page.getByText('Paramétrage', { exact: true }).click();
  const mapping = page.getByTestId('accounting-mapping');
  await mapping.getByLabel('Ventes (travaux)').fill('709999');
  await mapping.getByRole('button', { name: 'Enregistrer le paramétrage' }).click();
  await expect(page.getByText('Paramétrage enregistré')).toBeVisible();
  await page.getByRole('button', { name: 'Connecter la comptabilité' }).click();
  await expect(page.getByTestId('accounting-connection')).toContainText('Connectée à WinBooks (simulation)');

  // 2. La vente est refusée avec un message lisible ; le paiement part.
  await page.getByRole('tab', { name: /En erreur/ }).click();
  const error = page.getByRole('note').filter({ hasText: invoiceNumber });
  await expect(error).toContainText(
    `refuse la pièce ${invoiceNumber} : le compte 709999 n’existe pas dans le plan comptable`,
    {
      timeout: 30_000,
    },
  );
  await expectNoA11yViolations(page);

  // 3. Correction du paramétrage (liste du logiciel) puis relance.
  if (!(await mapping.getByLabel('Ventes (travaux)').isVisible()))
    await page.getByText('Paramétrage', { exact: true }).click();
  await mapping.getByLabel('Ventes (travaux)').selectOption('700000');
  await mapping.getByRole('button', { name: 'Enregistrer le paramétrage' }).click();
  await page.getByRole('button', { name: `Relancer ${invoiceNumber}` }).click();
  await page.getByRole('tab', { name: 'Synchronisés' }).click();
  await expect(page.getByRole('link', { name: invoiceNumber, exact: true })).toBeVisible({ timeout: 30_000 });

  // 4. Un achat imputé part dans le journal des achats.
  await call(r, 'POST', `/supplier-invoices/${si.id}/allocate`, {
    allocations: [{ projectId, budgetLineId: null, amount: si.totalNet }],
  });
  await expect(page.getByRole('link', { name: 'F-P12-1', exact: true })).toBeVisible({ timeout: 30_000 });

  // 5. La comptable : lecture des écritures, exports par période, aucun réglage.
  const accountantEmail = uniqueEmail('lambert-p12');
  await call(r, 'POST', '/invitations', { email: accountantEmail, role: 'accountant' });
  const ctx = await browser.newContext({ locale: 'fr-BE', timezoneId: 'Europe/Brussels' });
  const a = await ctx.newPage();
  await acceptInvitation(a, accountantEmail, 'Isabelle Lambert');
  await a.goto('/comptabilite');
  await expect(a.getByTestId('accounting-connection')).toContainText('Connectée à WinBooks (simulation)');
  await expect(a.getByRole('button', { name: 'Connecter la comptabilité' })).toHaveCount(0);
  await expect(a.getByTestId('accounting-mapping')).toHaveCount(0);
  await a.getByRole('button', { name: `Écriture de ${invoiceNumber}` }).click();
  await expect(a.getByRole('cell', { name: '400000', exact: true })).toBeVisible();
  await expect(a.getByRole('cell', { name: '700000', exact: true }).first()).toBeVisible();
  const [download] = await Promise.all([
    a.waitForEvent('download'),
    a.getByRole('link', { name: 'Ventes · CSV' }).click(),
  ]);
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('Journal;Numéro;Date;Échéance;Client');
  expect(csv).toContain(`VEN;${invoiceNumber};`);
  await expectNoA11yViolations(a);
  await ctx.close();
});
