import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page } from '@playwright/test';

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

export async function login(page: Page, email: string, password = PASSWORD, landing = /\/aujourdhui/) {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(landing);
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

/** Sur téléphone, rien ne doit dépasser de l'écran (pas de défilement horizontal). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'débordement horizontal (px)').toBeLessThanOrEqual(1);
}

// ---------------------------------------------------------------------------
// Chantier de test créé par le vrai circuit (devis signé sur le portail → worker)
// ---------------------------------------------------------------------------

export async function call<T>(
  request: APIRequestContext,
  method: 'POST' | 'PUT' | 'PATCH' | 'GET',
  path: string,
  data?: unknown,
) {
  const res = await request.fetch(`/api/v1${path}`, { method, ...(data !== undefined ? { data } : {}) });
  expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Un chantier créé par le vrai circuit : devis composé, envoyé, signé sur le portail, worker. */
export async function signedProject(page: Page, email: string) {
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
        lines: [
          line('Faïence murale 30×60 posée', '18', 9_000, 6_500),
          line('Carrelage sol 60×60 posé', '6', 11_000, 8_000),
        ],
      },
      {
        key: crypto.randomUUID(),
        title: 'Plomberie',
        lines: [line('Douche à l’italienne', '1', 250_000, 180_000)],
      },
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

/** Accepte une invitation reçue par e-mail (Mailpit) dans la page donnée. */
export async function acceptInvitation(page: Page, email: string, name: string, landing = /\/aujourdhui/) {
  const mail = await lastEmailTo(email, /vous invite/);
  const link = new URL(/(http\S+\/invitation\?token=[^\s"]+)/.exec(mail.text)![1]!);
  await page.goto(link.pathname + link.search);
  await expect(page.getByRole('heading', { name: /Rejoindre/ })).toBeVisible();
  await page.getByLabel('Votre nom').fill(name);
  await page.getByLabel('Choisissez un mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: "Rejoindre l'entreprise" }).click();
  await expect(page).toHaveURL(landing);
}
