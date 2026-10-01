/**
 * M3 — Parcours P2.3 à P2.9 : Sophie compose le devis depuis l'affaire (bibliothèque, dictée,
 * TVA 6 % proposée, option), l'envoie ; M. Dupont l'ouvre sur son téléphone (« Vu par » en
 * direct chez Sophie), choisit l'option et signe avec l'attestation 6 % ; le chantier est créé.
 */
import { expect, type Page, test } from '@playwright/test';
import {
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  lastEmailTo,
  signup,
  uniqueEmail,
} from './helpers';

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('P2 : du devis composé à la signature sur le portail, chantier créé', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signup(page, { name: 'Sophie Devis' });
  // Données de départ (P2.1–P2.2 couverts ailleurs) : bibliothèque, M. Dupont, son logement de 1975, l'affaire.
  await post(page, '/library/starters', { trades: ['general', 'plumbing'] });
  const email = uniqueEmail('dupont');
  const dupont = await post<{ id: string }>(page, '/customers', {
    kind: 'individual',
    firstName: 'Jean',
    lastName: 'Dupont',
    email,
  });
  const site = await post<{ id: string }>(page, `/customers/${dupont.id}/sites`, {
    street: 'Rue de la Station 42',
    postalCode: '6040',
    city: 'Jumet',
    isPrivateDwelling: true,
    firstOccupancyYear: 1975,
  });
  const opp = await post<{ id: string }>(page, '/opportunities', {
    customerId: dupont.id,
    siteId: site.id,
    title: 'Rénovation salle de bain',
  });

  // P2.3 — le devis se crée depuis l'affaire.
  await page.goto(`/opportunites/${opp.id}`);
  await page.getByRole('button', { name: 'Créer le devis' }).click();
  await page
    .getByRole('dialog', { name: 'Nouveau devis' })
    .getByRole('button', { name: 'Créer le devis' })
    .click();
  await expect(page).toHaveURL(/\/devis\/[0-9a-f-]{36}$/);
  await expect(page.getByText('TVA 6 % proposé')).toBeVisible();

  const first = page.getByRole('group', { name: 'Rénovation salle de bain' });
  await first.getByRole('textbox', { name: 'Intitulé du poste 1' }).fill('Carrelage');
  const carrelage = page.getByRole('group', { name: 'Carrelage' });
  await carrelage.getByRole('combobox', { name: /Ajouter depuis la bibliothèque/ }).fill('faience murale');
  await expect(carrelage.getByRole('option').first()).toBeVisible();
  await carrelage.getByRole('combobox', { name: /Ajouter depuis la bibliothèque/ }).press('Enter');
  await expect(carrelage.getByRole('textbox', { name: 'Désignation de la ligne 1' })).toHaveValue(
    /Faïence murale 30×60 posée/,
  );
  await carrelage
    .getByRole('textbox', { name: /^Quantité — .*faïence/i })
    .first()
    .fill('18,5');

  // Dictée : « 6,2 m² de carrelage sol 60x60 » → ligne proposée depuis la bibliothèque.
  await page.getByRole('button', { name: 'Dicter' }).click();
  const dictation = page.getByRole('dialog', { name: 'Dicter des lignes' });
  await dictation.getByLabel('Ce qu’il faut chiffrer').fill('6,2 m² de carrelage sol grès cérame 60x60');
  await dictation.getByRole('button', { name: 'Proposer des lignes' }).click();
  await expect(dictation.getByText(/6,2 m² · Carrelage sol grès cérame 60×60/)).toBeVisible();
  await dictation.getByRole('button', { name: 'Ajouter 1 ligne' }).click();
  await expect(carrelage.getByRole('textbox', { name: 'Désignation de la ligne 2' })).toHaveValue(
    /grès cérame/,
  );

  // Option : douche à l'italienne, choisie par le client sur le portail.
  await page.getByRole('button', { name: 'Ajouter un poste' }).click();
  await page.getByRole('textbox', { name: 'Intitulé du poste 2' }).fill('Douche à l’italienne');
  const option = page.getByRole('group', { name: 'Douche à l’italienne' });
  await option.getByRole('switch', { name: 'Poste optionnel' }).click();
  await option.getByRole('combobox', { name: /Ajouter depuis la bibliothèque/ }).fill('douche italienne');
  await expect(option.getByRole('option').first()).toBeVisible();
  await option.getByRole('combobox', { name: /Ajouter depuis la bibliothèque/ }).press('Enter');
  await expect(page.getByText('Options proposées')).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('Enregistré', { timeout: 15_000 });
  const totalBefore = await page.getByTestId('quote-total-gross').textContent();
  await expectNoA11yViolations(page);

  // P2.7 — envoi.
  await page.getByRole('button', { name: 'Envoyer au client' }).click();
  const send = page.getByRole('dialog', { name: 'Envoyer le devis' });
  await expect(send.getByLabel('E-mail du client')).toHaveValue(email);
  await send.getByRole('button', { name: 'Envoyer' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Devis envoyé à ${email}.` })).toBeVisible();
  await expect(page.getByText('Envoyé', { exact: true }).first()).toBeVisible();

  const mail = await lastEmailTo(email, /devis/);
  const link = /https?:\/\/[^\s"<>]+\/p\/[^\s"<>]+/.exec(mail.text)?.[0];
  expect(link, 'lien du portail dans l’e-mail').toBeTruthy();

  // P2.8 — M. Dupont sur son téléphone.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const client = await phone.newPage();
  await client.goto(new URL(link!).pathname);
  await expect(client.getByRole('heading', { name: /Votre devis D\d{4}-\d{3}/ })).toBeVisible();
  await expect(client.getByTestId('portal-total-gross')).toHaveText(totalBefore!);
  await expectNoHorizontalOverflow(client);
  await expectNoA11yViolations(client);

  // « Vu par Jean Dupont » apparaît chez Sophie sans recharger.
  await expect(page.getByTestId('quote-timeline')).toContainText('Vu par Jean Dupont', { timeout: 20_000 });

  await client.getByRole('switch', { name: /Ajouter cette option/ }).click();
  await expect(client.getByTestId('portal-total-gross')).not.toHaveText(totalBefore!);
  await client.getByRole('button', { name: 'Signer le devis' }).click();
  const sign = client.getByRole('dialog', { name: 'Signer le devis' });
  await sign.getByRole('button', { name: 'Je signe' }).click();
  await expect(sign.getByText('Cochez la case pour accepter le devis.')).toBeVisible();
  await expect(sign.getByLabel('Année de première occupation')).toHaveValue('1975');
  await sign.getByLabel(/logement privé/).check();
  await sign.getByLabel(/au moins 10 ans/).check();
  await sign.getByLabel(/consommateur final/).check();
  const pad = sign.getByRole('img', { name: /Zone de signature/ });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await client.mouse.move(box.x + 20, box.y + 60);
  await client.mouse.down();
  await client.mouse.move(box.x + 120, box.y + 30, { steps: 6 });
  await client.mouse.move(box.x + 220, box.y + 90, { steps: 6 });
  await client.mouse.up();
  await sign.getByLabel(/J’ai lu le devis/).check();
  await sign.getByRole('button', { name: 'Je signe' }).click();
  await expect(client.getByText('Merci, votre devis est signé')).toBeVisible();
  // P2.9 — le chantier est créé par le worker (idempotent).
  await expect(async () => {
    await client.reload();
    await expect(client.getByText(/Votre chantier est créé/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await phone.close();

  // Chez Sophie : devis signé, chantier créé, affaire gagnée, prospect devenu client.
  await expect(page.getByText('Devis signé', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Le chantier est créé/)).toBeVisible({ timeout: 20_000 });
  await page.goto(`/opportunites/${opp.id}`);
  await expect(page.getByText('Gagnée').first()).toBeVisible();
  await page.goto(`/clients/${dupont.id}`);
  await expect(page.getByText('Client', { exact: true }).first()).toBeVisible();
});
