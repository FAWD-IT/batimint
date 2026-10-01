import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, lastEmailTo, login, PASSWORD, signup, uniqueEmail } from './helpers';

test.describe('M0 — fondations', () => {
  test('P1.1 : Marc crée son espace et arrive sur « Aujourd’hui »', async ({ page }) => {
    await signup(page, { name: 'Marc Lefèvre' });
    await expect(page.getByRole('heading', { name: 'Bonjour Marc' })).toBeVisible();
    await expect(page.getByText('Votre journée commencera ici')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'En direct' })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('un événement traverse outbox → worker → SSE → navigateur', async ({ page }) => {
    await signup(page);
    await page.goto('/parametres/diagnostic');
    await expect(page.getByText('Connectée')).toBeVisible();
    await page.getByRole('button', { name: 'Tester maintenant' }).click();
    await expect(page.getByTestId('diagnostic-success')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Tout fonctionne : aller-retour en \d+ ms/)).toBeVisible();
    // Le système agit puis informe : toast et pastille de notifications, sans recharger.
    await expect(
      page.getByRole('status').filter({ hasText: 'Chaîne temps réel opérationnelle' }),
    ).toBeVisible();
    await expect(page.getByTestId('unread-count')).toHaveText('1');
    await expectNoA11yViolations(page);
  });

  test('deux navigateurs voient la même chose sans recharger', async ({ browser }) => {
    const a = await browser.newContext();
    const pageA = await a.newPage();
    const { email } = await signup(pageA);
    const b = await browser.newContext();
    const pageB = await b.newPage();
    await login(pageB, email);
    await expect(pageB.getByRole('status').filter({ hasText: 'En direct' })).toBeVisible();
    await expect(pageB.getByTestId('unread-count')).toHaveCount(0);
    await pageA.goto('/parametres/diagnostic');
    await pageA.getByRole('button', { name: 'Tester maintenant' }).click();
    await expect(pageB.getByTestId('unread-count')).toHaveText('1', { timeout: 15_000 });
    await a.close();
    await b.close();
  });

  test('connexion : erreurs claires, puis lien magique reçu par e-mail', async ({ page }) => {
    const email = uniqueEmail('sophie');
    await signup(page, { name: 'Sophie Martin', email });
    await page.context().clearCookies();
    await page.goto('/aujourdhui');
    await expect(page).toHaveURL(/\/connexion\?next=%2Faujourdhui/);
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Indiquez une adresse e-mail valide.')).toBeVisible();
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill('mauvais-mot-de-passe');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText(/E-mail ou mot de passe incorrect/)).toBeVisible();
    await page.getByRole('button', { name: 'Recevoir un lien de connexion par e-mail' }).click();
    await page.getByRole('button', { name: 'Recevoir le lien' }).click();
    await expect(page.getByText(/un lien de connexion vient de partir/)).toBeVisible();
    const mail = await lastEmailTo(email, /lien de connexion/);
    const link = /(http\S+\/connexion\/lien\?token=[^\s"]+)/.exec(mail.text)?.[1];
    expect(link).toBeTruthy();
    await page.goto(new URL(link!).pathname + new URL(link!).search);
    await expect(page).toHaveURL(/\/aujourdhui/);
    await expect(page.getByRole('heading', { name: 'Bonjour Sophie' })).toBeVisible();
  });

  test('mot de passe oublié puis nouveau mot de passe', async ({ page }) => {
    const email = uniqueEmail('karim');
    await signup(page, { name: 'Karim Benali', email });
    await page.context().clearCookies();
    await page.goto('/mot-de-passe-oublie');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();
    await expect(page.getByText(/un lien vient de partir/)).toBeVisible();
    const mail = await lastEmailTo(email, /Réinitialisation/);
    const link = new URL(/(http\S+\/mot-de-passe\/nouveau\?token=[^\s"]+)/.exec(mail.text)![1]!);
    await page.goto(link.pathname + link.search);
    await page.getByLabel('Nouveau mot de passe').fill('court');
    await page.getByRole('button', { name: 'Enregistrer et me connecter' }).click();
    await expect(page.getByText('Le mot de passe doit compter au moins 10 caractères.')).toBeVisible();
    await page.getByLabel('Nouveau mot de passe').fill(`${PASSWORD}-nouveau`);
    await page.getByRole('button', { name: 'Enregistrer et me connecter' }).click();
    await expect(page).toHaveURL(/\/aujourdhui/);
  });

  test('déconnexion depuis le menu utilisateur, au clavier', async ({ page }) => {
    await signup(page, { name: 'Marc Clavier' });
    await page.getByRole('button', { name: /Marc Clavier/ }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/connexion/);
  });

  test('@mobile navigation au pouce', async ({ page }) => {
    await signup(page, { name: 'Luca Rossi' });
    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Paramètres' }).click();
    await expect(page).toHaveURL(/\/parametres$/);
    await expect(page.getByRole('heading', { name: 'Paramètres' })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
