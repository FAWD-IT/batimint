/**
 * M8 — Parcours P7 « État d'avancement et facturation » et P8 « Le client suit son chantier » :
 * Sophie émet l'acompte, prépare l'état d'avancement (pré-rempli, modifiable en %, en quantité ou
 * en €) et l'envoie ; M. Dupont l'approuve sur son portail ; la facture générée déduit l'acompte
 * au prorata et porte les mentions de TVA ; émise, elle part par e-mail ; M. Dupont la paie en ligne
 * (paiement simulé) ; Sophie voit le paiement. Paiement partiel saisi au bureau. Téléphone.
 */
import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  call,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  lastEmailTo,
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

async function openPortal(browser: Browser, email: string, subject: RegExp) {
  const mail = await lastEmailTo(email, subject);
  const link = new URL(/(http\S+\/p\/[^\s"<>]+)/.exec(mail.text)![1]!);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(link.pathname);
  return { ctx, page };
}

test('P7 : acompte émis, état approuvé par le client, facture avec acompte déduit, payée en ligne', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await signup(page, { name: 'Sophie Facturation', company: 'Rénov Facturation P7' });
  await companyReady(page);
  const customerEmail = uniqueEmail('dupont-p7');
  const { projectId } = await signedProject(page, customerEmail);

  // 1. L'acompte du devis attend en brouillon : Sophie l'émet.
  await page.goto(`/chantiers/${projectId}?onglet=facturation`);
  await expect(page.getByRole('heading', { name: 'États d’avancement' })).toBeVisible();
  await page.getByRole('link', { name: /Brouillon\s*Facture d’acompte/ }).click();
  await expect(page.getByRole('heading', { name: 'Brouillon · Facture d’acompte' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Émettre' }).click();
  const confirm = page.getByRole('dialog', { name: 'Émettre cette facture d’acompte ?' });
  await expect(confirm).toContainText('numéro définitif');
  await confirm.getByRole('button', { name: 'Émettre et envoyer' }).click();
  await expect(page.getByText(/Facture \d{4}-001 émise/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Facture d’acompte \d{4}-001$/ })).toBeVisible();
  await expect(page.getByText(`Envoyée par e-mail à ${customerEmail}`)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+/)).toBeVisible();
  const depositMail = await lastEmailTo(customerEmail, /facture d’acompte/);
  expect(depositMail.text).toMatch(/communication structurée \+\+\+/);

  // Paiement partiel saisi au bureau.
  await page.getByRole('button', { name: 'Enregistrer un paiement' }).click();
  const payDialog = page.getByRole('dialog', { name: 'Enregistrer un paiement' });
  await payDialog.getByLabel('Montant reçu').fill('100');
  await payDialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Paiement enregistré')).toBeVisible();
  await expect(page.getByText('Payée en partie').first()).toBeVisible();

  // 2. « Facturer l'avancement » : pré-rempli, saisie en %, envoi au client (B2C).
  await page.goto(`/chantiers/${projectId}?onglet=facturation`);
  await page.getByRole('link', { name: 'Facturer l’avancement' }).click();
  await expect(page.getByRole('heading', { name: 'État d’avancement n°1' })).toBeVisible();
  await expect(page.getByText('Le client l’approuve sur son portail avant facturation.')).toBeVisible();
  await page.getByLabel('Cumul Carrelage').fill('50');
  await expect(page.getByTestId('statement-period')).toHaveText(/1\s140,00\s€/);
  await page.getByLabel('Cumul Plomberie').fill('120');
  await expect(page.getByText('L’avancement ne dépasse pas 100 %.')).toBeVisible();
  await page.getByLabel('Cumul Plomberie').fill('0');
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Envoyer au client' }).click();
  await expect(page.getByText('État envoyé au client pour approbation')).toBeVisible();
  await expect(page.getByText('En attente du client').first()).toBeVisible();

  // 3. M. Dupont approuve sur son portail (vouvoiement).
  const client = await openPortal(browser, customerEmail, /état d’avancement n°1 à approuver/);
  const card = client.page.getByTestId('portal-statement');
  await expect(card).toContainText('État d’avancement n°1');
  await card.getByRole('button', { name: 'Voir le détail par poste' }).click();
  await expect(card).toContainText('de 0 % à 50 %');
  await card.getByRole('button', { name: 'Approuver' }).click();
  const approve = client.page.getByRole('dialog', { name: 'Approuver l’état d’avancement n°1' });
  await expect(approve.getByLabel('Votre nom')).toHaveValue('Jean Dupont');
  await approve.getByRole('button', { name: 'J’approuve' }).click();
  await expect(client.page.getByText(/Merci : l’état n°1 est approuvé/)).toBeVisible();

  // 4. Sophie : l'état est approuvé en direct ; la facture générée déduit l'acompte.
  await expect(page.getByText('Approuvé').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: 'Facture prête à émettre' }).click();
  await expect(page.getByRole('heading', { name: 'Brouillon · Facture d’avancement' })).toBeVisible();
  await expect(page.getByText(/Carrelage — avancement cumulé 50 %/)).toBeVisible();
  await expect(page.getByText(/Déduction de l’acompte \(facture \d{4}-001\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Émettre' }).click();
  await page
    .getByRole('dialog', { name: 'Émettre cette facture d’avancement ?' })
    .getByRole('button', { name: 'Émettre et envoyer' })
    .click();
  await expect(page.getByRole('heading', { name: /^Facture d’avancement \d{4}-002$/ })).toBeVisible();
  await expect(page.getByText(/Taux réduit de 6 % : logement privé de plus de 10 ans/)).toBeVisible();
  const gross = (await page.getByTestId('invoice-gross').textContent())!.trim();

  // 5. Le client paie en ligne depuis son portail (paiement simulé) et revient sur son espace.
  await client.page.reload();
  const invoices = client.page.getByRole('region', { name: 'Vos factures' });
  const progressInvoice = invoices.getByRole('listitem').filter({ hasText: 'État d’avancement n°1' });
  await expect(progressInvoice).toContainText('À payer');
  await progressInvoice.getByRole('button', { name: /Payer .* en ligne/ }).click();
  await expect(client.page).toHaveURL(/\/paiement-simule\//);
  await expect(client.page.getByRole('heading', { level: 1 })).toHaveText(gross);
  await client.page.getByRole('button', { name: 'Payer avec Bancontact' }).click();
  await expect(client.page.getByText('Paiement reçu')).toBeVisible();
  await expect(client.page).toHaveURL(/\/p\//, { timeout: 15_000 });
  await expect(
    client.page
      .getByRole('region', { name: 'Vos factures' })
      .getByRole('listitem')
      .filter({ hasText: 'État d’avancement n°1' }),
  ).toContainText('Payée');
  await client.ctx.close();

  // 6. Sophie voit le paiement en ligne.
  await expect(page.getByText('Payée', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Bancontact/).first()).toBeVisible();
  await page.goto('/facturation?vue=paid');
  await expect(page.getByRole('link', { name: /\d{4}-002/ })).toBeVisible();
});

test('P8 sur téléphone : le client suit son chantier, ses factures et paie @mobile', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signup(page, { name: 'Sophie Mobile', company: 'Rénov Portail P8' });
  await companyReady(page);
  const customerEmail = uniqueEmail('dupont-p8');
  const { projectId } = await signedProject(page, customerEmail);
  const list = await call<{ items: { id: string; type: string }[] }>(
    page.request,
    'GET',
    `/invoices?view=draft&projectId=${projectId}`,
  );
  const deposit = list.items.find((i) => i.type === 'deposit')!;
  await call(page.request, 'POST', `/invoices/${deposit.id}/issue`);
  await page.goto('/facturation');
  await expectNoHorizontalOverflow(page);

  const client = await openPortal(browser, customerEmail, /facture d’acompte/);
  const p = client.page;
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(p.getByRole('region', { name: 'Vos factures' })).toContainText('À payer');
  await expect(p.getByText(/\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+/)).toBeVisible();
  await expect(p.getByRole('link', { name: /Facture \d{4}-001/ })).toBeVisible();
  await expectNoHorizontalOverflow(p);
  await expectNoA11yViolations(p);
  await client.ctx.close();
});
