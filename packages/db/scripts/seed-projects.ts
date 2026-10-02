/**
 * Seed M4 (09 « Tenant de démonstration ») : 25 chantiers dans tous les statuts, dont le chantier
 * Dupont des maquettes. Tous les chiffres affichés (avancement, marges, engagé, facturé) sont
 * recalculés par l'application depuis ces données : postes, tâches, coûts, factures, avenants.
 *
 * Chantier Dupont (contrat 38 400 € HTVA après deux avenants) :
 *  - marge prévue 24,0 % (coût budgété 29 184 €), marge estimée 21,8 % ;
 *  - avancement 62 % (Démolition 100, Plomberie 80, Carrelage 45, Électricité 30, Finitions 0) ;
 *  - poste Carrelage en dérive (engagé = 112 % du budget) ;
 *  - facture 2026-118 (état d'avancement à 40 %) échue depuis 3 jours ;
 *  - avenant n°2 signé aujourd'hui, avenant n°3 en attente du client.
 * L'engagé total (≈ 19 000 €) diffère de la maquette (21 160 €) : avec la formule du coût projeté
 * (ADR 0004), 21 160 € d'engagé à 62 % ne laisse pas une marge estimée de 21,8 %.
 */
import {
  addDays,
  brusselsDate,
  computeChangeOrder,
  computeQuote,
  dec,
  formatDocumentNumber,
  formatEuros,
  isWorkingDay,
  type IsoDate,
  multiplyCents,
  roundHalfAwayFromZero,
  type VatRegime,
} from '@batimint/domain';
import { randomUUID } from 'node:crypto';
import type { Tx } from '../src/client';
import { loadVersionContent, replaceVersionContent } from '../src/quotes';
import { nextSequenceValue } from '../src/sequences';

const euros = (v: number): bigint => BigInt(Math.round(v * 100));
const at = (d: IsoDate, hhmm = '09:00') => new Date(`${d}T${hhmm}:00+02:00`);

function workingDaysFrom(base: IsoDate, n: number): IsoDate {
  let d = base;
  let left = Math.abs(n);
  const step = n < 0 ? -1 : 1;
  while (left > 0) {
    d = addDays(d, step);
    if (isWorkingDay(d)) left--;
  }
  return d;
}

interface LineSpec {
  d: string;
  qty: number;
  unit: string;
  price: number;
  cost: number;
  hours?: number;
}
interface PostSpec {
  title: string;
  progress: number;
  lines: LineSpec[];
}

async function nextNumber(tx: Tx, tenantId: string, type: string, pattern: string): Promise<string> {
  const year = new Date().getFullYear();
  return formatDocumentNumber(pattern, { year, sequence: await nextSequenceValue(tx, tenantId, type, year) });
}

/** Devis signé à lignes explicites, calculé avec les fonctions du domaine (comme l'éditeur). */
async function signedQuote(
  tx: Tx,
  ctx: { tenantId: string; userId: string | null },
  q: {
    customerId: string;
    siteId: string | null;
    opportunityId: string | null;
    title: string;
    posts: PostSpec[];
    sentAt: Date;
    signedAt: Date;
    signer: string;
  },
) {
  const number = await nextNumber(tx, ctx.tenantId, 'quote', 'D{YYYY}-{SEQ:3}');
  const quote = await tx.quote.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      title: q.title,
      customerId: q.customerId,
      siteId: q.siteId,
      opportunityId: q.opportunityId,
      status: 'signed',
      ownerUserId: ctx.userId,
      createdBy: ctx.userId,
      sentAt: q.sentAt,
      viewedAt: new Date(q.sentAt.getTime() + 3 * 3_600_000),
      signedAt: q.signedAt,
      validUntil: new Date(q.sentAt.getTime() + 30 * 86_400_000),
    },
  });
  const version = await tx.quoteVersion.create({
    data: {
      tenantId: ctx.tenantId,
      quoteId: quote.id,
      version: 1,
      status: 'signed',
      vatContext: { regime: 'reduced_6', reason: 'dwelling_over_10_years' },
      sentAt: q.sentAt,
      createdBy: ctx.userId,
    },
  });
  await tx.quote.update({ where: { id: quote.id }, data: { currentVersionId: version.id } });
  await replaceVersionContent(tx, ctx.tenantId, version.id, {
    sections: q.posts.map((p) => ({
      key: randomUUID(),
      title: p.title,
      optional: false,
      selected: false,
      lines: p.lines.map((l) => ({
        key: randomUUID(),
        kind: 'item',
        description: l.d,
        unit: l.unit,
        quantity: String(l.qty),
        unitPrice: euros(l.price),
        unitCost: euros(l.cost),
        laborHours: String(l.hours ?? 0),
        vatRegime: 'reduced_6',
        vatSuggested: 'reduced_6',
        discountPercent: '0',
      })),
    })),
  });
  const loaded = (await loadVersionContent(tx, version.id))!;
  const totals = computeQuote(loaded.content);
  await tx.quoteVersion.update({
    where: { id: version.id },
    data: {
      totalNet: totals.document.totalNet,
      totalVat: totals.document.totalVat,
      totalGross: totals.document.totalGross,
      totalCost: totals.totalCost,
    },
  });
  await tx.signature.create({
    data: {
      tenantId: ctx.tenantId,
      subjectType: 'quote_version',
      subjectId: version.id,
      signerName: q.signer,
      acceptedTerms: true,
      ip: '203.0.113.42',
      userAgent: 'Seed de démonstration',
      documentSha256: '0'.repeat(64),
      signedAt: q.signedAt,
    },
  });
  return { quote, version, loaded, totals };
}

/** Chantier, postes et tâches à partir du devis signé (même logique que le consommateur). */
async function projectFromQuote(
  tx: Tx,
  ctx: { tenantId: string; userId: string | null },
  input: {
    quoteId: string;
    customerId: string;
    siteId: string | null;
    opportunityId: string | null;
    name: string;
    status: 'in_progress';
    startDate: IsoDate;
    endDate: IsoDate;
    managerUserId: string | null;
    teamId: string | null;
    posts: PostSpec[];
    sections: Awaited<ReturnType<typeof signedQuote>>['loaded']['content']['sections'];
    totals: Awaited<ReturnType<typeof signedQuote>>['totals'];
    createdAt: Date;
  },
) {
  const number = await nextNumber(tx, ctx.tenantId, 'project', 'CH{YYYY}-{SEQ:3}');
  const project = await tx.project.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      name: input.name,
      customerId: input.customerId,
      siteId: input.siteId,
      quoteId: input.quoteId,
      opportunityId: input.opportunityId,
      status: input.status,
      contractAmount: input.totals.document.totalNet,
      managerUserId: input.managerUserId,
      teamId: input.teamId,
      startDate: new Date(`${input.startDate}T00:00:00Z`),
      endDate: new Date(`${input.endDate}T00:00:00Z`),
      createdBy: ctx.userId,
      createdAt: input.createdAt,
    },
  });
  const sectionTotals = new Map(input.totals.sections.map((s) => [s.id, s]));
  const lineTotals = new Map(input.totals.lines.map((l) => [l.id, l]));
  const posts: { id: string; progress: number }[] = [];
  let taskPosition = 0;
  for (const [i, s] of input.sections.entries()) {
    const st = sectionTotals.get(s.id)!;
    const progress = input.posts[i]!.progress;
    const bl = await tx.budgetLine.create({
      data: {
        tenantId: ctx.tenantId,
        projectId: project.id,
        quoteSectionKey: s.id,
        position: i,
        label: s.title,
        budgetedCost: st.cost,
        saleAmount: st.netAmount,
        laborHours: st.laborHours.toString(),
      },
    });
    posts.push({ id: bl.id, progress });
    for (const l of s.lines) {
      const lt = lineTotals.get(l.id)!;
      await tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          projectId: project.id,
          budgetLineId: bl.id,
          quoteLineKey: l.id,
          position: taskPosition++,
          title: l.description,
          quantity: String(l.quantity),
          unit: l.unit,
          plannedHours: lt.laborHours.toDecimalPlaces(2).toString(),
          amount: lt.netAmount,
          status: progress >= 1 ? 'done' : progress > 0 ? 'in_progress' : 'todo',
          progress: String(progress),
          completedAt: progress >= 1 ? input.createdAt : null,
        },
      });
    }
  }
  return { project, posts };
}

/** Avenant ; signé, il est appliqué au budget, aux tâches et au contrat comme le ferait le worker. */
async function changeOrder(
  tx: Tx,
  ctx: { tenantId: string; userId: string | null },
  project: { id: string; endDate: Date | null },
  co: {
    ordinal: number;
    title: string;
    description: string;
    status: 'sent' | 'signed';
    delayDays: number;
    sentAt: Date;
    signedAt?: Date;
    signer?: string;
    email: string;
    lines: (LineSpec & { postId: string; progress: number })[];
  },
) {
  const number = await nextNumber(tx, ctx.tenantId, 'change_order', 'AV{YYYY}-{SEQ:3}');
  const ids = co.lines.map(() => randomUUID());
  const totals = computeChangeOrder(
    co.lines.map((l, i) => ({
      id: ids[i]!,
      description: l.d,
      unit: l.unit,
      quantity: String(l.qty),
      unitPrice: euros(l.price),
      unitCost: euros(l.cost),
      laborHours: String(l.hours ?? 0),
      vatRegime: 'reduced_6' as VatRegime,
      budgetLineId: l.postId,
    })),
  );
  const row = await tx.changeOrder.create({
    data: {
      tenantId: ctx.tenantId,
      projectId: project.id,
      ordinal: co.ordinal,
      number,
      title: co.title,
      description: co.description,
      status: co.status,
      delayDays: co.delayDays,
      totalNet: totals.document.totalNet,
      totalVat: totals.document.totalVat,
      totalGross: totals.document.totalGross,
      totalCost: totals.totalCost,
      laborHours: totals.laborHours.toString(),
      sentAt: co.sentAt,
      sentTo: co.email,
      signedAt: co.signedAt ?? null,
      createdBy: ctx.userId,
      createdAt: new Date(co.sentAt.getTime() - 3_600_000),
      lines: {
        create: co.lines.map((l, i) => ({
          id: ids[i]!,
          tenantId: ctx.tenantId,
          position: i,
          budgetLineId: l.postId,
          description: l.d,
          unit: l.unit,
          quantity: String(l.qty),
          unitPrice: euros(l.price),
          unitCost: euros(l.cost),
          laborHours: String(l.hours ?? 0),
          vatRegime: 'reduced_6',
        })),
      },
    },
  });
  if (co.status !== 'signed') return { row, totals };
  const sig = await tx.signature.create({
    data: {
      tenantId: ctx.tenantId,
      subjectType: 'change_order',
      subjectId: row.id,
      signerName: co.signer ?? 'Client',
      acceptedTerms: true,
      ip: '203.0.113.42',
      userAgent: 'Seed de démonstration',
      documentSha256: '0'.repeat(64),
      signedAt: co.signedAt!,
    },
  });
  await tx.changeOrder.update({ where: { id: row.id }, data: { signatureId: sig.id } });
  const lineNet = new Map(totals.lines.map((l) => [l.id, l]));
  for (const t of totals.byTarget) {
    const bl = await tx.budgetLine.findUniqueOrThrow({ where: { id: t.budgetLineId! } });
    await tx.budgetLine.update({
      where: { id: bl.id },
      data: {
        saleAmount: { increment: t.sale },
        budgetedCost: { increment: t.cost },
        laborHours: dec(bl.laborHours.toString()).plus(t.laborHours).toString(),
      },
    });
  }
  const last = await tx.task.aggregate({ where: { projectId: project.id }, _max: { position: true } });
  for (const [i, l] of co.lines.entries()) {
    const lt = lineNet.get(ids[i]!)!;
    await tx.task.create({
      data: {
        tenantId: ctx.tenantId,
        projectId: project.id,
        budgetLineId: l.postId,
        changeOrderLineId: ids[i]!,
        position: (last._max.position ?? 0) + 1 + i,
        title: l.d,
        quantity: String(l.qty),
        unit: l.unit,
        plannedHours: lt.laborHours.toDecimalPlaces(2).toString(),
        amount: lt.netAmount,
        status: l.progress >= 1 ? 'done' : l.progress > 0 ? 'in_progress' : 'todo',
        progress: String(l.progress),
      },
    });
  }
  await tx.project.update({
    where: { id: project.id },
    data: { contractAmount: { increment: totals.document.totalNet } },
  });
  return { row, totals };
}

async function cost(
  tx: Tx,
  tenantId: string,
  projectId: string,
  budgetLineId: string | null,
  c: {
    category: 'supplier_invoice' | 'labour' | 'other' | 'subcontract' | 'equipment';
    label: string;
    amount: bigint;
    at: Date;
  },
) {
  await tx.projectCost.create({
    data: {
      tenantId,
      projectId,
      budgetLineId,
      category: c.category,
      sourceType: 'seed',
      sourceId: randomUUID(),
      label: c.label,
      amount: c.amount,
      occurredAt: c.at,
    },
  });
}

async function timeline(
  tx: Tx,
  tenantId: string,
  projectId: string,
  customerId: string,
  e: {
    type: string;
    title: string;
    body?: string;
    at: Date;
    amount?: bigint;
    client?: boolean;
    actor?: string;
    changeOrderId?: string;
    data?: object;
  },
) {
  await tx.timelineEntry.create({
    data: {
      tenantId,
      projectId,
      customerId,
      type: e.type,
      title: e.title,
      body: e.body ?? null,
      occurredAt: e.at,
      amount: e.amount ?? null,
      visibleToClient: e.client ?? false,
      actorLabel: e.actor ?? null,
      changeOrderId: e.changeOrderId ?? null,
      ...(e.data ? { data: e.data } : {}),
    },
  });
}

async function issueInvoice(
  tx: Tx,
  tenantId: string,
  input: {
    projectId: string;
    customerId: string;
    type: 'progress' | 'final' | 'deposit';
    status: 'sent' | 'paid';
    title: string;
    net: bigint;
    vatRegime: VatRegime;
    issuedAt: IsoDate;
    dueDate: IsoDate;
  },
) {
  const rate = input.vatRegime === 'reduced_6' ? '0.06' : input.vatRegime === 'standard_21' ? '0.21' : '0';
  const vat = roundHalfAwayFromZero(dec(input.net.toString()).times(rate));
  const number = await nextNumber(tx, tenantId, 'invoice', '{YYYY}-{SEQ:3}');
  await tx.invoice.create({
    data: {
      tenantId,
      projectId: input.projectId,
      customerId: input.customerId,
      type: input.type,
      status: input.status,
      number,
      title: input.title,
      totalNet: input.net,
      totalVat: vat,
      totalGross: input.net + vat,
      issuedAt: at(input.issuedAt, '10:00'),
      dueDate: new Date(`${input.dueDate}T00:00:00Z`),
      lines: {
        create: [
          {
            tenantId,
            position: 0,
            description: input.title,
            quantity: '1',
            unitPrice: input.net,
            vatRegime: input.vatRegime,
          },
        ],
      },
    },
  });
  return number;
}

// ---------------------------------------------------------------------------
// Les autres chantiers (statuts variés, chiffres réalistes)
// ---------------------------------------------------------------------------

type Status =
  'preparation' | 'in_progress' | 'suspended' | 'provisional_acceptance' | 'final_acceptance' | 'closed';

interface OtherSpec {
  /** Nom de famille (particulier) ou raison sociale (entreprise) d'un client du seed CRM. */
  customer: string;
  name: string;
  status: Status;
  sale: number;
  margin: number;
  posts: [label: string, share: number][];
  progress: number;
  /** Engagé / (budget × avancement) : > 1 = dépassement. */
  spend: number;
  /** Poste (index) qui dérive, avec son engagé / budget. */
  drift?: [index: number, consumption: number];
  startOffset: number;
  durationDays: number;
  overdueInvoice?: number;
  suspendedReason?: string;
  regime?: VatRegime;
  description?: string;
}

const OTHERS: OtherSpec[] = [
  {
    customer: 'Lejeune',
    name: 'Remplacement de la toiture',
    status: 'in_progress',
    sale: 24_000,
    margin: 0.26,
    posts: [
      ['Échafaudage', 0.12],
      ['Couverture', 0.63],
      ['Zinguerie', 0.25],
    ],
    progress: 0.35,
    spend: 1,
    drift: [0, 1.15],
    startOffset: -6,
    durationDays: 18,
  },
  {
    customer: 'Charlier',
    name: 'Extension arrière 20 m²',
    status: 'in_progress',
    sale: 65_000,
    margin: 0.22,
    posts: [
      ['Gros œuvre', 0.45],
      ['Toiture plate', 0.2],
      ['Menuiseries', 0.2],
      ['Finitions', 0.15],
    ],
    progress: 0.18,
    spend: 0.97,
    startOffset: -5,
    durationDays: 40,
  },
  {
    customer: 'Denis',
    name: 'Ravalement de façade',
    status: 'in_progress',
    sale: 22_500,
    margin: 0.25,
    posts: [
      ['Échafaudage', 0.2],
      ['Nettoyage et réparations', 0.35],
      ['Peinture', 0.45],
    ],
    progress: 0.81,
    spend: 0.99,
    startOffset: -14,
    durationDays: 12,
    overdueInvoice: 12,
  },
  {
    customer: 'Immo Sambre',
    name: 'Rénovation de 4 appartements',
    status: 'preparation',
    sale: 520_000,
    margin: 0.19,
    posts: [
      ['Démolition', 0.08],
      ['Gros œuvre', 0.22],
      ['Électricité', 0.14],
      ['Plomberie et chauffage', 0.2],
      ['Menuiseries', 0.14],
      ['Finitions', 0.22],
    ],
    progress: 0,
    spend: 0,
    startOffset: 12,
    durationDays: 120,
    regime: 'reverse_charge',
    description:
      'Chantier ≥ 500 000 € : déclaration Check In and Out obligatoire (enregistrement des présences).',
  },
  {
    customer: 'Gilson',
    name: 'Mise en conformité électrique',
    status: 'preparation',
    sale: 6_500,
    margin: 0.3,
    posts: [
      ['Tableau', 0.45],
      ['Circuits', 0.55],
    ],
    progress: 0,
    spend: 0,
    startOffset: 6,
    durationDays: 4,
  },
  {
    customer: 'Leroy',
    name: 'Remplacement des châssis',
    status: 'preparation',
    sale: 14_200,
    margin: 0.24,
    posts: [
      ['Fourniture châssis', 0.7],
      ['Pose et finitions', 0.3],
    ],
    progress: 0,
    spend: 0,
    startOffset: 9,
    durationDays: 5,
  },
  {
    customer: 'Résidence Les Tilleuls',
    name: 'Isolation des combles communs',
    status: 'preparation',
    sale: 31_000,
    margin: 0.21,
    posts: [
      ['Isolation', 0.75],
      ['Pare-vapeur et finitions', 0.25],
    ],
    progress: 0,
    spend: 0,
    startOffset: 15,
    durationDays: 8,
    regime: 'standard_21',
  },
  {
    customer: 'Lemaire',
    name: 'Cuisine : électricité et carrelage',
    status: 'suspended',
    sale: 11_800,
    margin: 0.23,
    posts: [
      ['Électricité', 0.4],
      ['Carrelage', 0.6],
    ],
    progress: 0.4,
    spend: 1.02,
    startOffset: -12,
    durationDays: 10,
    suspendedReason: 'Attente de la livraison des meubles de cuisine (retard fournisseur).',
  },
  {
    customer: 'Commune de Ham-sur-Heure',
    name: 'Toiture de la salle communale',
    status: 'provisional_acceptance',
    sale: 89_000,
    margin: 0.2,
    posts: [
      ['Échafaudage', 0.1],
      ['Couverture', 0.65],
      ['Isolation', 0.25],
    ],
    progress: 1,
    spend: 1.03,
    startOffset: -45,
    durationDays: 35,
    regime: 'standard_21',
  },
  {
    customer: 'Henrard',
    name: 'Rénovation complète maison 1960',
    status: 'provisional_acceptance',
    sale: 125_000,
    margin: 0.21,
    posts: [
      ['Gros œuvre', 0.3],
      ['Techniques', 0.35],
      ['Finitions', 0.35],
    ],
    progress: 1,
    spend: 0.98,
    startOffset: -80,
    durationDays: 70,
  },
  {
    customer: 'Dumont',
    name: 'Tableau électrique et prises',
    status: 'final_acceptance',
    sale: 4_200,
    margin: 0.32,
    posts: [['Électricité', 1]],
    progress: 1,
    spend: 0.94,
    startOffset: -50,
    durationDays: 3,
  },
  {
    customer: 'Boulangerie Delcourt',
    name: 'Réaménagement du fournil',
    status: 'final_acceptance',
    sale: 38_000,
    margin: 0.22,
    posts: [
      ['Plomberie', 0.4],
      ['Carrelage', 0.6],
    ],
    progress: 1,
    spend: 1.01,
    startOffset: -120,
    durationDays: 20,
    regime: 'reverse_charge',
  },
  ...[
    ['Lambert', 'Salle de douche', 14_500, 0.25],
    ['Dubois', 'Peinture intérieure', 6_800, 0.3],
    ['Martin', 'Remplacement de la chaudière', 9_200, 0.22],
    ['Renard', 'Terrasse en pierre bleue', 18_400, 0.24],
    ['Wauters', 'Rénovation de la salle de bain', 21_000, 0.23],
    ['Collard', 'Isolation de la toiture', 16_900, 0.2],
    ['Fontaine', 'Carrelage du rez-de-chaussée', 12_300, 0.26],
    ['Hubert', 'Mise aux normes électriques', 5_400, 0.31],
    ['Garage Moderne Fleurus', 'Sol industriel de l’atelier', 42_000, 0.18],
    ['Cabinet Médical du Centre', 'Sanitaires PMR', 15_600, 0.24],
    ['Mathieu', 'Velux et finitions', 7_300, 0.27],
    ['Delvaux', 'Cuisine complète', 26_500, 0.21],
  ].map(([customer, name, sale, margin], i): OtherSpec => ({
    customer: customer as string,
    name: name as string,
    status: 'closed',
    sale: sale as number,
    margin: margin as number,
    posts: [
      ['Préparation', 0.15],
      ['Travaux', 0.7],
      ['Finitions', 0.15],
    ],
    progress: 1,
    spend: [0.96, 1.04, 0.99, 1.08, 0.93, 1.01][i % 6]!,
    startOffset: -200 + i * 12,
    durationDays: 15 + (i % 4) * 5,
    regime: ['Garage Moderne Fleurus', 'Cabinet Médical du Centre'].includes(customer as string)
      ? 'reverse_charge'
      : 'reduced_6',
  })),
];

export async function seedProjects(tx: Tx, tenantId: string, users: Map<string, string>): Promise<void> {
  if ((await tx.project.count({ where: { tenantId } })) > 0) return;
  const sophie = users.get('sophie@renov-habitat.be') ?? null;
  const karim = users.get('karim@renov-habitat.be') ?? null;
  const ctx = { tenantId, userId: sophie };
  const today = brusselsDate(new Date());
  const karimTeam = await tx.team.findFirst({ where: { tenantId, name: 'Équipe Karim' } });
  const toitTeam = await tx.team.findFirst({ where: { tenantId, name: 'Équipe Toiture' } });

  // Factures des chantiers terminés d'abord, pour que celle de Dupont porte le n° 2026-118 :
  // la numérotation reprend celle de l'ancien logiciel (dernier numéro émis : 2026-099).
  const year = new Date().getFullYear();
  await tx.numberSequence.upsert({
    where: { tenantId_docType_year: { tenantId, docType: 'invoice', year } },
    update: { lastValue: 99 },
    create: { tenantId, docType: 'invoice', year, lastValue: 99 },
  });

  for (const o of OTHERS)
    await seedOther(tx, ctx, o, today, {
      karim,
      karimTeam: karimTeam?.id ?? null,
      toitTeam: toitTeam?.id ?? null,
    });
  // Complète la séquence jusqu'à 2026-117 (factures sans chantier de l'ancien logiciel).
  await tx.numberSequence.update({
    where: { tenantId_docType_year: { tenantId, docType: 'invoice', year } },
    data: { lastValue: 117 },
  });
  await seedDupont(tx, ctx, today, { karim, teamId: karimTeam?.id ?? null });
}

async function seedOther(
  tx: Tx,
  ctx: { tenantId: string; userId: string | null },
  o: OtherSpec,
  today: IsoDate,
  people: { karim: string | null; karimTeam: string | null; toitTeam: string | null },
) {
  const customer = await tx.customer.findFirst({
    where: {
      tenantId: ctx.tenantId,
      OR: [{ lastName: o.customer }, { displayName: { startsWith: o.customer } }],
    },
  });
  if (!customer) return;
  const site =
    (await tx.site.findFirst({ where: { customerId: customer.id } })) ??
    (await tx.site.create({
      data: {
        tenantId: ctx.tenantId,
        customerId: customer.id,
        street: customer.street ?? 'Rue de la Station 1',
        postalCode: customer.postalCode ?? '6000',
        city: customer.city ?? 'Charleroi',
      },
    }));
  if (customer.status !== 'customer')
    await tx.customer.update({ where: { id: customer.id }, data: { status: 'customer' } });
  const start = workingDaysFrom(today, o.startOffset);
  const end = workingDaysFrom(start, o.durationDays - 1);
  const number = await nextNumber(tx, ctx.tenantId, 'project', 'CH{YYYY}-{SEQ:3}');
  const sale = euros(o.sale);
  const roofing = /toit|couverture/i.test(o.name);
  const project = await tx.project.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      name: o.name,
      description: o.description ?? null,
      customerId: customer.id,
      siteId: site.id,
      status: o.status,
      suspendedReason: o.suspendedReason ?? null,
      contractAmount: sale,
      managerUserId: people.karim,
      teamId: roofing ? people.toitTeam : people.karimTeam,
      startDate: new Date(`${start}T00:00:00Z`),
      endDate: new Date(`${end}T00:00:00Z`),
      createdBy: ctx.userId,
      createdAt: at(workingDaysFrom(start, -10)),
    },
  });
  const shares = o.posts.map(([, s]) => s);
  let allocated = 0n;
  for (const [i, [label]] of o.posts.entries()) {
    const postSale = i === o.posts.length - 1 ? sale - allocated : multiplyCents(sale, shares[i]!);
    allocated += postSale;
    // Marges légèrement différentes par poste, moyenne ≈ marge du chantier.
    const postMargin = o.margin + (i % 2 === 0 ? 0.02 : -0.02) * (o.posts.length > 1 ? 1 : 0);
    const budgeted = multiplyCents(postSale, 1 - postMargin);
    const bl = await tx.budgetLine.create({
      data: {
        tenantId: ctx.tenantId,
        projectId: project.id,
        position: i,
        label,
        saleAmount: postSale,
        budgetedCost: budgeted,
      },
    });
    const progress = o.progress;
    await tx.task.create({
      data: {
        tenantId: ctx.tenantId,
        projectId: project.id,
        budgetLineId: bl.id,
        position: i,
        title: label,
        amount: postSale,
        status: progress >= 1 ? 'done' : progress > 0 ? 'in_progress' : 'todo',
        progress: String(progress),
        completedAt: progress >= 1 ? at(end, '16:00') : null,
      },
    });
    const consumption = o.drift && o.drift[0] === i ? o.drift[1] : o.progress * o.spend;
    const engaged = multiplyCents(budgeted, consumption);
    if (engaged > 0n) {
      const material = multiplyCents(engaged, 0.55);
      await cost(tx, ctx.tenantId, project.id, bl.id, {
        category: 'supplier_invoice',
        label: `Fournitures — ${label}`,
        amount: material,
        at: at(workingDaysFrom(start, 1)),
      });
      await cost(tx, ctx.tenantId, project.id, bl.id, {
        category: 'labour',
        label: `Main-d’œuvre — ${label}`,
        amount: engaged - material,
        at: at(workingDaysFrom(start, 2)),
      });
    }
  }
  await timeline(tx, ctx.tenantId, project.id, customer.id, {
    type: 'project.created',
    title: 'Chantier créé',
    body: `Contrat ${number} repris à la signature`,
    at: project.createdAt,
    client: true,
  });
  if (o.status !== 'preparation')
    await timeline(tx, ctx.tenantId, project.id, customer.id, {
      type: 'project.status_changed',
      title: 'Travaux démarrés',
      at: at(start, '08:00'),
      client: true,
    });
  if (o.status === 'suspended')
    await timeline(tx, ctx.tenantId, project.id, customer.id, {
      type: 'project.status_changed',
      title: 'Chantier suspendu',
      body: o.suspendedReason,
      at: at(workingDaysFrom(today, -2), '11:00'),
      client: true,
    });
  const regime = o.regime ?? 'reduced_6';
  if (['provisional_acceptance', 'final_acceptance', 'closed'].includes(o.status)) {
    await issueInvoice(tx, ctx.tenantId, {
      projectId: project.id,
      customerId: customer.id,
      type: 'final',
      status: o.status === 'provisional_acceptance' ? 'sent' : 'paid',
      title: `Facture finale — ${o.name}`,
      net: sale,
      vatRegime: regime,
      issuedAt: end,
      dueDate: addDays(end, 30),
    });
  }
  if (o.overdueInvoice) {
    const issued = addDays(today, -(30 + o.overdueInvoice));
    await issueInvoice(tx, ctx.tenantId, {
      projectId: project.id,
      customerId: customer.id,
      type: 'progress',
      status: 'sent',
      title: `État d’avancement n°1 — ${o.name}`,
      net: multiplyCents(sale, 0.5),
      vatRegime: regime,
      issuedAt: issued,
      dueDate: addDays(issued, 30),
    });
  }
}

// ---------------------------------------------------------------------------
// Chantier Dupont (maquettes cockpit et portail)
// ---------------------------------------------------------------------------

const DUPONT_POSTS: PostSpec[] = [
  {
    title: 'Démolition',
    progress: 1,
    lines: [
      { d: 'Protection des lieux et bâchage', qty: 1, unit: 'forfait', price: 450, cost: 360, hours: 3 },
      {
        d: 'Démolition des revêtements muraux et du sol',
        qty: 24.5,
        unit: 'm²',
        price: 90,
        cost: 72,
        hours: 0.6,
      },
      { d: 'Évacuation des gravats (conteneur 8 m³)', qty: 1, unit: 'forfait', price: 945, cost: 756 },
    ],
  },
  {
    title: 'Plomberie',
    progress: 0.8,
    lines: [
      {
        d: 'Alimentations et évacuations neuves',
        qty: 1,
        unit: 'forfait',
        price: 4816,
        cost: 3769,
        hours: 22,
      },
      { d: 'WC suspendu complet', qty: 1, unit: 'u', price: 1650, cost: 1290, hours: 5 },
      { d: 'Meuble lavabo double vasque', qty: 1, unit: 'u', price: 2450, cost: 1920, hours: 4 },
      { d: 'Douche à l’italienne complète', qty: 1, unit: 'u', price: 6900, cost: 5400, hours: 16 },
      { d: 'Baignoire îlot', qty: 1, unit: 'u', price: 4500, cost: 3520, hours: 6 },
    ],
  },
  {
    title: 'Carrelage',
    progress: 0.45,
    lines: [
      { d: 'Carrelage sol grès cérame 60×60 (fourniture)', qty: 8.5, unit: 'm²', price: 80, cost: 58 },
      { d: 'Faïence murale 30×60 (fourniture)', qty: 16, unit: 'm²', price: 63.75, cost: 48 },
    ],
  },
  {
    title: 'Électricité',
    progress: 0.3,
    lines: [
      {
        d: 'Mise en conformité du circuit salle de bain',
        qty: 1,
        unit: 'forfait',
        price: 2300,
        cost: 1610,
        hours: 10,
      },
      { d: 'Spots LED étanches IP65', qty: 8, unit: 'u', price: 125, cost: 87.5, hours: 0.5 },
      { d: 'Sèche-serviettes électrique', qty: 1, unit: 'u', price: 1600, cost: 1120, hours: 2 },
    ],
  },
  {
    title: 'Finitions',
    progress: 0,
    lines: [
      { d: 'Plafond hydrofuge et peinture', qty: 9.5, unit: 'm²', price: 128, cost: 86, hours: 0.8 },
      { d: 'Joints, silicones et finitions', qty: 1, unit: 'forfait', price: 1268, cost: 867, hours: 8 },
      { d: 'Miroir éclairant et accessoires', qty: 1, unit: 'forfait', price: 2000, cost: 1380, hours: 2 },
    ],
  },
];

async function seedDupont(
  tx: Tx,
  ctx: { tenantId: string; userId: string | null },
  today: IsoDate,
  people: { karim: string | null; teamId: string | null },
) {
  const customer = await tx.customer.findFirst({ where: { tenantId: ctx.tenantId, lastName: 'Dupont' } });
  if (!customer) return;
  const site = await tx.site.findFirst({ where: { customerId: customer.id } });
  const opp = await tx.opportunity.findFirst({
    where: { tenantId: ctx.tenantId, customerId: customer.id, title: 'Rénovation salle de bain' },
  });
  // Les événements « du jour » de la maquette (8 h 02 → 13 h 30) : avant 13 h 35, ils sont datés de la
  // veille ouvrable pour ne jamais apparaître dans le futur.
  const story = new Date() >= at(today, '13:35') ? today : workingDaysFrom(today, -1);
  const start = workingDaysFrom(today, -8); // aujourd'hui = jour 9
  const end = workingDaysFrom(today, 5); // sur 15 après l'avenant n°2 (+1 jour)
  const signedDay = workingDaysFrom(start, -12);
  const q = await signedQuote(tx, ctx, {
    customerId: customer.id,
    siteId: site?.id ?? null,
    opportunityId: opp?.id ?? null,
    title: 'Rénovation salle de bain Dupont',
    posts: DUPONT_POSTS,
    sentAt: at(workingDaysFrom(signedDay, -4), '17:20'),
    signedAt: at(signedDay, '20:15'),
    signer: 'Jean Dupont',
  });
  const certSig = await tx.signature.create({
    data: {
      tenantId: ctx.tenantId,
      subjectType: 'vat_certificate',
      subjectId: q.quote.id,
      signerName: 'Jean Dupont',
      acceptedTerms: true,
      ip: '203.0.113.42',
      userAgent: 'Seed de démonstration',
      documentSha256: '0'.repeat(64),
      signedAt: at(signedDay, '20:15'),
    },
  });
  const { project, posts } = await projectFromQuote(tx, ctx, {
    quoteId: q.quote.id,
    customerId: customer.id,
    siteId: site?.id ?? null,
    opportunityId: opp?.id ?? null,
    name: 'Rénovation salle de bain Dupont',
    status: 'in_progress',
    startDate: start,
    endDate: end,
    managerUserId: people.karim,
    teamId: people.teamId,
    posts: DUPONT_POSTS,
    sections: q.loaded.content.sections,
    totals: q.totals,
    createdAt: at(signedDay, '20:16'),
  });
  await tx.vatCertificate.create({
    data: {
      tenantId: ctx.tenantId,
      quoteId: q.quote.id,
      customerId: customer.id,
      siteId: site?.id ?? null,
      projectId: project.id,
      status: 'signed',
      firstOccupancyYear: site?.firstOccupancyYear ?? 1975,
      declarations: { textVersion: '2026-1', privateDwelling: true, overTenYears: true, finalConsumer: true },
      signatureId: certSig.id,
      signedAt: at(signedDay, '20:15'),
    },
  });
  if (opp)
    await tx.opportunity.update({
      where: { id: opp.id },
      data: { stage: 'won', wonAt: at(signedDay, '20:15') },
    });
  await tx.customer.update({ where: { id: customer.id }, data: { status: 'customer' } });
  const [demolition, plomberie, carrelage, electricite, finitions] = posts.map((p) => p.id) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const email = customer.email ?? 'jean.dupont@example.be';

  // Avenant n°1 (signé il y a 6 jours ouvrables), n°2 (signé aujourd'hui), n°3 (en attente).
  const co1 = await changeOrder(tx, ctx, project, {
    ordinal: 1,
    title: 'Colonne de douche thermostatique encastrée',
    description: 'Remplacement de la colonne prévue par un mitigeur thermostatique encastré à deux sorties.',
    status: 'signed',
    delayDays: 0,
    sentAt: at(workingDaysFrom(story, -7), '10:10'),
    signedAt: at(workingDaysFrom(story, -6), '19:40'),
    signer: 'Jean Dupont',
    email,
    lines: [
      {
        d: 'Mitigeur thermostatique encastré 2 sorties',
        qty: 1,
        unit: 'u',
        price: 2150,
        cost: 1700,
        hours: 4,
        postId: plomberie,
        progress: 0.8,
      },
    ],
  });
  const co2 = await changeOrder(tx, ctx, project, {
    ordinal: 2,
    title: 'Ajout d’une niche murale',
    description: 'Niche murale carrelée dans la douche, avec éclairage LED.',
    status: 'signed',
    delayDays: 1,
    sentAt: at(workingDaysFrom(story, -1), '15:05'),
    signedAt: at(story, '13:30'),
    signer: 'Jean Dupont',
    email,
    lines: [
      {
        d: 'Niche murale carrelée 60×30 avec LED',
        qty: 1,
        unit: 'u',
        price: 1250,
        cost: 950,
        hours: 6,
        postId: finitions,
        progress: 0,
      },
    ],
  });
  // L'avenant n°2 décale la fin d'un jour ouvrable (comme le consommateur).
  await tx.project.update({
    where: { id: project.id },
    data: { endDate: new Date(`${workingDaysFrom(end, 1)}T00:00:00Z`) },
  });
  const co3 = await changeOrder(tx, ctx, project, {
    ordinal: 3,
    title: 'Remplacement du receveur de douche',
    description: 'Receveur extra-plat en résine 90×140 à la place du receveur prévu.',
    status: 'sent',
    delayDays: 0,
    sentAt: at(workingDaysFrom(story, -1), '16:30'),
    email,
    lines: [
      {
        d: 'Receveur extra-plat résine 90×140',
        qty: 1,
        unit: 'u',
        price: 380,
        cost: 290,
        postId: plomberie,
        progress: 0,
      },
    ],
  });

  // Engagé : factures fournisseurs (Peppol au M7) et main-d'œuvre (pointages au M5).
  const c = (
    budgetLineId: string,
    category: 'supplier_invoice' | 'labour' | 'other',
    label: string,
    amount: number,
    day: IsoDate,
  ) =>
    cost(tx, ctx.tenantId, project.id, budgetLineId, {
      category,
      label,
      amount: euros(amount),
      at: at(day, '12:00'),
    });
  await c(
    demolition,
    'labour',
    'Main-d’œuvre démolition (3 ouvriers, 2 jours)',
    1900,
    workingDaysFrom(start, 1),
  );
  await c(demolition, 'other', 'Location conteneur 8 m³', 950, workingDaysFrom(start, 1));
  await c(plomberie, 'supplier_invoice', 'Facture Sanitherm — sanitaires', 9200, workingDaysFrom(start, 3));
  await c(plomberie, 'labour', 'Main-d’œuvre plomberie', 4600, workingDaysFrom(story, -1));
  await c(
    carrelage,
    'supplier_invoice',
    'Facture Brico Pro — faïence murale',
    573,
    workingDaysFrom(start, 4),
  );
  await c(carrelage, 'supplier_invoice', 'Facture Brico Pro — BC-0417', 840, story);
  await c(
    electricite,
    'supplier_invoice',
    'Facture Élec Distribution — matériel électrique',
    980,
    workingDaysFrom(story, -2),
  );

  // Facture 2026-118 : état d'avancement à 40 %, échue depuis 3 jours.
  const issued = addDays(today, -33);
  const invoiceNumber = await issueInvoice(tx, ctx.tenantId, {
    projectId: project.id,
    customerId: customer.id,
    type: 'progress',
    status: 'sent',
    title: 'État d’avancement n°3 — 40 %',
    net: euros(15_360),
    vatRegime: 'reduced_6',
    issuedAt: issued,
    dueDate: addDays(issued, 30),
  });

  // Alerte de dérive déjà levée (l'outbox publié évite une seconde alerte au prochain coût).
  await tx.outboxEvent.create({
    data: {
      tenantId: ctx.tenantId,
      type: 'budget.drift_detected.v1',
      aggregateType: 'project',
      aggregateId: project.id,
      payload: {
        projectId: project.id,
        budgetLineId: carrelage,
        committed: '141300',
        budgetedCost: '126100',
      },
      actor: { type: 'system', label: 'Batimint' },
      publishedAt: new Date(),
    },
  });

  const tl = (e: Parameters<typeof timeline>[4]) => timeline(tx, ctx.tenantId, project.id, customer.id, e);
  await tl({
    type: 'project.created',
    title: 'Chantier créé à la signature du devis',
    body: `${q.quote.number} — ${formatEuros(q.totals.document.totalNet)} HTVA`,
    at: at(signedDay, '20:16'),
    client: true,
  });
  await tl({
    type: 'project.status_changed',
    title: 'Travaux démarrés',
    at: at(start, '07:45'),
    client: true,
    actor: 'Karim Benali',
  });
  await tl({
    type: 'task.completed',
    title: 'Tâche terminée : Démolition des revêtements muraux et du sol',
    body: 'Démolition · par Karim Benali',
    at: at(workingDaysFrom(start, 1), '16:10'),
    actor: 'Karim Benali',
  });
  await tl({
    type: 'change_order.signed',
    title: 'Avenant n°1 signé par Jean Dupont',
    body: 'Colonne de douche thermostatique encastrée · budget mis à jour',
    at: at(workingDaysFrom(story, -6), '19:40'),
    amount: co1.totals.document.totalNet,
    client: true,
    actor: 'Jean Dupont',
    changeOrderId: co1.row.id,
  });
  await tl({
    type: 'invoice.issued',
    title: `Facture ${invoiceNumber} envoyée`,
    body: 'État d’avancement n°3 approuvé (40 %)',
    at: at(issued, '16:48'),
    amount: euros(15_360),
    client: true,
  });
  await tl({
    type: 'budget.drift_detected',
    title: 'Le poste Carrelage dépasse son budget de 12 %',
    body: 'Prévoir un avenant ?',
    at: at(story, '09:41'),
    data: { budgetLineId: carrelage },
  });
  await tl({
    type: 'change_order.sent',
    title: 'Avenant n°3 envoyé au client',
    body: `Remplacement du receveur de douche · ${email}`,
    at: at(workingDaysFrom(story, -1), '16:30'),
    amount: co3.totals.document.totalNet,
    changeOrderId: co3.row.id,
  });
  await tl({
    type: 'team.arrived',
    title: 'Équipe de Karim arrivée sur chantier',
    body: '3 ouvriers pointés · client prévenu automatiquement',
    at: at(story, '08:02'),
    client: true,
    actor: 'Karim Benali',
  });
  await tl({
    type: 'supplier_invoice.allocated',
    title: 'Facture Brico Pro reçue via Peppol',
    body: 'Rapprochée du bon de commande BC-0417 · imputée au poste Carrelage, sans saisie',
    at: at(story, '09:40'),
    amount: -euros(840),
  });
  await tl({
    type: 'photo.added',
    title: 'Karim a ajouté 4 photos',
    body: 'Pose faïence murale · visibles par le client',
    at: at(story, '11:15'),
    client: true,
    actor: 'Karim Benali',
    data: { photoIds: [] },
  });
  await tl({
    type: 'change_order.signed',
    title: 'Avenant n°2 signé par Jean Dupont',
    body: 'Ajout d’une niche murale · budget et planning mis à jour',
    at: at(story, '13:30'),
    amount: co2.totals.document.totalNet,
    client: true,
    actor: 'Jean Dupont',
    changeOrderId: co2.row.id,
  });

  // Question du client sur l'avenant n°3, encore sans réponse.
  await tx.comment.create({
    data: {
      tenantId: ctx.tenantId,
      subjectType: 'change_order',
      subjectId: co3.row.id,
      projectId: project.id,
      body: 'Le receveur extra-plat se nettoie-t-il aussi facilement que le carrelage ?',
      authorPortalToken: randomUUID(),
      authorLabel: 'Jean Dupont',
      visibleToClient: true,
      createdAt: at(story, '07:12'),
    },
  });
  await tx.comment.create({
    data: {
      tenantId: ctx.tenantId,
      subjectType: 'project',
      subjectId: project.id,
      projectId: project.id,
      body: 'Faïence posée sur le mur de la douche, joints demain matin.',
      authorUserId: people.karim,
      authorLabel: 'Karim Benali',
      createdAt: at(story, '11:20'),
    },
  });
}
