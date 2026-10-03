/**
 * M2 — Parcours P2.1 (demande → prospect + affaire, en direct), P2.2 (visite technique sur
 * téléphone) et bibliothèque (P1.4, recherche, ouvrages). Chaque test crée sa propre entreprise.
 */
import { expect, type Page, test } from '@playwright/test';
import { expectNoA11yViolations, expectNoHorizontalOverflow, signup } from './helpers';

/** PNG 1×1 valide : suffit pour éprouver l'envoi et l'affichage d'une photo. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function formUrl(page: Page): Promise<string> {
  await page.goto('/parametres/formulaire');
  const url = (await page.getByTestId('webform-url').textContent())!.trim();
  return new URL(url).pathname;
}

async function createOpportunity(page: Page, customer: string, title: string) {
  await page.goto('/opportunites');
  await page.getByRole('button', { name: 'Nouvelle affaire' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle affaire' });
  await dialog.getByRole('combobox', { name: 'Choisir un client' }).fill(customer);
  await dialog.getByRole('option', { name: `Créer « ${customer} »` }).click();
  const customerDialog = page.getByRole('dialog', { name: 'Nouveau client' });
  await customerDialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog.getByText(customer)).toBeVisible();
  await dialog.getByLabel('Intitulé').fill(title);
  await dialog.getByRole('button', { name: 'Créer' }).click();
  await expect(page).toHaveURL(/\/opportunites\/[0-9a-f-]{36}$/);
}

test.describe('M2 — demandes, clients et pipeline', () => {
  test('P2.1 : une demande du formulaire web crée prospect et affaire, en direct dans le pipeline', async ({
    page,
    browser,
  }) => {
    await signup(page, { name: 'Sophie Bureau' });
    const path = await formUrl(page);
    await page.goto('/opportunites');
    await expect(page.getByText('Aucune affaire en cours')).toBeVisible();

    // Le client remplit le formulaire intégré sur le site de l'entreprise (téléphone).
    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const form = await visitor.newPage();
    await form.goto(`${path}?embed=1`);
    await expect(form.getByRole('heading', { name: 'Demande de devis' })).toBeVisible();
    await form.getByRole('button', { name: 'Envoyer ma demande' }).click();
    await expect(form.getByText('Indiquez votre nom.')).toBeVisible();
    await form.getByLabel('Nom et prénom').fill('Jean Dupont');
    await form.getByLabel('E-mail').fill(`jean.dupont.${Date.now()}@example.be`);
    await form.getByLabel('Téléphone').fill('+32 475 12 34 56');
    await form.getByLabel('Adresse du chantier').fill('Rue de la Station 42');
    await form.getByLabel('Code postal').fill('6040');
    await form.getByLabel('Localité').fill('Jumet');
    await form
      .getByLabel('Votre projet')
      .fill('Rénovation salle de bain\nRemplacer la baignoire par une douche.');
    await form.getByLabel(/J'accepte d'être recontacté/).check();
    await expectNoA11yViolations(form);
    await expectNoHorizontalOverflow(form);
    await form.getByRole('button', { name: 'Envoyer ma demande' }).click();
    await expect(form.getByText(/Merci ! Votre demande est bien arrivée/)).toBeVisible();
    await visitor.close();

    // Sans recharger : l'affaire apparaît dans « Nouvelle » et le bureau est notifié.
    const column = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: /^Nouvelle/ }) });
    await expect(column.getByRole('link', { name: 'Rénovation salle de bain' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(column.getByText('Jean Dupont')).toBeVisible();
    await expect(page.getByTestId('unread-count')).toBeVisible();
    await expectNoA11yViolations(page);

    // L'onglet Demandes la montre traitée ; la fiche prospect existe avec son adresse de chantier.
    await page.getByRole('tab', { name: /Demandes/ }).click();
    await expect(page).toHaveURL(/vue=demandes/);
    await expect(page.getByText('Formulaire web', { exact: false }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Voir la fiche' }).click();
    await expect(page.getByRole('heading', { name: 'Jean Dupont' })).toBeVisible();
    await expect(page.getByText('Prospect').first()).toBeVisible();
    await expect(page.getByText('Rue de la Station 42').first()).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('client entreprise : recherche VIES, doublon signalé, puis création', async ({ page }) => {
    await signup(page, { name: 'Sophie Clients' });
    await page.goto('/clients');
    await expect(page.getByText(/Aucun client pour l'instant/)).toBeVisible();
    await page.getByRole('button', { name: 'Nouveau client' }).first().click();
    let dialog = page.getByRole('dialog', { name: 'Nouveau client' });
    await dialog.getByRole('tab', { name: 'Entreprise' }).click();
    await dialog.getByLabel("Numéro d'entreprise (BCE)").fill('0417.497.106');
    await dialog.getByRole('button', { name: 'Rechercher dans VIES' }).click();
    await expect(dialog.getByText(/Trouvé dans VIES : Brico Pro SA/)).toBeVisible();
    await expect(dialog.getByLabel("Nom de l'entreprise")).toHaveValue('Brico Pro');
    await expect(dialog.getByLabel('Localité')).toHaveValue('Jumet');
    await dialog.getByLabel('E-mail').fill('compta@bricopro.be');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'Brico Pro' })).toBeVisible();
    await expect(page.getByText('B2B')).toBeVisible();
    await expectNoA11yViolations(page);

    // Même e-mail : Batimint prévient avant de créer un doublon.
    await page.goto('/clients');
    await page.getByRole('button', { name: 'Nouveau client' }).first().click();
    dialog = page.getByRole('dialog', { name: 'Nouveau client' });
    await dialog.getByLabel('Nom', { exact: true }).fill('Comptabilité Brico');
    await dialog.getByLabel('E-mail').fill('compta@bricopro.be');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(dialog.getByText('Ce client existe peut-être déjà')).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Brico Pro' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Créer quand même' }).click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);

    // Recherche instantanée, tolérante aux accents et fautes de frappe.
    await page.goto('/clients');
    await page.getByRole('searchbox', { name: /Rechercher un client/ }).fill('brico');
    await expect(page.getByRole('link', { name: /Brico Pro/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Comptabilité Brico/ })).toBeVisible();
  });

  test('pipeline : déplacer au clavier, motif de perte obligatoire, annuler', async ({ page }) => {
    await signup(page, { name: 'Sophie Pipeline' });
    await createOpportunity(page, 'Marie Lambert', 'Remplacement de la toiture');
    await page.goto('/opportunites');
    const card = page.locator('article').filter({ hasText: 'Remplacement de la toiture' });
    await expect(card).toBeVisible();

    // Alternative clavier au glisser-déposer.
    const move = card.getByRole('button', { name: /Déplacer vers/ });
    await move.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Déplacer vers…' });
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await menu.getByRole('menuitem', { name: 'Devis en cours' }).click();
    const quoting = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: /^Devis en cours/ }) });
    await expect(quoting.getByText('Remplacement de la toiture')).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Affaire déplacée vers « Devis en cours ».' }),
    ).toBeVisible();

    // Perdue : le motif est demandé.
    await card.getByRole('button', { name: /Déplacer vers/ }).click();
    await page.getByRole('menuitem', { name: 'Perdue' }).click();
    const lost = page.getByRole('dialog', { name: 'Pourquoi cette affaire est-elle perdue ?' });
    await lost.getByRole('button', { name: 'Marquer comme perdue' }).click();
    await expect(lost.getByText(/Choisissez un motif/)).toBeVisible();
    await lost.getByLabel('Concurrent choisi').check();
    await lost.getByRole('button', { name: 'Marquer comme perdue' }).click();
    const lostColumn = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: /^Perdue/ }) });
    await expect(lostColumn.getByText('Concurrent choisi')).toBeVisible();

    // Annuler remet l'affaire où elle était.
    await page
      .getByRole('status')
      .filter({ hasText: 'Affaire déplacée vers « Perdue ».' })
      .getByRole('button', { name: 'Annuler' })
      .click();
    await expect(quoting.getByText('Remplacement de la toiture')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('bibliothèque : bibliothèque type, recherche instantanée, prix et marge en direct, ouvrage', async ({
    page,
  }) => {
    await signup(page, { name: 'Sophie Bibliothèque' });
    await page.goto('/bibliotheque');
    await expect(page.getByRole('heading', { name: 'Votre bibliothèque est vide' })).toBeVisible();
    await page.getByLabel(/Sanitaire/).check();
    await page.getByRole('button', { name: 'Ajouter à ma bibliothèque' }).click();
    await expect(page.getByRole('status').filter({ hasText: /articles et ouvrages ajoutés/ })).toBeVisible();

    // Recherche floue : « faience » trouve « faïence ».
    await page.getByRole('searchbox', { name: /Rechercher un article/ }).fill('carrelage mural faience');
    const row = page.getByRole('button', { name: /Carrelage mural faïence 30×60/ }).first();
    await expect(row).toBeVisible();
    await row.click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'Historique des prix' });
    await drawer.getByLabel(/Prix de revient/).fill('30');
    const summary = drawer.getByTestId('price-summary');
    await expect(summary).toContainText('41,25');
    await drawer.getByRole('switch', { name: 'Forcer un prix de vente' }).click();
    await drawer.getByLabel(/Prix de vente \//).fill('40');
    await expect(summary).toContainText('25 %');
    await drawer.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Article enregistré.' })).toBeVisible();
    await row.click();
    await expect(page.getByRole('dialog').getByText('Modification')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();

    // Nouvel ouvrage composé : le prix de revient se calcule à partir des composants.
    await page.getByRole('button', { name: 'Nouvel ouvrage' }).click();
    const assembly = page.getByRole('dialog', { name: 'Nouvel ouvrage' });
    await assembly.getByLabel('Code').fill('OUV-TEST');
    await assembly.getByLabel('Désignation').fill('Faïence posée (test)');
    await assembly.getByRole('searchbox', { name: 'Ajouter un article…' }).fill('carrelage mural faience');
    await assembly
      .getByRole('button', { name: /Carrelage mural faïence 30×60/ })
      .first()
      .click();
    await assembly.getByLabel(/Quantité Carrelage mural faïence/).fill('1,1');
    await expect(assembly.getByText('33,00 €').first()).toBeVisible();
    await assembly.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Article enregistré.' })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe('M2 — visite technique sur téléphone', () => {
  test('P2.2 : mesures, points à vérifier, photo et note vocale transcrite @mobile', async ({ page }) => {
    await signup(page, { name: 'Karim Visite' });
    await createOpportunity(page, 'Jean Dupont', 'Rénovation salle de bain');
    await page.getByRole('button', { name: 'Commencer la visite' }).click();
    await page.getByRole('button', { name: 'Salle de bain' }).click();
    await page.getByLabel(/Valeur Surface au sol/).fill('6,2');
    await page.getByRole('checkbox', { name: 'État des murs et du support (humidité, fissures)' }).check();
    await page.getByLabel('Notes').fill('Baignoire à remplacer par une douche à l’italienne.');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Visite enregistrée.' })).toBeVisible();

    await page
      .getByTestId('photo-input')
      .setInputFiles({ name: 'mur.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('button', { name: /Agrandir la photo/ })).toBeVisible();
    await page.getByTestId('voice-input').setInputFiles({
      name: 'note.webm',
      mimeType: 'audio/webm',
      buffer: Buffer.alloc(48_000, 1),
    });
    await expect(page.getByText(/transcription simulée/)).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByLabel(/Valeur Surface au sol/)).toHaveValue('6,2');
    await expect(
      page.getByRole('checkbox', { name: 'État des murs et du support (humidité, fissures)' }),
    ).toBeChecked();
    await page.getByRole('button', { name: 'Marquer comme visitée' }).click();
    await expect(page.getByText('Visite réalisée')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
  });
});
