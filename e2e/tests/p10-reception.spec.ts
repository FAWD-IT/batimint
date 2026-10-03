/**
 * M10 — Parcours P10 « Réception et clôture » : Karim fait la réception provisoire sur le
 * téléphone (réserve photographiée, PV signé par le client) ; la réserve devient une tâche ; une
 * fois levée, la facture finale est générée (solde du contrat, retenue de garantie) ; réception
 * définitive au bureau : la retenue est libérée ; clôture avec le rapport de rentabilité.
 */
import { type Browser, type BrowserContext, devices, expect, type Page, test } from '@playwright/test';
import {
  acceptInvitation,
  call,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  lastEmailTo,
  signedProject,
  signup,
  uniqueEmail,
} from './helpers';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function phone(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
    locale: 'fr-BE',
    timezoneId: 'Europe/Brussels',
    geolocation: { latitude: 50.4406, longitude: 4.4312, accuracy: 15 },
    permissions: ['geolocation'],
  });
  return { ctx, page: await ctx.newPage() };
}

test('P10 : réception provisoire sur le téléphone, réserve levée, facture finale, réception définitive, clôture', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await signup(page, { name: 'Marc Réception', company: 'Rénov Réception P10' });
  const r = page.request;
  await call(r, 'PUT', '/company/settings', { retentionPercent: '5', retentionMonths: 12 });
  await call(r, 'PATCH', '/company', {
    enterpriseNumber: '0123.456.749',
    street: 'Rue de Montigny 112',
    postalCode: '6000',
    city: 'Charleroi',
    iban: 'BE71 0961 2345 6769',
    bic: 'GKCCBEBB',
  });
  const customerEmail = uniqueEmail('dupont-p10');
  const { projectId } = await signedProject(page, customerEmail);
  const karimEmail = uniqueEmail('karim-p10');
  const karim = await call<{ id: string }>(r, 'POST', '/employees', {
    firstName: 'Karim',
    lastName: 'Benali',
    email: karimEmail,
    hourlyCost: 4400,
  });
  const team = await call<{ id: string }>(r, 'POST', '/teams', {
    name: 'Équipe Karim',
    color: '#2F4BFF',
    leaderEmployeeId: karim.id,
    memberIds: [karim.id],
  });
  await call(r, 'PATCH', `/projects/${projectId}`, { teamId: team.id });
  await call(r, 'POST', `/projects/${projectId}/status`, { to: 'in_progress' });
  await call(r, 'POST', '/invitations', { email: karimEmail, role: 'site_manager' });

  // 1. Karim, sur le chantier : réserve photographiée, PV signé par M. Dupont sur le téléphone.
  const kp = await phone(browser);
  const k = kp.page;
  await acceptInvitation(k, karimEmail, 'Karim Benali');
  await k.goto('/terrain');
  await expect(k.getByRole('heading', { name: 'Bonjour Karim' })).toBeVisible();
  await k.getByRole('button', { name: 'Réception' }).click();
  const sheet = k.getByRole('dialog', { name: 'Réception provisoire' });
  await sheet.getByRole('button', { name: 'Ajouter une réserve' }).click();
  await sheet.getByLabel('Description de la réserve 1').fill('Joint silicone de la baignoire à refaire');
  await sheet.getByLabel('Emplacement (réserve 1)').fill('Salle de bain');
  const [chooser] = await Promise.all([
    k.waitForEvent('filechooser'),
    sheet.getByRole('button', { name: 'Photo (réserve 1)' }).click(),
  ]);
  await chooser.setFiles({ name: 'joint.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect(sheet.getByRole('img', { name: 'Photo de la réserve 1' })).toBeVisible();
  await expectNoHorizontalOverflow(k);
  await expectNoA11yViolations(k);
  await sheet.getByRole('button', { name: 'Faire signer' }).click();
  const sign = k.getByRole('dialog', { name: 'Signature du client' });
  await expect(sign.getByText('Réception provisoire avec 1 réserve')).toBeVisible();
  await expect(sign.getByLabel('Nom du signataire')).toHaveValue('Jean Dupont');
  await sign.getByLabel('Vous acceptez la réception provisoire des travaux, aux réserves notées.').check();
  await sign.getByRole('button', { name: 'Signer le procès-verbal' }).click();
  await expect(k.getByText(/PV PV\d{4}-001 signé/)).toBeVisible();
  await expect(k.getByRole('button', { name: 'Réception' })).toHaveCount(0);
  await kp.ctx.close();
  const pvMail = await lastEmailTo(customerEmail, /réception provisoire/);
  expect(pvMail.text).toContain('réception définitive est prévue');

  // 2. Au bureau : la réserve est une tâche ; levée, elle déclenche la facture finale.
  await page.goto(`/chantiers/${projectId}?onglet=reception`);
  await expect(page.getByRole('heading', { name: 'Réception et clôture' })).toBeVisible();
  await expect(
    page.getByText('1 réserve reste à lever avant la facture finale et la réception définitive.'),
  ).toBeVisible();
  const card = page.getByTestId('reception-card');
  await expect(card).toContainText(/Réception provisoire · PV\d{4}-001/);
  await expect(card).toContainText('Joint silicone de la baignoire à refaire');
  await expect
    .poll(
      async () =>
        (await call<{ items: { title: string }[] }>(r, 'GET', `/projects/${projectId}/tasks`)).items.some(
          (t) => t.title === 'Réserve : Joint silicone de la baignoire à refaire',
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  await expectNoA11yViolations(page);
  await card.getByRole('button', { name: 'Lever' }).click();
  await expect(page.getByText('Réserve levée', { exact: true })).toBeVisible();
  const finalLink = page.getByRole('link', { name: 'Brouillon' });
  await expect(finalLink).toBeVisible({ timeout: 20_000 });
  await finalLink.click();
  await expect(page.getByRole('heading', { name: 'Brouillon · Facture finale' })).toBeVisible();
  await page.getByRole('button', { name: 'Émettre' }).click();
  await page
    .getByRole('dialog', { name: 'Émettre cette facture finale ?' })
    .getByRole('button', { name: 'Émettre et envoyer' })
    .click();
  await expect(page.getByRole('heading', { name: /^Facture finale \d{4}-\d{3}$/ })).toBeVisible();
  await expect(page.getByText(/Retenue de garantie de 5 %/).first()).toBeVisible();
  const invoiceId = page.url().split('/').pop()!;
  const inv = await call<{ balance: number; retentionAmount: number }>(r, 'GET', `/invoices/${invoiceId}`);
  expect(inv.retentionAmount).toBeGreaterThan(0);
  await call(r, 'POST', `/invoices/${invoiceId}/payments`, {
    id: crypto.randomUUID(),
    amount: inv.balance,
    receivedOn: new Date().toISOString().slice(0, 10),
    method: 'transfer',
  });

  // 3. Réception définitive (le client signe à l'écran) : la retenue est libérée.
  await page.goto(`/chantiers/${projectId}?onglet=reception`);
  await page.getByRole('button', { name: 'Réception définitive' }).click();
  await page
    .getByRole('dialog', { name: 'Réception définitive' })
    .getByRole('button', { name: 'Faire signer' })
    .click();
  const finalSign = page.getByRole('dialog', { name: 'Signature du client' });
  await finalSign.getByLabel('Vous acceptez la réception définitive des travaux.').check();
  await finalSign.getByRole('button', { name: 'Signer le procès-verbal' }).click();
  await expect(page.getByText(/PV PV\d{4}-002 signé/)).toBeVisible();
  const released = await lastEmailTo(customerEmail, /libération de la retenue/);
  expect(released.text).toMatch(/retenue de garantie de [\d\s ,]+€ devient payable/);
  await page.reload();
  await expect(page.getByText(/Réception définitive le/)).toBeVisible();

  // 4. Clôture : le rapport de rentabilité reste consultable.
  await page.getByRole('button', { name: 'Clôturer le chantier' }).click();
  await page
    .getByRole('dialog', { name: 'Clôturer ce chantier ?' })
    .getByRole('button', { name: 'Clôturer le chantier' })
    .click();
  await expect(page.getByText('Chantier clôturé', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rapport de rentabilité' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Rentabilité par poste' })).toBeVisible();
  await expectNoA11yViolations(page);
});
