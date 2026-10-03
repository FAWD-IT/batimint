/**
 * M6 — Parcours P3 « Préparer et planifier le chantier » (Sophie) : les tâches du devis signé
 * arrivent « à planifier », Sophie les glisse sur l'équipe de Karim, un congé est signalé, le
 * bloc se déplace au clavier, une affectation se crée au dialogue, et le client voit la date de
 * début sur son portail. Lien iCal d'un ouvrier. Planning sur téléphone.
 */
import { expect, type Page, test } from '@playwright/test';
import {
  call,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  signedProject,
  signup,
  uniqueEmail,
} from './helpers';

/** Lundi de la semaine prochaine (heure de Bruxelles), puis ses jours suivants. */
function nextWeek(): (n: number) => string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((8 - dow) % 7 || 7));
  return (n: number) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
}

async function dropOnRow(page: Page, sourceTestId: string, rowLabel: string, column: number, columns = 14) {
  const row = page.getByTestId(`planning-row-${rowLabel}`);
  const box = (await row.boundingBox())!;
  await page.getByTestId(sourceTestId).dragTo(row, {
    targetPosition: { x: (box.width / columns) * (column + 0.5), y: Math.min(20, box.height / 2) },
  });
}

test('P3 : Sophie planifie le chantier au glisser-déposer, conflit de congé, date sur le portail', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signup(page, { name: 'Sophie Planning', company: 'Rénov Planning P3' });
  const r = page.request;
  const { projectId } = await signedProject(page, uniqueEmail('dupont-p3'));
  const day = nextWeek();
  const karim = await call<{ id: string }>(r, 'POST', '/employees', {
    firstName: 'Karim',
    lastName: 'Benali',
  });
  const luca = await call<{ id: string }>(r, 'POST', '/employees', { firstName: 'Luca', lastName: 'Rossi' });
  await call(r, 'POST', '/teams', {
    name: 'Équipe Karim',
    color: '#2F4BFF',
    leaderEmployeeId: karim.id,
    memberIds: [karim.id, luca.id],
  });
  // Luca est en congé mardi matin la semaine prochaine.
  await call(r, 'POST', `/employees/${luca.id}/absences`, {
    kind: 'leave',
    startsOn: day(1),
    endsOn: day(1),
    halfDay: 'am',
  });

  // 1. Les tâches du devis signé arrivent « à planifier ».
  await page.goto('/planning');
  await expect(page.getByRole('heading', { name: 'Planning', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Période suivante' }).click();
  await expect(page.getByRole('heading', { name: /^Semaine du/ })).toBeVisible();
  await expect(page.getByTestId('unplanned-Faïence murale 30×60 posée')).toBeVisible();
  await expect(page.getByTestId('planning-row-Équipe Karim')).toBeVisible();
  await expectNoA11yViolations(page);

  // Glisser la faïence (9 h prévues → trois demi-journées) sur l'équipe, le lundi matin.
  await dropOnRow(page, 'unplanned-Faïence murale 30×60 posée', 'Équipe Karim', 0);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Affectation enregistrée, avec un conflit' }),
  ).toBeVisible();
  // 2. Le congé de Luca est signalé.
  await expect(page.getByTestId('planning-conflicts')).toContainText('Luca Rossi est en congé mardi');
  const block = page.getByRole('button', { name: /^Dupont · Jumet, Faïence murale 30×60 posée/ }).first();
  await expect(block).toBeVisible();
  await expect(page.getByTestId('unplanned-Faïence murale 30×60 posée')).toHaveCount(0);

  // Alternative clavier : la flèche droite décale d'une demi-journée.
  await block.focus();
  const moved = page.waitForResponse(
    (res) => res.url().includes('/planning/slots/') && res.request().method() === 'PATCH',
  );
  await page.keyboard.press('ArrowRight');
  expect((await moved).ok()).toBeTruthy();
  const grid = await call<{ slots: { taskTitle: string | null; startDay: string; startHalf: string }[] }>(
    r,
    'GET',
    `/planning?from=${day(0)}&to=${day(6)}`,
  );
  expect(grid.slots.find((s) => s.taskTitle === 'Faïence murale 30×60 posée')).toMatchObject({
    startDay: day(0),
    startHalf: 'pm',
  });

  // Au dialogue : la douche pour Luca seul, le mercredi.
  await page.getByRole('button', { name: 'Planifier « Douche à l’italienne »' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle affectation' });
  await expect(dialog.getByLabel('Chantier')).toHaveValue(projectId);
  await dialog.getByLabel('Équipe ou personne').selectOption({ label: 'Luca Rossi' });
  await dialog.getByLabel('Début', { exact: true }).fill(day(2));
  await dialog.getByLabel('Fin', { exact: true }).fill(day(2));
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Affectation ajoutée' })).toBeVisible();
  await page.getByRole('tab', { name: 'Personnes' }).click();
  await expect(
    page.getByTestId('planning-row-Luca Rossi').getByRole('button', { name: /Douche à l’italienne/ }),
  ).toBeVisible();

  // Le client voit la date de début sur son portail (le chantier est en préparation).
  const project = await call<{ startDate: string | null }>(r, 'GET', `/projects/${projectId}`);
  expect(project.startDate).toBe(day(0));
  const link = await call<{ url: string }>(r, 'POST', `/projects/${projectId}/portal-link`, { send: false });
  const portal = await page.context().browser()!.newContext();
  const client = await portal.newPage();
  await client.goto(new URL(link.url).pathname);
  await expect(client.getByRole('heading', { level: 1 })).toContainText('Vos travaux commencent le');
  await expect(client.getByText(/Début des travaux le/)).toBeVisible();
  await portal.close();

  // Lien iCal de Luca, créé par le bureau depuis sa fiche.
  await page.goto('/equipes');
  await page.getByRole('button', { name: /Luca Rossi/ }).click();
  await page.getByRole('button', { name: 'Lien iCal' }).click();
  const ical = page.getByRole('dialog', { name: 'Abonnement au planning' });
  const url = await ical.getByLabel("Lien d'abonnement").inputValue();
  expect(url).toMatch(/\/api\/v1\/ical\/[\w-]+\.ics$/);
  const ics = await page.request.get(new URL(url).pathname);
  expect(ics.headers()['content-type']).toContain('text/calendar');
  const body = await ics.text();
  expect(body).toContain('BEGIN:VCALENDAR');
  expect(body).toContain('SUMMARY:Rénovation salle de bain');
});

test('planning sur téléphone : agenda lisible, sans débordement @mobile', async ({ page }) => {
  await signup(page, { name: 'Sophie Mobile', company: 'Rénov Planning Mobile' });
  await page.goto('/planning');
  await expect(page.getByRole('heading', { name: 'Planning', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Personne à planifier' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);
});
