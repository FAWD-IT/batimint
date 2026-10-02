/**
 * M5 — Parcours P4 « Une journée sur le terrain » (Luca, Karim) sur téléphone : chantier du jour,
 * pointage géolocalisé, photo, tâche cochée, signalement avec photo → avenant au bureau, actions
 * hors ligne synchronisées au retour du réseau, bon de régie signé par le client, validation des
 * heures et rapport journalier. Le bureau (Marc) voit tout arriver en direct.
 */
import { type Browser, type BrowserContext, devices, expect, type Page, test } from '@playwright/test';
import {
  acceptInvitation,
  call,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  signedProject,
  signup,
  uniqueEmail,
} from './helpers';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const photo = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG_1PX });

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

async function choosePhoto(page: Page, open: () => Promise<void>, name: string) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), open()]);
  await chooser.setFiles(photo(name));
}

test('P4 : la journée de Luca et Karim, hors ligne compris, suivie en direct par le bureau', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  // Marc prépare le chantier : devis signé par le vrai circuit, équipe de Karim, chantier démarré.
  await signup(page, { name: 'Marc Terrain', company: 'Rénov Terrain P4' });
  const r = page.request;
  const customerEmail = uniqueEmail('dupont-p4');
  const { projectId } = await signedProject(page, customerEmail);
  const karimEmail = uniqueEmail('karim-p4');
  const lucaEmail = uniqueEmail('luca-p4');
  const karim = await call<{ id: string }>(r, 'POST', '/employees', {
    firstName: 'Karim',
    lastName: 'Benali',
    email: karimEmail,
    hourlyCost: 4400,
  });
  const luca = await call<{ id: string }>(r, 'POST', '/employees', {
    firstName: 'Luca',
    lastName: 'Rossi',
    email: lucaEmail,
    hourlyCost: 3650,
  });
  const team = await call<{ id: string }>(r, 'POST', '/teams', {
    name: 'Équipe Karim',
    color: '#2F4BFF',
    leaderEmployeeId: karim.id,
    memberIds: [karim.id, luca.id],
  });
  await call(r, 'PATCH', `/projects/${projectId}`, { teamId: team.id });
  await call(r, 'POST', `/projects/${projectId}/status`, { to: 'in_progress' });
  await call(r, 'POST', '/invitations', { email: karimEmail, role: 'site_manager' });
  await call(r, 'POST', '/invitations', { email: lucaEmail, role: 'worker' });

  // 1. Luca ouvre la vue terrain sur son téléphone : chantier du jour, adresse, tâches.
  const lucaPhone = await phone(browser);
  const lp = lucaPhone.page;
  await acceptInvitation(lp, lucaEmail, 'Luca Rossi', /\/terrain/);
  await expect(lp.getByRole('heading', { name: 'Bonjour Luca' })).toBeVisible();
  await expect(lp.getByRole('heading', { name: 'Rénovation salle de bain' })).toBeVisible();
  await expect(lp.getByText('Rue de la Station 42, 6040 Jumet')).toBeVisible();
  await expect(lp.getByRole('heading', { name: 'Tâches du jour' })).toBeVisible();
  await expect(lp.getByText(/prix|€/)).toHaveCount(0);
  await expectNoHorizontalOverflow(lp);
  await expectNoA11yViolations(lp);

  // Le bureau suit le chantier en direct.
  await page.goto(`/chantiers/${projectId}`);
  const timeline = page.getByTestId('project-timeline');
  await expect(timeline).toContainText('Travaux démarrés');

  // 2. Pointage de l'arrivée : position vérifiée, fil « Équipe de Karim arrivée », portail client.
  await lp.getByRole('button', { name: /Pointer l'arrivée/ }).click();
  await expect(lp.getByRole('status').filter({ hasText: /Arrivée pointée à \d+ h \d{2}/ })).toBeVisible();
  await expect(lp.getByRole('button', { name: /Pointer le départ/ })).toBeVisible();
  await expect(timeline).toContainText('Équipe de Karim arrivée sur chantier', { timeout: 20_000 });
  const link = await call<{ url: string }>(r, 'POST', `/projects/${projectId}/portal-link`, { send: false });
  const token = decodeURIComponent(/\/p\/([^\s"<>?]+)/.exec(link.url)![1]!);
  const portal = await call<{ headline: { title: string } | null }>(
    r,
    'GET',
    `/portal/projects/${encodeURIComponent(token)}`,
  );
  expect(portal.headline?.title).toMatch(/^L’équipe de Karim est chez vous depuis \d+ h \d{2}$/);

  // 3. Photo rattachée au chantier, tâche cochée → le chantier avance.
  await choosePhoto(lp, () => lp.getByRole('button', { name: 'Photo', exact: true }).click(), 'faience.png');
  await expect(lp.getByRole('status').filter({ hasText: 'Photo envoyée' })).toBeVisible();
  await expect(timeline).toContainText('a ajouté une photo', { timeout: 20_000 });
  await lp.getByRole('checkbox', { name: /Douche à l’italienne/ }).check();
  await expect(timeline).toContainText('Tâche terminée : Douche à l’italienne', { timeout: 20_000 });

  // 4. Signalement avec photo → alerte au bureau, avenant en un clic.
  await lp.getByRole('button', { name: 'Signaler' }).click();
  const issue = lp.getByRole('dialog', { name: 'Signaler un problème' });
  await issue.getByLabel("Qu'est-ce qui se passe ?").fill('Canalisation en plomb derrière la faïence');
  await issue.getByRole('switch', { name: "C'est urgent" }).click();
  await choosePhoto(lp, () => issue.getByRole('button', { name: 'Ajouter une photo' }).click(), 'plomb.png');
  await expect(issue.locator('img')).toHaveCount(1);
  await issue.getByRole('button', { name: 'Envoyer au bureau' }).click();
  await expect(lp.getByRole('status').filter({ hasText: 'Signalement envoyé au bureau' })).toBeVisible();
  await expect(timeline).toContainText('Signalement urgent : Canalisation en plomb derrière la faïence', {
    timeout: 20_000,
  });
  await page.getByRole('tab', { name: /^Terrain \d+$/ }).click();
  const issueCard = page.getByRole('listitem').filter({ hasText: 'Canalisation en plomb' });
  await expect(issueCard.getByRole('img')).toHaveCount(1, { timeout: 20_000 });
  await issueCard.getByRole('button', { name: "Créer l'avenant" }).click();
  await expect(page.getByRole('dialog', { name: /Avenant n°1/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // Hors ligne : la tâche et le départ restent sur le téléphone, puis partent au retour du réseau.
  await lucaPhone.ctx.setOffline(true);
  await lp.getByRole('checkbox', { name: /Faïence murale/ }).check();
  await expect(lp.getByRole('button', { name: /Hors ligne · 1 en attente/ })).toBeVisible();
  await lp.getByRole('button', { name: /Pointer le départ/ }).click();
  await expect(lp.getByRole('status').filter({ hasText: /Départ pointé à/ })).toContainText(
    'enregistré sur ton téléphone',
  );
  await expect(lp.getByRole('button', { name: /Hors ligne · 2 en attente/ })).toBeVisible();
  await expect(lp.getByRole('button', { name: /Pointer l'arrivée/ })).toBeVisible();
  await expect(lp.getByText('Enregistré sur ton téléphone · en attente de réseau')).toBeVisible();
  await lucaPhone.ctx.setOffline(false);
  await expect(lp.getByRole('button', { name: 'À jour' })).toBeVisible({ timeout: 20_000 });
  const sheet = await call<{ rows: { name: string; entries: { kind: string; offline: boolean }[] }[] }>(
    r,
    'GET',
    `/projects/${projectId}/timesheet`,
  );
  const lucaRow = sheet.rows.find((x) => x.name === 'Luca Rossi')!;
  expect(lucaRow.entries.map((e) => [e.kind, e.offline])).toEqual([
    ['in', false],
    ['out', true],
  ]);

  // 5. Karim fait signer un bon de régie au client, sur son téléphone.
  const karimPhone = await phone(browser);
  const kp = karimPhone.page;
  await acceptInvitation(kp, karimEmail, 'Karim Benali');
  await kp.goto('/terrain');
  await expect(kp.getByRole('heading', { name: 'Bonjour Karim' })).toBeVisible();
  await kp.getByRole('button', { name: /^Pointer l'arrivée(?! de)/ }).click();
  await expect(kp.getByRole('button', { name: /^Pointer le départ(?! de)/ })).toBeVisible();
  await expect(kp.getByRole('heading', { name: 'Mon équipe' })).toBeVisible();
  await kp.getByRole('button', { name: 'Faire signer' }).click();
  const wo = kp.getByRole('dialog', { name: 'Bon de régie' });
  await wo.getByLabel('Travail réalisé').fill('Remplacement d’un tuyau d’évacuation non prévu.');
  await wo.getByLabel('Heures').first().fill('1,5');
  await wo.getByRole('button', { name: 'Matériel' }).click();
  await wo.getByLabel('Matériel').fill('Tuyau PVC 40 mm');
  await wo.getByLabel('Quantité').fill('2');
  await wo.getByRole('button', { name: 'Faire signer' }).click();
  const sign = kp.getByRole('dialog', { name: 'Signature du client' });
  await expect(sign.getByLabel('Nom du signataire')).toHaveValue('Jean Dupont');
  await sign.getByLabel('Je confirme que ces travaux ont été réalisés à ma demande.').check();
  await sign.getByRole('button', { name: 'Signer le bon' }).click();
  await expect(kp.getByRole('status').filter({ hasText: /Bon de régie BR\d{4}-001 signé/ })).toBeVisible();
  const workOrders = page.getByRole('table', { name: 'Bons de régie' });
  await expect(workOrders).toContainText(/BR\d{4}-001/, { timeout: 20_000 });
  await expect(workOrders).toContainText('Signé par Jean Dupont');
  await expect(page.getByRole('link', { name: 'PDF signé' })).toBeVisible({ timeout: 20_000 });

  // 6. Départ de Karim, validation des heures de l'équipe.
  await kp.getByRole('button', { name: /^Pointer le départ(?! de)/ }).click();
  await expect(kp.getByRole('button', { name: /^Pointer l'arrivée(?! de)/ })).toBeVisible();
  await kp.getByRole('link', { name: 'Valider les heures' }).click();
  await expect(kp.getByRole('heading', { name: "Heures de l'équipe à valider" })).toBeVisible();
  await kp.getByRole('button', { name: 'Valider la journée' }).first().click();
  await expect(kp.getByRole('status').filter({ hasText: 'Heures validées' })).toBeVisible();
  await expect(kp.getByText("Toutes les heures de l'équipe sont validées.")).toBeVisible();
  await expectNoA11yViolations(kp);

  // 7. Rapport journalier généré, complété et arrêté par Karim.
  await kp.getByRole('link', { name: "Aujourd'hui" }).click();
  await kp.getByRole('link', { name: 'Rapport du jour' }).click();
  await expect(kp.getByRole('heading', { name: 'Rapport du jour' })).toBeVisible();
  await expect(kp.getByText('Luca Rossi')).toBeVisible();
  await expect(kp.getByText('Canalisation en plomb derrière la faïence · urgent')).toBeVisible();
  await kp.getByLabel('Notes pour le bureau').fill('Plomb découvert derrière la faïence, avenant à prévoir.');
  await kp.getByRole('button', { name: 'Arrêter le rapport' }).click();
  await expect(
    kp.getByRole('status').filter({ hasText: 'Rapport arrêté et envoyé au bureau' }),
  ).toBeVisible();
  await expect(kp.getByText('Arrêté par Karim Benali')).toBeVisible();
  await expectNoA11yViolations(kp);

  // Le bureau voit les heures validées et le rapport.
  await page.reload();
  await expect(page.getByRole('table', { name: 'Heures pointées' })).toContainText('Validées');
  await expectNoA11yViolations(page);
  await lucaPhone.ctx.close();
  await karimPhone.ctx.close();
});
