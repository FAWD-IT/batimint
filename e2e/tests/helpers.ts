import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.test`;
}

export const PASSWORD = 'motdepasse-solide-42';

export async function signup(
  page: Page,
  opts: { name?: string; company?: string; email?: string; stayOnWelcome?: boolean } = {},
) {
  const email = opts.email ?? uniqueEmail('marc');
  await page.goto('/inscription');
  await page.getByLabel('Votre nom').fill(opts.name ?? 'Marc Lefèvre');
  await page.getByLabel("Nom de l'entreprise").fill(opts.company ?? "Rénov'Habitat E2E");
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  // P1 : après l'inscription, l'écran de bienvenue demande le numéro d'entreprise.
  await expect(page).toHaveURL(/\/bienvenue/);
  if (!opts.stayOnWelcome) {
    await page.getByRole('link', { name: 'Je compléterai plus tard' }).click();
    await expect(page).toHaveURL(/\/aujourdhui/);
  }
  return { email };
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/aujourdhui/);
}

/** Aucune violation axe critique ou sérieuse (09). */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(
    blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`),
    'violations axe critiques ou sérieuses',
  ).toEqual([]);
}

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}

/** Dernier e-mail reçu par Mailpit pour une adresse. */
export async function lastEmailTo(
  address: string,
  subjectPattern?: RegExp,
): Promise<{ subject: string; text: string; html: string }> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
    if (res.ok) {
      const body = (await res.json()) as { messages: MailpitMessage[] };
      const msg = body.messages.find((m) => !subjectPattern || subjectPattern.test(m.Subject));
      if (msg) {
        const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as {
          Subject: string;
          Text: string;
          HTML: string;
        };
        return { subject: full.Subject, text: full.Text, html: full.HTML };
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Aucun e-mail pour ${address}`);
}
