/**
 * M10 — Parcours P13 « Stock et matériel » : Sophie crée le dépôt, enregistre les entrées (coût
 * moyen pondéré) et fixe un seuil ; Karim prend de la colle dans sa camionnette depuis la vue
 * terrain, le coût est imputé au chantier ; sous le seuil, Sophie prépare le bon de commande de
 * réapprovisionnement. Matériel : fiche, affectation au chantier (coût d'usage), entretien planifié
 * puis fait.
 */
import { devices, expect, test } from '@playwright/test';
import {
  acceptInvitation,
  call,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  signedProject,
  signup,
  uniqueEmail,
} from './helpers';

test('P13 : stock au CMP, sortie depuis la camionnette, réapprovisionnement, matériel affecté et entretien', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await signup(page, { name: 'Sophie Stock', company: 'Rénov Stock P13' });
  const r = page.request;
  const { projectId } = await signedProject(page, uniqueEmail('dupont-p13'));
  await call(r, 'POST', `/projects/${projectId}/status`, { to: 'in_progress' });
  const supplier = await call<{ id: string }>(r, 'POST', '/suppliers', {
    name: 'Matériaux Gilson SA',
    email: 'commandes@gilson.example.be',
  });
  await call(r, 'POST', '/items', {
    code: 'COLFLEX',
    kind: 'material',
    name: 'Colle flex C2TE 25 kg',
    unit: 'sac',
    purchasePrice: 1_800,
    supplierId: supplier.id,
  });
  const karimEmail = uniqueEmail('karim-p13');
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
  await call(r, 'POST', '/invitations', { email: karimEmail, role: 'site_manager' });

  // 1. Le dépôt, créé depuis l'état vide.
  await page.goto('/stock');
  await expect(page.getByRole('heading', { name: 'Créez votre dépôt' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Emplacement' }).first().click();
  const loc = page.getByRole('dialog', { name: 'Nouvel emplacement' });
  await loc.getByLabel('Nom').fill('Dépôt de Gosselies');
  await loc.getByRole('button', { name: 'Créer l’emplacement' }).click();
  await expect(page.getByRole('button', { name: /Dépôt de Gosselies/ })).toBeVisible();
  const van = await call<{ id: string }>(r, 'POST', '/stock/locations', {
    name: 'Camionnette de Karim',
    kind: 'van',
    employeeId: karim.id,
  });

  // 2. Deux entrées à des prix différents : coût moyen pondéré.
  await page.getByRole('button', { name: 'Mouvement' }).click();
  let mv = page.getByRole('dialog', { name: 'Nouveau mouvement de stock' });
  await mv.getByLabel('Article').selectOption({ label: 'COLFLEX · Colle flex C2TE 25 kg' });
  await mv.getByLabel('Quantité (sac)').fill('30');
  await mv.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(mv).toBeHidden();
  await page.getByRole('button', { name: 'Mouvement' }).click();
  mv = page.getByRole('dialog', { name: 'Nouveau mouvement de stock' });
  await mv.getByLabel('Article').selectOption({ label: 'COLFLEX · Colle flex C2TE 25 kg' });
  await mv.getByLabel('Quantité (sac)').fill('10');
  await mv.getByLabel('Prix d’achat unitaire HTVA').fill('22');
  await mv.getByRole('button', { name: 'Enregistrer' }).click();
  const table = page.getByRole('table', { name: 'Articles' });
  // (30 × 18 + 10 × 22) / 40 = 19,00 €
  await expect(table.getByRole('row', { name: /Colle flex C2TE/ })).toContainText('40 sac');
  await expect(table.getByRole('row', { name: /Colle flex C2TE/ })).toContainText('19,00 €');

  // 3. Seuil d'alerte au dépôt ; 16 sacs partent dans la camionnette : le dépôt passe sous le seuil.
  await page.getByRole('button', { name: 'Seuil de Colle flex C2TE 25 kg' }).click();
  const th = page.getByRole('dialog', { name: 'Seuil de Colle flex C2TE 25 kg' });
  await th.getByLabel('Seuil d’alerte (sac)').fill('25');
  await th.getByLabel('Quantité à commander (sac)').fill('40');
  await th.getByRole('button', { name: 'Enregistrer le seuil' }).click();
  await expect(page.getByText('Seuil enregistré')).toBeVisible();
  await page.getByRole('button', { name: 'Mouvement' }).click();
  mv = page.getByRole('dialog', { name: 'Nouveau mouvement de stock' });
  await mv.getByRole('tab', { name: 'Transfert' }).click();
  await mv.getByLabel('Vers').selectOption({ label: 'Camionnette de Karim' });
  await mv.getByLabel('Article').selectOption({ label: 'COLFLEX · Colle flex C2TE 25 kg' });
  await mv.getByLabel('Quantité (sac)').fill('16');
  await mv.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(mv).toBeHidden();
  await expect(page.getByRole('row', { name: /Colle flex C2TE/ }).getByText('Sous le seuil')).toBeVisible();
  await expectNoA11yViolations(page);

  // 4. Karim, sur le chantier : 4 sacs pris dans sa camionnette, imputés au chantier.
  const ctx = await browser.newContext({
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
    locale: 'fr-BE',
    timezoneId: 'Europe/Brussels',
  });
  const k = await ctx.newPage();
  await acceptInvitation(k, karimEmail, 'Karim Benali');
  await k.goto('/terrain');
  await k.getByRole('button', { name: 'Matériaux' }).click();
  const sheet = k.getByRole('dialog', { name: 'Sortie de matériaux' });
  await expect(sheet.getByLabel('Pris dans')).toHaveValue(van.id);
  await sheet.getByLabel('Article').selectOption({ label: 'Colle flex C2TE 25 kg' });
  await expect(sheet.getByText('Il reste 16 sac')).toBeVisible();
  await sheet.getByLabel('Quantité (sac)').fill('4');
  await expectNoHorizontalOverflow(k);
  await expectNoA11yViolations(k);
  await sheet.getByRole('button', { name: 'Enregistrer la sortie' }).click();
  await expect(k.getByText('4 sac de Colle flex C2TE 25 kg imputés au chantier')).toBeVisible();
  await ctx.close();
  await expect
    .poll(
      async () =>
        (await call<{ items: { title: string }[] }>(r, 'GET', `/projects/${projectId}/timeline`)).items.some(
          (e) => e.title.startsWith('Coût imputé : Colle flex C2TE 25 kg · 4 sac'),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);

  // 5. Réapprovisionnement : le bon de commande est préparé en brouillon.
  await page.goto('/stock?onglet=reappro');
  const group = page.getByTestId('reorder-group');
  await expect(group).toContainText('Matériaux Gilson SA');
  await expect(group).toContainText('En stock : 24 · seuil 25');
  await group.getByRole('button', { name: 'Préparer le bon de commande' }).click();
  await expect(page).toHaveURL(/\/achats\/commandes\?bc=/);
  const drawer = page.getByRole('dialog', { name: 'Brouillon · Matériaux Gilson SA' });
  await expect(drawer.getByText('Stock · Dépôt de Gosselies')).toBeVisible();
  await expect(drawer.getByLabel('Article 1')).toHaveValue('Colle flex C2TE 25 kg');
  await expect(drawer.getByLabel('Quantité')).toHaveValue('40');

  // 6. Matériel : fiche, affectation au chantier, entretien planifié puis fait.
  await page.goto('/materiel');
  await expect(page.getByRole('heading', { name: 'Aucun matériel' })).toBeVisible();
  await page.getByRole('button', { name: 'Nouveau matériel' }).first().click();
  const eq = page.getByRole('dialog', { name: 'Nouveau matériel' });
  await eq.getByLabel('Désignation').fill('Mini-pelle Kubota U17');
  await eq.getByLabel('Coût d’usage journalier').fill('95');
  await eq.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { name: 'Mini-pelle Kubota U17' })).toBeVisible();
  await page.getByRole('button', { name: 'Affecter à un chantier' }).click();
  const as = page.getByRole('dialog', { name: 'Affecter Mini-pelle Kubota U17' });
  await as.getByLabel('Chantier').selectOption({ index: 1 });
  const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  await as.getByLabel('À partir du').fill(start);
  await as.getByRole('button', { name: 'Affecter' }).click();
  await expect(page.getByTestId('equipment-current')).toContainText(/jours? ouvrés? · [\d\s ,]+€ imputés/);
  await expect
    .poll(
      async () =>
        (await call<{ items: { title: string }[] }>(r, 'GET', `/projects/${projectId}/timeline`)).items.some(
          (e) => e.title === 'Matériel affecté : Mini-pelle Kubota U17',
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Planifier' }).click();
  const plan = page.getByRole('dialog', { name: 'Planifier un entretien' });
  await plan.getByRole('tab', { name: 'Contrôle' }).click();
  await plan.getByLabel('Intitulé').fill('Contrôle périodique (SECT)');
  await plan.getByLabel('Échéance').fill(new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10));
  await plan.getByLabel('Périodicité (mois)').fill('12');
  await plan.getByRole('button', { name: 'Planifier' }).click();
  await expect(page.getByText(/Bientôt : /)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Fait : Contrôle périodique (SECT)' }).click();
  await page
    .getByRole('dialog', { name: 'Contrôle périodique (SECT) fait' })
    .getByRole('button', { name: 'Enregistrer' })
    .click();
  await expect(page.getByText('Entretien enregistré')).toBeVisible();
  await expect(page.getByText(/Fait le/)).toBeVisible();
});
