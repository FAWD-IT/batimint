/**
 * M4 — Chantier pivot et parcours P5 : le chantier né d'un devis signé, cockpit en direct dans deux
 * navigateurs, avenant composé par Sophie, question puis validation par M. Dupont sur son portail,
 * budget et contrat mis à jour ; ⌘K pour retrouver le chantier.
 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import {
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  lastEmailTo,
  signup,
  uniqueEmail,
} from './helpers';

async function call<T>(request: APIRequestContext, method: 'POST' | 'PUT' | 'GET', path: string, data?: unknown) {
  const res = await request.fetch(`/api/v1${path}`, { method, ...(data !== undefined ? { data } : {}) });
  expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Un chantier créé par le vrai circuit : devis composé, envoyé, signé sur le portail, worker. */
async function signedProject(page: Page, email: string) {
  const r = page.request;
  const customer = await call<{ id: string }>(r, 'POST', '/customers', {
    kind: 'individual',
    firstName: 'Jean',
    lastName: 'Dupont',
    email,
  });
  const site = await call<{ id: string }>(r, 'POST', `/customers/${customer.id}/sites`, {
    street: 'Rue de la Station 42',
    postalCode: '6040',
    city: 'Jumet',
    isPrivateDwelling: true,
    firstOccupancyYear: 1975,
  });
  const opp = await call<{ id: string }>(r, 'POST', '/opportunities', {
    customerId: customer.id,
    siteId: site.id,
    title: 'Rénovation salle de bain',
  });
  const quote = await call<{ id: string; currentVersion: { revision: number } }>(r, 'POST', '/quotes', {
    opportunityId: opp.id,
    title: 'Rénovation salle de bain',
  });
  const line = (description: string, quantity: string, unitPrice: number, unitCost: number) => ({
    key: crypto.randomUUID(),
    kind: 'item',
    description,
    unit: 'm²',
    quantity,
    unitPrice,
    unitCost,
    laborHours: '0.5',
    vatRegime: 'reduced_6',
  });
  await call(r, 'PUT', `/quotes/${quote.id}/content`, {
    revision: quote.currentVersion.revision,
    sections: [
      {
        key: crypto.randomUUID(),
        title: 'Carrelage',
        lines: [line('Faïence murale 30×60 posée', '18', 9_000, 6_500), line('Carrelage sol 60×60 posé', '6', 11_000, 8_000)],
      },
      { key: crypto.randomUUID(), title: 'Plomberie', lines: [line('Douche à l’italienne', '1', 250_000, 180_000)] },
    ],
  });
  await call(r, 'POST', `/quotes/${quote.id}/send`, { email });
  const mail = await lastEmailTo(email, /devis/);
  const token = decodeURIComponent(/\/p\/([^\s"<>]+)/.exec(mail.text)![1]!);
  await call(r, 'POST', `/portal/quotes/${encodeURIComponent(token)}/sign`, {
    signerName: 'Jean Dupont',
    acceptTerms: true,
    certificate: { firstOccupancyYear: 1975, privateDwelling: true, overTenYears: true, finalConsumer: true },
  });
  let projectId = '';
  await expect(async () => {
    const list = await call<{ items: { id: string }[] }>(r, 'GET', '/projects?view=all');
    expect(list.items).toHaveLength(1);
    projectId = list.items[0]!.id;
  }).toPass({ timeout: 30_000 });
  return { projectId };
}

test('P5 : avenant envoyé, question du client, réponse, validation ; cockpit en direct', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signup(page, { name: 'Sophie Chantier' });
  const email = uniqueEmail('dupont-p5');
  const { projectId } = await signedProject(page, email);

  // La liste des chantiers : le nouveau chantier est « en préparation ».
  await page.goto('/chantiers');
  await page.getByRole('tab', { name: 'En préparation' }).click();
  await page.getByRole('link', { name: /Rénovation salle de bain/ }).click();
  await expect(page).toHaveURL(new RegExp(`/chantiers/${projectId}`));
  await expect(page.getByRole('heading', { name: 'Rénovation salle de bain', level: 1 })).toBeVisible();
  await expect(page.getByText(/TVA 6 % · attestation signée/)).toBeVisible();
  await expect(page.getByTestId('estimated-margin')).toContainText('%');
  await expectNoA11yViolations(page);

  // Deuxième navigateur (Karim au bureau, même compte) : tout bouge sans recharger.
  const other = await browser.newContext();
  const cookies = await page.context().cookies();
  await other.addCookies(cookies);
  const second = await other.newPage();
  await second.goto(`/chantiers/${projectId}`);
  await expect(second.getByRole('heading', { name: 'Rénovation salle de bain', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Démarrer le chantier' }).click();
  await expect(second.getByTestId('project-timeline')).toContainText('Travaux démarrés', { timeout: 20_000 });
  await expect(second.getByRole('heading', { name: /En cours/ })).toBeVisible();

  await page.getByRole('tab', { name: /Tâches/ }).click();
  await page.getByRole('checkbox', { name: /Marquer « Douche à l’italienne » comme faite/ }).click();
  await expect(second.getByTestId('progress-by-post')).toContainText('100 %', { timeout: 20_000 });
  await expect(second.getByTestId('project-timeline')).toContainText('Tâche terminée : Douche à l’italienne');

  // P5.1 — Sophie compose l'avenant n°1 et l'envoie.
  await page.getByRole('button', { name: 'Nouvel avenant' }).click();
  const drawer = page.getByRole('dialog', { name: 'Nouvel avenant' });
  await drawer.getByLabel('Objet').fill('Ajout d’une niche murale');
  await drawer.getByLabel('Description pour le client').fill('Niche carrelée dans la douche.');
  await drawer.getByRole('button', { name: 'Ligne libre' }).click();
  await drawer.getByRole('combobox', { name: 'Poste de la ligne 1' }).selectOption({ label: 'Carrelage' });
  await drawer.getByRole('textbox', { name: 'Désignation de la ligne 1' }).fill('Niche murale carrelée 60×30');
  await drawer.getByRole('textbox', { name: 'Prix unitaire HTVA de la ligne 1' }).fill('1250');
  await drawer.getByRole('textbox', { name: 'Coût unitaire de la ligne 1' }).fill('900');
  await drawer.getByRole('textbox', { name: 'Prix unitaire HTVA de la ligne 1' }).press('Tab');
  await expect(drawer.getByTestId('co-total-gross')).toHaveText(/1\s325,00\s€/);
  await drawer.getByRole('button', { name: 'Envoyer au client' }).click();
  const send = page.getByRole('dialog', { name: 'Envoyer l’avenant' });
  await expect(send.getByLabel('E-mail du client')).toHaveValue(email);
  await send.getByRole('button', { name: 'Envoyer' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Avenant envoyé à ${email}.` })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Avenant n°1' })).toContainText('En attente du client');
  await page.keyboard.press('Escape');

  // P5.2 — M. Dupont reçoit l'avenant sur son téléphone, carte « À valider », et pose une question.
  const mail = await lastEmailTo(email, /avenant n°1/);
  const link = /https?:\/\/[^\s"<>]+\/p\/[^\s"<>]+/.exec(mail.text)![0];
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const client = await phone.newPage();
  await client.goto(new URL(link).pathname);
  const card = client.getByTestId('portal-change-order');
  await expect(card).toContainText('À valider');
  await expect(card).toContainText('Ajout d’une niche murale');
  await expect(card).toContainText('1 250,00');
  await expectNoHorizontalOverflow(client);
  await expectNoA11yViolations(client);
  await card.getByRole('button', { name: 'Poser une question' }).click();
  const ask = client.getByRole('dialog', { name: /Votre question/ });
  await ask.getByLabel('Votre question').fill('La niche peut-elle être plus haute ?');
  await ask.getByRole('button', { name: 'Envoyer' }).click();
  await expect(client.getByText('Question envoyée')).toBeVisible();

  // Sophie voit la question arriver en direct dans « À faire » et répond depuis l'avenant.
  await page.getByRole('tab', { name: 'Vue d’ensemble' }).click();
  const todos = page.getByTestId('project-todos');
  await expect(todos).toContainText('Question de Jean Dupont sur Avenant n°1', { timeout: 20_000 });
  await todos.getByRole('button', { name: 'Répondre' }).click();
  const view = page.getByRole('dialog', { name: 'Avenant n°1' });
  await expect(view.getByTestId('co-thread')).toContainText('La niche peut-elle être plus haute ?');
  await view.getByLabel('Répondre au client').fill('Oui, jusqu’à 1,60 m sans supplément.');
  await view.getByRole('button', { name: 'Envoyer la réponse' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Réponse envoyée' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(todos).not.toContainText('Question de Jean Dupont', { timeout: 20_000 });

  // Le client voit la réponse sans recharger, puis valide l'avenant.
  await expect(card).toContainText('jusqu’à 1,60 m', { timeout: 20_000 });
  await card.getByRole('button', { name: 'Valider' }).click();
  const sign = client.getByRole('dialog', { name: 'Valider l’avenant n°1' });
  await sign.getByRole('button', { name: 'Je valide' }).click();
  await expect(sign.getByText('Cochez la case pour accepter l’avenant.')).toBeVisible();
  await sign.getByLabel('J’ai lu l’avenant et je l’accepte.').check();
  await sign.getByRole('button', { name: 'Je valide' }).click();
  await expect(client.getByText('Merci, l’avenant n°1 est validé.')).toBeVisible();
  await expect(client.getByText('Validé', { exact: true })).toBeVisible();

  // P5.3 — budget et contrat mis à jour chez Sophie (et dans l'autre navigateur), en direct.
  await expect(page.getByTestId('project-timeline')).toContainText('Avenant n°1 signé par Jean Dupont', {
    timeout: 20_000,
  });
  await expect(second.getByText(/dont avenants 1\s250\s€/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: /Avenants/ }).click();
  await expect(page.getByText('Signé', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Budget' }).click();
  await expect(page.getByRole('table', { name: 'Budget par poste' })).toContainText('Carrelage');
  await phone.close();
  await other.close();

  // ⌘K : retrouver le chantier depuis n'importe où.
  await page.goto('/aujourdhui');
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('combobox', { name: 'Recherche et actions' });
  await palette.fill('Dupont');
  await expect(page.getByRole('option', { name: /Rénovation salle de bain/ }).first()).toBeVisible();
  await palette.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/chantiers/${projectId}`));
});

test('cockpit sur téléphone : lisible, sans débordement, onglets au clavier @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signup(page, { name: 'Sophie Mobile' });
  const { projectId } = await signedProject(page, uniqueEmail('mobile-p5'));
  await page.goto(`/chantiers/${projectId}`);
  await expect(page.getByRole('heading', { name: 'Rénovation salle de bain', level: 1 })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('tab', { name: 'Vue d’ensemble' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Tâches/ })).toHaveAttribute('aria-selected', 'true');
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);
});
