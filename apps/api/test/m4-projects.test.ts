/**
 * M4 — Chantier pivot (03 §5, 02 P5, P8) contre un vrai Postgres : cockpit et marge recalculés
 * depuis les données, tâches, fil, commentaires, avenants (envoi, portail, signature),
 * isolation entre tenants et droits de l'Ouvrier.
 */
import { createHash } from 'node:crypto';
import { withSystem } from '@batimint/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDto } from '@batimint/contracts';
import { sha256 } from '../src/lib/crypto';
import { createTestApp, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedUp;
let tenantId: string;
let ownerUserId: string;
let projectId: string;
const posts = { demolition: uuidv7(), carrelage: uuidv7(), plomberie: uuidv7() };
const tasks = { demo: uuidv7(), faience: uuidv7(), sol: uuidv7(), sanitaires: uuidv7() };

const inject = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  s: SignedUp | { cookie: string } = owner,
) =>
  t.app.inject({
    method,
    url,
    headers: { cookie: s.cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const portal = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({
    method,
    url,
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Test', 'x-forwarded-for': '203.0.113.9' },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const outbox = (type: string) =>
  withSystem(t.prisma, (tx) =>
    tx.outboxEvent.findMany({ where: { tenantId, type }, orderBy: { occurredAt: 'asc' } }),
  );

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov Chantier');
  const me = (await inject('GET', '/v1/me')).json();
  tenantId = me.tenant.id;
  ownerUserId = me.user.id;
  const dupont = (
    await inject('POST', '/v1/customers', {
      kind: 'individual',
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean.dupont.m4@example.be',
    })
  ).json();
  const site = (
    await inject('POST', `/v1/customers/${dupont.id}/sites`, {
      street: 'Rue de la Station 42',
      postalCode: '6040',
      city: 'Jumet',
      isPrivateDwelling: true,
      firstOccupancyYear: 1975,
    })
  ).json();
  projectId = uuidv7();
  // Le chantier naît normalement de la signature du devis (worker, testé à part) : ici on le pose.
  await withSystem(t.prisma, async (tx) => {
    await tx.project.create({
      data: {
        id: projectId,
        tenantId,
        number: 'CH2026-001',
        name: 'Rénovation salle de bain Dupont',
        customerId: dupont.id,
        siteId: site.id,
        status: 'in_progress',
        contractAmount: 10_000_000n,
        managerUserId: ownerUserId,
        startDate: new Date('2026-09-21T00:00:00Z'),
        endDate: new Date('2026-10-09T00:00:00Z'),
      },
    });
    await tx.budgetLine.createMany({
      data: [
        {
          id: posts.demolition,
          tenantId,
          projectId,
          position: 0,
          label: 'Démolition',
          saleAmount: 2_000_000n,
          budgetedCost: 1_500_000n,
        },
        {
          id: posts.carrelage,
          tenantId,
          projectId,
          position: 1,
          label: 'Carrelage',
          saleAmount: 3_000_000n,
          budgetedCost: 2_000_000n,
        },
        {
          id: posts.plomberie,
          tenantId,
          projectId,
          position: 2,
          label: 'Plomberie',
          saleAmount: 5_000_000n,
          budgetedCost: 4_000_000n,
        },
      ],
    });
    await tx.task.createMany({
      data: [
        {
          id: tasks.demo,
          tenantId,
          projectId,
          budgetLineId: posts.demolition,
          position: 0,
          title: 'Démolition faïence',
          amount: 2_000_000n,
          status: 'done',
          progress: '1',
          quoteLineKey: uuidv7(),
        },
        {
          id: tasks.faience,
          tenantId,
          projectId,
          budgetLineId: posts.carrelage,
          position: 1,
          title: 'Faïence murale',
          amount: 1_500_000n,
          status: 'done',
          progress: '1',
          quoteLineKey: uuidv7(),
        },
        {
          id: tasks.sol,
          tenantId,
          projectId,
          budgetLineId: posts.carrelage,
          position: 2,
          title: 'Carrelage sol',
          amount: 1_500_000n,
          quoteLineKey: uuidv7(),
        },
        {
          id: tasks.sanitaires,
          tenantId,
          projectId,
          budgetLineId: posts.plomberie,
          position: 3,
          title: 'Sanitaires',
          amount: 5_000_000n,
          status: 'in_progress',
          progress: '0.2',
          quoteLineKey: uuidv7(),
        },
      ],
    });
  });
});

afterAll(async () => {
  await t.close();
});

describe('cockpit du chantier', () => {
  it('liste les chantiers actifs avec avancement pondéré et libellé court', async () => {
    const res = await inject('GET', '/v1/projects?view=active');
    expect(res.statusCode).toBe(200);
    const p = res.json().items.find((x: { id: string }) => x.id === projectId);
    // (2M × 1 + 3M × 0,5 + 5M × 0,2) / 10M = 45 %
    expect(p).toMatchObject({
      progress: '0.45',
      shortLabel: 'Dupont · Jumet',
      health: 'ok',
      plannedMargin: '0.25',
    });
    expect((await inject('GET', '/v1/projects?view=finished')).json().items).toHaveLength(0);
    expect((await inject('GET', '/v1/projects?view=all&q=jumet')).json().items).toHaveLength(1);
  });

  it('un coût qui dépasse le budget du poste fait baisser la marge et lève une alerte', async () => {
    const cost = await inject('POST', `/v1/projects/${projectId}/costs`, {
      budgetLineId: posts.carrelage,
      label: 'Faïence complémentaire',
      amount: 2_300_000,
    });
    expect(cost.statusCode).toBe(201);
    const d: ProjectDto = (await inject('GET', `/v1/projects/${projectId}`)).json();
    const carrelage = d.budgetLines.find((l) => l.id === posts.carrelage)!;
    expect(carrelage).toMatchObject({
      committed: 2_300_000,
      drift: true,
      progress: '0.5',
      consumption: '1.15',
    });
    // Projeté : 1,5M + (2,3M + 1M) + (0,8M + 3,2M) = 8,8M → marge estimée 12 %.
    expect(d.financials).toMatchObject({
      contractAmount: 10_000_000,
      budgetedCost: 7_500_000,
      committed: 2_300_000,
      projectedCost: 8_800_000,
      plannedMargin: '0.25',
      estimatedMargin: '0.12',
    });
    expect(d.todos).toContainEqual(
      expect.objectContaining({ kind: 'budget_drift', ref: posts.carrelage, overPercent: 15 }),
    );
    expect(d.health).toBe('warn');
    expect(d.schedule.totalDays).toBe(15);
    expect(d.step).toBe('works');
    expect((await outbox('project.cost_recorded.v1')).length).toBe(1);
  });

  it('l’avancement des tâches recalcule celui du poste', async () => {
    const res = await inject('PATCH', `/v1/projects/${projectId}/tasks/${tasks.sanitaires}`, {
      progressPercent: 60,
    });
    expect(res.json()).toMatchObject({ status: 'in_progress', progress: '0.6' });
    const done = await inject('PATCH', `/v1/projects/${projectId}/tasks/${tasks.sol}`, { status: 'done' });
    expect(done.json()).toMatchObject({ status: 'done', progress: '1' });
    expect(
      (await outbox('task.completed.v1')).map((e) => (e.payload as { taskId: string }).taskId),
    ).toContain(tasks.sol);
    const d: ProjectDto = (await inject('GET', `/v1/projects/${projectId}`)).json();
    // (2M + 3M + 5M × 0,6) / 10M = 80 %
    expect(d.progress).toBe('0.8');
    const list = (await inject('GET', `/v1/projects/${projectId}/tasks`)).json().items;
    expect(list).toHaveLength(4);
    const manual = await inject('POST', `/v1/projects/${projectId}/tasks`, {
      budgetLineId: posts.carrelage,
      title: 'Joints silicone',
    });
    expect(manual.statusCode).toBe(201);
    expect((await inject('DELETE', `/v1/projects/${projectId}/tasks/${tasks.demo}`)).statusCode).toBe(409);
    expect((await inject('DELETE', `/v1/projects/${projectId}/tasks/${manual.json().id}`)).statusCode).toBe(
      200,
    );
  });

  it('le statut suit le cycle de vie, la suspension exige une raison', async () => {
    expect((await inject('POST', `/v1/projects/${projectId}/status`, { to: 'suspended' })).statusCode).toBe(
      400,
    );
    const s = await inject('POST', `/v1/projects/${projectId}/status`, {
      to: 'suspended',
      reason: 'Attente du carreleur',
    });
    expect(s.json()).toMatchObject({ status: 'suspended', suspendedReason: 'Attente du carreleur' });
    expect((await inject('POST', `/v1/projects/${projectId}/status`, { to: 'closed' })).statusCode).toBe(409);
    expect(
      (await inject('POST', `/v1/projects/${projectId}/status`, { to: 'in_progress' })).json().status,
    ).toBe('in_progress');
  });

  it('le fil mêle entrées et commentaires ; les mentions ne visent que des membres', async () => {
    await withSystem(t.prisma, (tx) =>
      tx.timelineEntry.create({
        data: {
          tenantId,
          projectId,
          type: 'change_order.signed',
          title: 'Avenant n°0 signé',
          amount: 125_000n,
          occurredAt: new Date(Date.now() - 60_000),
        },
      }),
    );
    const c = await inject('POST', '/v1/comments', {
      subjectType: 'project',
      subjectId: projectId,
      body: `Bien vu @[Marc](${ownerUserId}) et @[Fantôme](${uuidv7()})`,
    });
    expect(c.statusCode).toBe(201);
    const ev = (await outbox('comment.added.v1')).at(-1)!;
    // L'auteur ne se notifie pas lui-même, et l'inconnu est ignoré.
    expect((ev.payload as { mentions: string[] }).mentions).toEqual([]);
    const tl = (await inject('GET', `/v1/projects/${projectId}/timeline`)).json();
    expect(tl.items[0]).toMatchObject({ kind: 'comment', comment: { mine: true } });
    expect(
      tl.items.some(
        (i: { title: string; amount: number }) => i.title === 'Avenant n°0 signé' && i.amount === 125_000,
      ),
    ).toBe(true);
    const money = (await inject('GET', `/v1/projects/${projectId}/timeline?filter=money`)).json();
    expect(money.items.every((i: { kind: string }) => i.kind === 'entry')).toBe(true);
  });

  it('recherche ⌘K multi-objets', async () => {
    const res = (await inject('GET', '/v1/search?q=dupont')).json();
    const types = res.items.map((i: { type: string }) => i.type);
    expect(types).toContain('project');
    expect(types).toContain('customer');
    expect(res.items.find((i: { type: string }) => i.type === 'project').href).toBe(
      `/chantiers/${projectId}`,
    );
  });
});

describe('avenants (P5)', () => {
  let coId: string;
  let portalToken: string;

  it('crée un brouillon calculé comme un devis, sur un poste existant et un nouveau poste', async () => {
    const res = await inject('POST', `/v1/projects/${projectId}/change-orders`, {
      title: 'Niche murale et éclairage',
      description: 'Ajout d’une niche carrelée et de deux spots.',
      delayDays: 2,
      lines: [
        {
          budgetLineId: posts.carrelage,
          description: 'Niche murale carrelée',
          unit: 'u',
          quantity: '1',
          unitPrice: 95_000,
          unitCost: 60_000,
          laborHours: '4',
          vatRegime: 'reduced_6',
        },
        {
          budgetLineId: null,
          newPostLabel: 'Éclairage',
          description: 'Spot LED encastré',
          unit: 'u',
          quantity: '2',
          unitPrice: 15_000,
          unitCost: 8_000,
          vatRegime: 'reduced_6',
        },
      ],
    });
    expect(res.statusCode).toBe(201);
    const co = res.json();
    coId = co.id;
    expect(co).toMatchObject({
      ordinal: 1,
      status: 'draft',
      number: null,
      totalNet: 125_000,
      totalVat: 7_500,
      totalGross: 132_500,
    });
    // (1 250 − 600 − 160) / 1 250
    expect(co.marginRate).toBe('0.392');
    expect(co.project.defaultVatRegime).toBeTruthy();
    const stale = await inject('PUT', `/v1/change-orders/${coId}`, { ...co, revision: 99, lines: [] });
    expect(stale.statusCode).toBe(409);
    const noPost = await inject('PUT', `/v1/change-orders/${coId}`, {
      title: co.title,
      delayDays: 2,
      revision: co.revision,
      lines: [
        {
          budgetLineId: null,
          description: 'x',
          unit: 'u',
          quantity: '1',
          unitPrice: 1,
          vatRegime: 'reduced_6',
        },
      ],
    });
    expect(noPost.json().error.code).toBe('post_required');
    const second = (
      await inject('POST', `/v1/projects/${projectId}/change-orders`, { title: 'Brouillon jetable' })
    ).json();
    expect(second.ordinal).toBe(2);
    expect((await inject('DELETE', `/v1/change-orders/${second.id}`)).statusCode).toBe(200);
  });

  it('l’envoi attribue le numéro, fige le PDF et verrouille l’avenant', async () => {
    const res = await inject('POST', `/v1/change-orders/${coId}/send`, {
      email: 'jean.dupont.m4@example.be',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'sent', sentTo: 'jean.dupont.m4@example.be' });
    expect(res.json().number).toMatch(/^AV\d{4}-001$/);
    const row = await withSystem(t.prisma, (tx) => tx.changeOrder.findUniqueOrThrow({ where: { id: coId } }));
    expect(row.pdfKey).toBeTruthy();
    expect(
      Buffer.from(await t.deps.integrations.storage.get('uploads', row.pdfKey!))
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    expect((await outbox('change_order.sent.v1')).length).toBe(1);
    const locked = await inject('PUT', `/v1/change-orders/${coId}`, { title: 'Modifié', delayDays: 0,
      revision: row.revision,
      lines: [],
    });
    expect(locked.json().error.code).toBe('change_order_locked');
    const d: ProjectDto = (await inject('GET', `/v1/projects/${projectId}`)).json();
    expect(d.todos).toContainEqual(expect.objectContaining({ kind: 'change_order_awaiting', ordinal: 1 }));
  });

  it('le client voit l’avenant « À valider » sur son portail et pose une question', async () => {
    const link = (await inject('POST', `/v1/projects/${projectId}/portal-link`, {})).json();
    portalToken = decodeURIComponent(new URL(link.url).pathname.split('/p/')[1]!);
    const view = await portal('GET', `/v1/portal/projects/${encodeURIComponent(portalToken)}`);
    expect(view.statusCode).toBe(200);
    const dto = view.json();
    expect(dto.project).toMatchObject({ name: 'Rénovation salle de bain Dupont', progress: '0.8' });
    expect(dto.changeOrders[0]).toMatchObject({
      id: coId,
      status: 'sent',
      totalNet: 125_000,
      newEndDate: '2026-10-13',
    });
    expect(dto.changeOrders[0].lines).toHaveLength(2);
    // Rien d'interne : ni coût, ni marge.
    expect(JSON.stringify(dto)).not.toMatch(/unitCost|budgetedCost|margin/);

    const q = await portal('POST', `/v1/portal/projects/${encodeURIComponent(portalToken)}/comments`, {
      subjectType: 'change_order',
      subjectId: coId,
      body: 'La niche peut-elle être plus haute ?',
    });
    expect(q.json().changeOrders[0].thread[0]).toMatchObject({
      fromClient: true,
      authorLabel: 'Jean Dupont',
    });
    let d: ProjectDto = (await inject('GET', `/v1/projects/${projectId}`)).json();
    expect(d.todos).toContainEqual(
      expect.objectContaining({ kind: 'client_question', subject: 'Avenant n°1' }),
    );
    const reply = await inject('POST', '/v1/comments', {
      subjectType: 'change_order',
      subjectId: coId,
      body: 'Oui, jusqu’à 1,60 m sans supplément.',
      visibleToClient: true,
    });
    expect(reply.statusCode).toBe(201);
    d = (await inject('GET', `/v1/projects/${projectId}`)).json();
    expect(d.todos.some((x) => x.kind === 'client_question')).toBe(false);
    const after = (await portal('GET', `/v1/portal/projects/${encodeURIComponent(portalToken)}`)).json();
    expect(after.changeOrders[0].thread.map((c: { fromClient: boolean }) => c.fromClient)).toEqual([
      true,
      false,
    ]);
  });

  it('le client signe : signature conservée avec le PDF, événement émis, double signature refusée', async () => {
    const url = `/v1/portal/projects/${encodeURIComponent(portalToken)}/change-orders/${coId}/sign`;
    expect((await portal('POST', url, { signerName: 'Jean Dupont' })).statusCode).toBe(400);
    const res = await portal('POST', url, {
      signerName: 'Jean Dupont',
      acceptTerms: true,
      signaturePath: 'M 10 10 L 20 20',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().changeOrders[0]).toMatchObject({ status: 'signed' });
    const sig = await withSystem(t.prisma, (tx) =>
      tx.signature.findFirstOrThrow({ where: { subjectType: 'change_order', subjectId: coId } }),
    );
    expect(sig).toMatchObject({ signerName: 'Jean Dupont', ip: expect.any(String) });
    const pdf = Buffer.from(await t.deps.integrations.storage.get('legal', sig.documentKey!));
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(sig.documentSha256);
    expect((await outbox('change_order.signed.v1')).length).toBe(1);
    expect(
      (await portal('POST', url, { signerName: 'Jean Dupont', acceptTerms: true })).json().error.code,
    ).toBe('already_signed');
    const audit = await withSystem(t.prisma, (tx) =>
      tx.auditLog.findFirst({ where: { tenantId, action: 'change_order.signed', entityId: coId } }),
    );
    expect(audit).toBeTruthy();
    const pdfRes = await portal(
      'GET',
      `/v1/portal/projects/${encodeURIComponent(portalToken)}/change-orders/${coId}/pdf`,
    );
    expect(pdfRes.headers['content-type']).toBe('application/pdf');
  });

  it('un lien inconnu, révoqué ou d’un devis ne donne pas accès au chantier', async () => {
    expect((await portal('GET', '/v1/portal/projects/inconnu-inconnu-inconnu-inconnu')).statusCode).toBe(404);
    await withSystem(t.prisma, (tx) =>
      tx.portalToken.updateMany({ where: { projectId }, data: { revokedAt: new Date() } }),
    );
    expect((await portal('GET', `/v1/portal/projects/${encodeURIComponent(portalToken)}`)).statusCode).toBe(
      404,
    );
  });
});

describe('isolation et droits', () => {
  it('un autre tenant ne voit pas le chantier', async () => {
    const other = await signupCompany(t.app, 'Concurrent');
    expect((await inject('GET', `/v1/projects/${projectId}`, undefined, other)).statusCode).toBe(404);
    expect((await inject('GET', '/v1/projects?view=all', undefined, other)).json().items).toHaveLength(0);
    expect((await inject('GET', `/v1/change-orders/${uuidv7()}`, undefined, other)).statusCode).toBe(404);
    expect((await inject('GET', '/v1/search?q=dupont', undefined, other)).json().items).toHaveLength(0);
  });

  it('l’Ouvrier avance ses tâches mais ne voit ni prix, ni coûts, ni marges', async () => {
    const inv = await inject('POST', '/v1/invitations', { email: 'luca-m4@example.test', role: 'worker' });
    const token = 'm4-token-abcdefghijklmnopqrstuv';
    await withSystem(t.prisma, (tx) =>
      tx.invitation.update({ where: { id: inv.json().id }, data: { tokenHash: sha256(token) } }),
    );
    const acc = await t.app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token, name: 'Luca', password: 'motdepasse-solide-42' },
    });
    const cookie = `bm_session=${acc.cookies.find((c) => c.name === 'bm_session')!.value}`;
    const luca = { cookie };
    const d = (await inject('GET', `/v1/projects/${projectId}`, undefined, luca)).json();
    expect(d.financials).toBeUndefined();
    expect(d.contractAmount).toBeUndefined();
    expect(d.budgetLines[0].saleAmount).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/budgetedCost|estimatedMargin|committed/);
    const tl = (await inject('GET', `/v1/projects/${projectId}/timeline`, undefined, luca)).json();
    expect(tl.items.every((i: { amount: number | null }) => i.amount === null)).toBe(true);
    expect(
      (
        await inject(
          'PATCH',
          `/v1/projects/${projectId}/tasks/${tasks.sanitaires}`,
          { progressPercent: 70 },
          luca,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await inject(
          'PATCH',
          `/v1/projects/${projectId}/tasks/${tasks.sanitaires}`,
          { title: 'Renommée' },
          luca,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await inject(
          'POST',
          `/v1/projects/${projectId}/costs`,
          { budgetLineId: null, label: 'Essence', amount: 100 },
          luca,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await inject('POST', `/v1/projects/${projectId}/change-orders`, { title: 'Pas moi' }, luca))
        .statusCode,
    ).toBe(403);
  });
});
