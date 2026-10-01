/**
 * P1 — Inscription et mise en route (Marc, moins de 10 minutes).
 * Peppol en simulation.
 */
import { expect, type Page, test } from '@playwright/test';
import { expectNoA11yViolations, lastEmailTo, PASSWORD, signup, uniqueEmail } from './helpers';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function acceptInvitation(page: Page, email: string, name: string) {
  const mail = await lastEmailTo(email, /vous invite/);
  const link = new URL(/(http\S+\/invitation\?token=[^\s"]+)/.exec(mail.text)![1]!);
  await page.goto(link.pathname + link.search);
  await expect(page.getByRole('heading', { name: /Rejoindre/ })).toBeVisible();
  await page.getByLabel('Votre nom').fill(name);
  await page.getByLabel('Choisissez un mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: "Rejoindre l'entreprise" }).click();
  await expect(page).toHaveURL(/\/aujourdhui/);
}

test.describe('P1 — inscription et mise en route', () => {
  test('Marc paramètre son entreprise et invite son équipe', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const start = Date.now();
    await signup(page, { name: 'Marc Lefèvre', company: 'Rénov Habitat P1', stayOnWelcome: true });
    // 1-2. Numéro d'entreprise → VIES pré-remplit raison sociale et adresse.
    await expect(page).toHaveURL(/\/bienvenue/);
    await expectNoA11yViolations(page);
    await page.getByLabel("Numéro d'entreprise (BCE)").fill('0123.456.749');
    await page.getByRole('button', { name: 'Rechercher' }).click();
    await expect(page.getByText('Entreprise trouvée dans le registre européen VIES.')).toBeVisible();
    await expect(page.getByLabel('Raison sociale')).toHaveValue("Rénov'Habitat SRL");
    await expect(page.getByLabel('Localité')).toHaveValue('Charleroi');
    await page.getByRole('button', { name: "C'est bien nous, continuer" }).click();
    await expect(page).toHaveURL(/\/aujourdhui/);

    // 7. Checklist visible, chaque étape renvoie au bon écran.
    const checklist = page
      .getByRole('region', { name: 'Mise en route' })
      .or(page.locator('[aria-labelledby="onboarding-title"]'));
    await expect(checklist).toBeVisible();
    await expect(checklist.getByText(/1 sur 8 étapes/)).toBeVisible();

    // 3. Logo, IBAN, conditions générales.
    await checklist.getByRole('link', { name: "Ajouter l'IBAN" }).click();
    await expect(page).toHaveURL(/\/parametres\/entreprise/);
    await expect(page.getByText(/TVA validée via VIES/)).toBeVisible();
    await page.getByLabel('IBAN').fill('BE68 5390 0754 7035');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText("Cet IBAN n'est pas valide.")).toBeVisible();
    await page.getByLabel('IBAN').fill('BE68 5390 0754 7034');
    await page.getByLabel('BIC').fill('GKCCBEBB');
    await page
      .getByLabel('Conditions générales de vente')
      .fill('Nos devis sont valables 30 jours. Paiement à 30 jours fin de mois.');
    await page.getByLabel('Couleur de marque').first().fill('#0B6E4F');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Modifications enregistrées.' })).toBeVisible();
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1PX });
    await expect(page.getByRole('status').filter({ hasText: 'Logo mis à jour.' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Logo' })).toBeVisible();
    await expectNoA11yViolations(page);

    // 3. Taux horaires et coefficients.
    await page.goto('/parametres/metier');
    await page.getByRole('button', { name: 'Proposer des profils types' }).click();
    await page.getByLabel('Marge', { exact: true }).fill('1,30');
    await expect(page.getByText(/100 € de revient → 143,00/)).toBeVisible();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Modifications enregistrées.' })).toBeVisible();
    await expectNoA11yViolations(page);

    // 5. Peppol : entité légale créée, vérification, passage à « actif ».
    await page.goto('/parametres/integrations');
    const peppol = page.locator('[aria-labelledby="int-peppol"]');
    await peppol.getByRole('button', { name: 'Activer Peppol' }).click();
    await expect(peppol.getByText('En cours de vérification')).toBeVisible();
    await expect(peppol.getByText('Identifiant Peppol : 0208:0123456749')).toBeVisible();
    await peppol.getByRole('button', { name: 'Tester la connexion' }).click();
    await expect(peppol.getByText('Actif', { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);

    // 6. Invitations : Sophie (Bureau), Karim (Chef de chantier), Luca (Ouvrier).
    await page.goto('/parametres/utilisateurs');
    const people = [
      { name: 'Sophie Martin', email: uniqueEmail('sophie'), role: 'Bureau' },
      { name: 'Karim Benali', email: uniqueEmail('karim'), role: 'Chef de chantier' },
      { name: 'Luca Rossi', email: uniqueEmail('luca'), role: 'Ouvrier' },
    ];
    for (const p of people) {
      await page.getByRole('button', { name: 'Inviter', exact: true }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Inviter un collaborateur' });
      await dialog.getByLabel('E-mail').fill(p.email);
      await dialog.getByLabel('Nom').fill(p.name);
      await dialog.getByRole('radio', { name: new RegExp(`^${p.role}`) }).check();
      await dialog.getByRole('button', { name: 'Inviter' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: `Invitation envoyée à ${p.email}.` }),
      ).toBeVisible();
    }
    await expect(page.locator('li').filter({ hasText: people[2]!.email })).toBeVisible();
    await expectNoA11yViolations(page);

    // Luca accepte son invitation depuis son téléphone et arrive dans l'entreprise avec le rôle Ouvrier.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const lucaPage = await phone.newPage();
    await acceptInvitation(lucaPage, people[2]!.email, 'Luca Rossi');
    await expect(lucaPage.getByRole('heading', { name: 'Bonjour Luca' })).toBeVisible();
    await expect(lucaPage.getByText('Mise en route')).toHaveCount(0);
    await phone.close();

    // Marc est notifié en direct.
    await expect(page.getByTestId('unread-count')).toBeVisible({ timeout: 15_000 });

    // P1.4 : il importe sa liste de prix (CSV exporté de son ancien tableur).
    await page.goto('/bibliotheque/import');
    await page.getByTestId('import-file').setInputFiles({
      name: 'tarifs.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Référence;Désignation;Unité;Prix achat\nCAR-01;Carrelage grès 60x60;m2;34,50\nCOL-01;Colle C2TE 25 kg;pce;18,90\nMO-01;Pose carrelage;m²;22\n',
      ),
    });
    await expect(page.getByText(/3 lignes détectées dans tarifs\.csv/)).toBeVisible();
    await page.getByRole('button', { name: 'Importer', exact: true }).click();
    await expect(page.getByText(/Import terminé en/)).toBeVisible();

    // La checklist de mise en route est complète.
    await page.goto('/aujourdhui');
    await expect(page.locator('[aria-labelledby="onboarding-title"]')).toHaveCount(0);
    expect(Date.now() - start).toBeLessThan(10 * 60_000);
  });

  test('équipes : employé avec INSS chiffré, équipe et congé', async ({ page }) => {
    await signup(page, { name: 'Marc Équipes' });
    await page.goto('/equipes');
    await expect(page.getByText('Aucun employé.')).toBeVisible();
    await page.getByRole('button', { name: 'Ajouter un employé' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Ajouter un employé' });
    await drawer.getByLabel('Prénom').fill('Luca');
    await drawer.getByLabel('Nom', { exact: true }).fill('Rossi');
    await drawer.getByLabel('Fonction').fill('Carreleur');
    await drawer.getByLabel('Numéro INSS').fill('85.07.30-033.29');
    await drawer.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText("Ce numéro INSS n'est pas valide")).toBeVisible();
    await drawer.getByLabel('Numéro INSS').fill('85.07.30-033.28');
    await drawer.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Employé enregistré.' })).toBeVisible();
    await page.getByRole('button', { name: /Luca Rossi/ }).click();
    await expect(page.getByText('••.••.••-•••.28')).toBeVisible();
    await page.getByRole('button', { name: 'Afficher' }).click();
    await expect(page.getByText('85.07.30-033.28')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: /Équipes/ }).click();
    await page.getByRole('button', { name: 'Créer une équipe' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Créer une équipe' });
    await dlg.getByLabel("Nom de l'équipe").fill('Équipe carrelage');
    await dlg.getByLabel('Luca Rossi').check();
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('heading', { name: 'Équipe carrelage' })).toBeVisible();

    await page.getByRole('tab', { name: /Absences/ }).click();
    await page.getByRole('button', { name: 'Déclarer une absence' }).click();
    await page
      .getByRole('dialog', { name: 'Déclarer une absence' })
      .getByRole('button', { name: 'Enregistrer' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Absence enregistrée.' })).toBeVisible();
    await expect(page.getByText('Congé')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('compte : 2FA proposée et sessions visibles', async ({ page }) => {
    await signup(page, { name: 'Marc Sécurité' });
    await page.goto('/compte');
    await expect(page.getByText('Cet appareil')).toBeVisible();
    await page.getByRole('button', { name: 'Activer' }).click();
    await expect(page.getByRole('img', { name: /Scannez ce QR code/ })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
