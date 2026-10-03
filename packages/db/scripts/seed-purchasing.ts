/**
 * Seed des achats (M7, 02 P6) : fournisseurs, bons de commande, factures fournisseurs reçues par
 * Peppol et leur imputation. Les coûts « factures fournisseurs » posés par seed-projects deviennent de
 * vraies factures rapprochées (mêmes montants : les marges des chantiers ne bougent pas), quelques
 * bons restent ouverts (engagement) et deux factures attendent dans la boîte « À imputer ».
 */
import { addDays, compareWithOrder, formatDocumentNumber, type IsoDate, lineTotal } from '@batimint/domain';
import { randomUUID } from 'node:crypto';
import type { Tx } from '../src/client';
import { nextSequenceValue } from '../src/sequences';

const PATTERN = 'BC{YYYY}-{SEQ:3}';
const FINISHED = new Set(['provisional_acceptance', 'final_acceptance', 'closed']);

/** Fournisseurs fictifs (numéros BCE valides, domaines .example). */
const SUPPLIERS = {
  brico: {
    name: 'Brico Pro SA',
    enterpriseNumber: '0417497106',
    street: 'Chaussée de Bruxelles 210',
    postalCode: '6040',
    city: 'Jumet',
    orderEmail: 'commandes@bricopro.example',
    prefix: 'BP',
  },
  sanitherm: {
    name: 'Sanitherm Hainaut SA',
    enterpriseNumber: '0403012036',
    street: 'Rue de la Science 15',
    postalCode: '6041',
    city: 'Gosselies',
    orderEmail: 'commandes@sanitherm.example',
    prefix: 'SH',
  },
  elec: {
    name: 'Élec Distribution SRL',
    enterpriseNumber: '0444098761',
    street: 'Avenue de l’Industrie 4',
    postalCode: '6060',
    city: 'Gilly',
    orderEmail: 'cde@elec-distribution.example',
    prefix: 'ED',
  },
  gilson: {
    name: 'Matériaux Gilson SA',
    enterpriseNumber: '0457884342',
    street: 'Rue du Canal 51',
    postalCode: '6030',
    city: 'Marchienne-au-Pont',
    orderEmail: 'commandes@gilson-materiaux.example',
    prefix: 'MG',
  },
} as const;
type SupplierKey = keyof typeof SUPPLIERS;

/** Deux articles typiques par fournisseur pour des lignes de facture réalistes. */
const TYPICAL: Record<SupplierKey, [string, string, string][]> = {
  brico: [
    ['Carrelage grès cérame 60×60', 'm²', 'CR-6060'],
    ['Colle carrelage C2TE 25 kg', 'sac', 'CO-C2TE'],
  ],
  sanitherm: [
    ['Tube multicouche 20 mm (rouleau 50 m)', 'rl', 'MC-20'],
    ['Raccords à sertir 20 mm', 'pc', 'RS-20'],
  ],
  elec: [
    ['Câble XVB 3G2,5 (100 m)', 'rl', 'XVB-325'],
    ['Disjoncteur 16 A courbe C', 'pc', 'DJ-16C'],
  ],
  gilson: [
    ['Bloc béton 39×19×14', 'pc', 'BB-14'],
    ['Ciment Portland CEM II 25 kg', 'sac', 'CE-25'],
  ],
};

interface Line {
  description: string;
  supplierCode: string | null;
  unit: string;
  quantity: string;
  unitPrice: bigint;
}

const euros = (n: number) => BigInt(n) * 100n;
const day = (d: Date) => d.toISOString().slice(0, 10) as IsoDate;
const date = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
const vatOf = (net: bigint) => (net * 21n + 50n) / 100n;

function supplierFor(postLabel: string): SupplierKey {
  const l = postLabel.toLowerCase();
  if (/carrel|faïence|sol/.test(l)) return 'brico';
  if (/plomb|sanitaire|chauff|cuisine/.test(l)) return 'sanitherm';
  if (/électri|tableau|prises|éclairage/.test(l)) return 'elec';
  return 'gilson';
}

/** Deux lignes dont la somme vaut exactement le montant. */
function typicalLines(key: SupplierKey, amount: bigint): Line[] {
  const [[d1, u1, c1], [d2, u2, c2]] = TYPICAL[key] as [[string, string, string], [string, string, string]];
  const qty = 10n;
  const unitPrice = (amount * 6n) / 10n / qty;
  const first = unitPrice * qty;
  return [
    { description: d1, unit: u1, supplierCode: c1, quantity: qty.toString(), unitPrice },
    { description: d2, unit: u2, supplierCode: c2, quantity: '1', unitPrice: amount - first },
  ];
}

const DUPONT_LINES: Record<string, { key: SupplierKey; lines: Line[] }> = {
  '920000': {
    key: 'sanitherm',
    lines: [
      ['WC suspendu avec bâti-support', 'pc', 'WC-SUSP', '1', 1450],
      ['Meuble double vasque 120 cm', 'pc', 'MV-120', '1', 2650],
      ['Colonne de douche thermostatique', 'pc', 'CD-THERM', '1', 1180],
      ['Receveur extra-plat 160×90', 'pc', 'RC-16090', '1', 890],
      ['Paroi de douche verre 8 mm', 'pc', 'PD-8', '1', 1240],
      ['Robinetterie et raccords', 'lot', 'RB-LOT', '1', 1790],
    ].map(([description, unit, supplierCode, quantity, price]) => ({
      description: description as string,
      unit: unit as string,
      supplierCode: supplierCode as string,
      quantity: quantity as string,
      unitPrice: euros(price as number),
    })),
  },
  '57300': {
    key: 'brico',
    lines: [
      {
        description: 'Colle carrelage C2TE 25 kg',
        unit: 'sac',
        supplierCode: 'CO-C2TE',
        quantity: '12',
        unitPrice: 2475n,
      },
      {
        description: 'Croisillons et profilés de finition',
        unit: 'lot',
        supplierCode: 'PF-LOT',
        quantity: '1',
        unitPrice: euros(96),
      },
      {
        description: 'Joint époxy 2,5 kg',
        unit: 'pot',
        supplierCode: 'JE-25',
        quantity: '6',
        unitPrice: euros(30),
      },
    ],
  },
  '98000': {
    key: 'elec',
    lines: [
      {
        description: 'Spot LED encastré IP65',
        unit: 'pc',
        supplierCode: 'SP-IP65',
        quantity: '8',
        unitPrice: euros(42),
      },
      {
        description: 'Câble XVB 3G2,5 (50 m)',
        unit: 'rl',
        supplierCode: 'XVB-325-50',
        quantity: '1',
        unitPrice: euros(164),
      },
      {
        description: 'Différentiel 30 mA',
        unit: 'pc',
        supplierCode: 'DIF-30',
        quantity: '1',
        unitPrice: euros(118),
      },
      {
        description: 'Miroir lumineux 120 cm',
        unit: 'pc',
        supplierCode: 'MIR-120',
        quantity: '1',
        unitPrice: euros(362),
      },
    ],
  },
  '84000': {
    key: 'brico',
    lines: [
      {
        description: 'Faïence murale 30×60 blanc mat',
        unit: 'm²',
        supplierCode: 'FA-3060-BM',
        quantity: '14',
        unitPrice: euros(60),
      },
    ],
  },
};

export async function seedPurchasing(tx: Tx, tenantId: string, users: Map<string, string>, today: IsoDate) {
  if ((await tx.supplier.count({ where: { tenantId } })) > 0) return;
  const sophie = users.get('sophie@renov-habitat.be') ?? null;
  const year = new Date().getFullYear();

  const suppliers = {} as Record<
    SupplierKey,
    { id: string; name: string; email: string; prefix: string; vat: string }
  >;
  for (const [key, s] of Object.entries(SUPPLIERS) as [SupplierKey, (typeof SUPPLIERS)[SupplierKey]][]) {
    const row = await tx.supplier.create({
      data: {
        tenantId,
        name: s.name,
        enterpriseNumber: s.enterpriseNumber,
        vatNumber: `BE${s.enterpriseNumber}`,
        peppolId: `0208:${s.enterpriseNumber}`,
        orderEmail: s.orderEmail,
        email: s.orderEmail.replace(/^[^@]+/, 'compta'),
        street: s.street,
        postalCode: s.postalCode,
        city: s.city,
        paymentTermsDays: 30,
        createdBy: sophie,
      },
    });
    suppliers[key] = {
      id: row.id,
      name: s.name,
      email: s.orderEmail,
      prefix: s.prefix,
      vat: `BE${s.enterpriseNumber}`,
    };
  }

  // Fournisseur préféré des matériaux de la bibliothèque : la proposition de commande les regroupe.
  for (const item of await tx.item.findMany({ where: { tenantId, kind: 'material' } }))
    await tx.item.update({
      where: { id: item.id },
      data: { supplierId: suppliers[supplierFor(`${item.name} ${item.code}`)].id },
    });

  const projects = new Map(
    (
      await tx.project.findMany({
        where: { tenantId },
        include: { site: true, budgetLines: { orderBy: { position: 'asc' } } },
      })
    ).map((p) => [p.id, p]),
  );
  const dupont = [...projects.values()].find((p) => p.name === 'Rénovation salle de bain Dupont');
  const postLabel = (projectId: string, budgetLineId: string | null) =>
    projects.get(projectId)?.budgetLines.find((b) => b.id === budgetLineId)?.label ?? '';
  const addressOf = (projectId: string) => {
    const s = projects.get(projectId)?.site;
    return s ? `${s.street}, ${s.postalCode} ${s.city}` : null;
  };

  // La numérotation des BC reprend celle de l'ancien logiciel ; celui de Dupont est le BC…-417.
  await tx.numberSequence.upsert({
    where: { tenantId_docType_year: { tenantId, docType: 'purchase_order', year } },
    update: { lastValue: 380 },
    create: { tenantId, docType: 'purchase_order', year, lastValue: 380 },
  });
  const nextNumber = async () =>
    formatDocumentNumber(PATTERN, {
      year,
      sequence: await nextSequenceValue(tx, tenantId, 'purchase_order', year),
    });
  let invoiceSeq = 2_400;

  async function order(o: {
    projectId: string;
    supplier: SupplierKey;
    lines: (Line & { budgetLineId: string | null })[];
    sentOn: IsoDate;
    status: 'draft' | 'sent' | 'partially_received' | 'received';
    receivedRatio?: number;
  }) {
    const s = suppliers[o.supplier];
    const number = o.status === 'draft' ? null : await nextNumber();
    const total = o.lines.reduce((sum, l) => sum + lineTotal(l.quantity, l.unitPrice), 0n);
    const po = await tx.purchaseOrder.create({
      data: {
        id: randomUUID(),
        tenantId,
        projectId: o.projectId,
        supplierId: s.id,
        number,
        status: o.status,
        expectedOn: date(addDays(o.sentOn, 3)),
        deliveryAddress: addressOf(o.projectId),
        totalNet: total,
        sentAt: number ? new Date(`${o.sentOn}T09:30:00Z`) : null,
        sentTo: number ? s.email : null,
        createdBy: sophie,
        createdAt: new Date(`${o.sentOn}T09:00:00Z`),
        lines: {
          create: o.lines.map((l, position) => ({
            tenantId,
            position,
            description: l.description,
            supplierCode: l.supplierCode,
            unit: l.unit,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            budgetLineId: l.budgetLineId,
            receivedQuantity:
              o.status === 'received' ? l.quantity : o.status === 'partially_received' ? '1' : '0',
          })),
        },
      },
      include: { lines: true },
    });
    if (o.status === 'received' || o.status === 'partially_received')
      await tx.goodsReceipt.create({
        data: {
          tenantId,
          purchaseOrderId: po.id,
          receivedAt: new Date(`${addDays(o.sentOn, 3)}T08:15:00Z`),
          receivedBy: users.get('karim@renov-habitat.be') ?? null,
          lines: po.lines.map((l) => ({ lineId: l.id, quantity: l.receivedQuantity.toString() })),
        },
      });
    return { po, total };
  }

  /** Facture reçue par Peppol, rapprochée et imputée ; le coût existant pointe vers elle. */
  async function invoice(c: {
    costId: string | null;
    projectId: string;
    budgetLineId: string | null;
    supplier: SupplierKey;
    lines: Line[];
    on: IsoDate;
    status: 'allocated' | 'validated' | 'to_pay' | 'paid';
    method: 'purchase_order' | 'project_reference' | 'address';
    po: Awaited<ReturnType<typeof order>>['po'] | null;
  }) {
    const s = suppliers[c.supplier];
    const net = c.lines.reduce((sum, l) => sum + lineTotal(l.quantity, l.unitPrice), 0n);
    const id = randomUUID();
    const number = `${s.prefix}${year}-${invoiceSeq++}`;
    const at = new Date(`${c.on}T07:40:00Z`);
    const discrepancies = c.po
      ? compareWithOrder({
          lines: c.lines.map((l) => ({ ...l, net: lineTotal(l.quantity, l.unitPrice) })),
          orderLines: c.po.lines.map((l) => ({
            id: l.id,
            description: l.description,
            supplierCode: l.supplierCode,
            quantity: l.quantity.toString(),
            unitPrice: l.unitPrice,
            budgetLineId: l.budgetLineId,
          })),
          invoiceNet: net,
        })
      : [];
    const project = projects.get(c.projectId)!;
    await tx.supplierInvoice.create({
      data: {
        id,
        tenantId,
        source: 'peppol',
        externalId: `seed-${id}`,
        supplierId: s.id,
        supplierName: s.name,
        supplierVat: s.vat,
        number,
        issueDate: date(c.on),
        dueDate: date(addDays(c.on, 30)),
        totalNet: net,
        totalVat: vatOf(net),
        totalGross: net + vatOf(net),
        orderReference: c.po?.number ?? null,
        deliveryAddress: c.method === 'address' ? addressOf(c.projectId) : null,
        notes: c.method === 'project_reference' ? `Votre référence : ${project.number}` : null,
        status: c.status,
        matchMethod: c.method,
        matchConfidence:
          c.method === 'purchase_order' ? '0.99' : c.method === 'project_reference' ? '0.95' : '0.85',
        purchaseOrderId: c.po?.id ?? null,
        projectId: c.projectId,
        discrepancies: JSON.parse(
          JSON.stringify(discrepancies, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
        ),
        receivedAt: at,
        allocatedAt: at,
        validatedAt: c.status === 'allocated' ? null : new Date(at.getTime() + 86_400_000),
        validatedBy: c.status === 'allocated' ? null : sophie,
        // Payée à 25 jours, jamais dans le futur (chantiers terminés récemment).
        paidAt: c.status === 'paid' ? date([addDays(c.on, 25), addDays(today, -1)].sort()[0]!) : null,
        createdAt: at,
        lines: {
          create: c.lines.map((l, position) => ({
            tenantId,
            position,
            description: l.description,
            supplierCode: l.supplierCode,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            net: lineTotal(l.quantity, l.unitPrice),
            vatRate: '21',
          })),
        },
      },
    });
    const allocation = await tx.costAllocation.create({
      data: { tenantId, invoiceId: id, projectId: c.projectId, budgetLineId: c.budgetLineId, amount: net },
    });
    const label = `Facture ${s.name} ${number}`;
    if (c.costId)
      await tx.projectCost.update({
        where: { id: c.costId },
        data: { sourceType: 'supplier_invoice', sourceId: `${id}:${allocation.id}`, label, amount: net },
      });
    else
      await tx.projectCost.create({
        data: {
          tenantId,
          projectId: c.projectId,
          budgetLineId: c.budgetLineId,
          category: 'supplier_invoice',
          sourceType: 'supplier_invoice',
          sourceId: `${id}:${allocation.id}`,
          label,
          amount: net,
          occurredAt: at,
        },
      });
    return { id, number };
  }

  const statusFor = (projectId: string, on: IsoDate): 'allocated' | 'validated' | 'to_pay' | 'paid' => {
    if (FINISHED.has(projects.get(projectId)?.status ?? '')) return 'paid';
    const age = (date(today).getTime() - date(on).getTime()) / 86_400_000;
    return age > 35 ? 'paid' : age > 20 ? 'to_pay' : age > 7 ? 'validated' : 'allocated';
  };

  // 1. Les autres chantiers : la plupart par numéro de BC, quelques-unes par référence ou adresse.
  const costs = await tx.projectCost.findMany({
    where: { tenantId, category: 'supplier_invoice', sourceType: 'seed' },
    orderBy: { occurredAt: 'asc' },
  });
  // Les BC des autres chantiers précèdent ceux de Dupont (…-414 à 417).
  const viaOrder = costs.filter((x) => x.projectId !== dupont?.id).filter((_x, i) => i % 7 < 5).length;
  await tx.numberSequence.update({
    where: { tenantId_docType_year: { tenantId, docType: 'purchase_order', year } },
    data: { lastValue: 413 - viaOrder },
  });
  let k = 0;
  let discrepancyShown = false;
  for (const c of costs.filter((x) => x.projectId !== dupont?.id)) {
    const key = supplierFor(postLabel(c.projectId, c.budgetLineId));
    const on = day(c.occurredAt);
    const lines = typicalLines(key, c.amount);
    const method = k % 7 === 5 ? 'project_reference' : k % 7 === 6 ? 'address' : 'purchase_order';
    k++;
    let po = null;
    if (method === 'purchase_order') {
      // Un écart de prix visible : le fournisseur a facturé 6 % de plus que commandé.
      const withGap: boolean = !discrepancyShown && projects.get(c.projectId)?.status === 'in_progress';
      discrepancyShown ||= withGap;
      po = (
        await order({
          projectId: c.projectId,
          supplier: key,
          sentOn: addDays(on, -6),
          status: 'received',
          lines: lines.map((l, i) => ({
            ...l,
            unitPrice: withGap && i === 0 ? (l.unitPrice * 100n) / 106n : l.unitPrice,
            budgetLineId: c.budgetLineId,
          })),
        })
      ).po;
    }
    await invoice({
      costId: c.id,
      projectId: c.projectId,
      budgetLineId: c.budgetLineId,
      supplier: key,
      lines,
      on,
      status: statusFor(c.projectId, on),
      method,
      po,
    });
  }

  // 2. Dupont : BC…-414 à 417, celui du carrelage arrivé ce matin via Peppol.
  if (dupont) {
    await tx.numberSequence.update({
      where: { tenantId_docType_year: { tenantId, docType: 'purchase_order', year } },
      data: { lastValue: 413 },
    });
    const dupontCosts = costs
      .filter((x) => x.projectId === dupont.id)
      .sort((a, b) => {
        const order = ['920000', '57300', '98000', '84000'];
        return order.indexOf(a.amount.toString()) - order.indexOf(b.amount.toString());
      });
    for (const c of dupontCosts) {
      const spec = DUPONT_LINES[c.amount.toString()];
      if (!spec) continue;
      const on = day(c.occurredAt);
      const { po } = await order({
        projectId: dupont.id,
        supplier: spec.key,
        sentOn: addDays(on, -5),
        status: 'received',
        lines: spec.lines.map((l) => ({ ...l, budgetLineId: c.budgetLineId })),
      });
      const status =
        c.amount === 920_000n
          ? 'paid'
          : c.amount === 57_300n
            ? 'to_pay'
            : c.amount === 98_000n
              ? 'validated'
              : 'allocated';
      const inv = await invoice({
        costId: c.id,
        projectId: dupont.id,
        budgetLineId: c.budgetLineId,
        supplier: spec.key,
        lines: spec.lines,
        on,
        status,
        method: 'purchase_order',
        po,
      });
      if (c.amount === 84_000n)
        await tx.timelineEntry.updateMany({
          where: { tenantId, projectId: dupont.id, type: 'supplier_invoice.allocated' },
          data: {
            body: `Rapprochée du bon de commande ${po.number} · imputée au poste Carrelage, sans saisie`,
            data: { invoiceId: inv.id },
          },
        });
    }
  }

  // 3. Bons ouverts (engagement non facturé) sur les chantiers en cours, hors Dupont.
  const open = [...projects.values()]
    .filter((p) => p.id !== dupont?.id && (p.status === 'in_progress' || p.status === 'preparation'))
    .slice(0, 3);
  for (const [index, p] of open.entries()) {
    const post = p.budgetLines[Math.min(1, p.budgetLines.length - 1)] ?? null;
    const key = supplierFor(post?.label ?? '');
    const lines = typicalLines(key, euros(1_200 + index * 650)).map((l) => ({
      ...l,
      budgetLineId: post?.id ?? null,
    }));
    const { po, total } = await order({
      projectId: p.id,
      supplier: key,
      sentOn: addDays(today, -2 - index),
      status: index === 1 ? 'partially_received' : 'sent',
      lines,
    });
    await tx.projectCost.create({
      data: {
        tenantId,
        projectId: p.id,
        budgetLineId: post?.id ?? null,
        category: 'purchase_order',
        sourceType: 'purchase_order',
        sourceId: `${po.id}:${post?.id ?? 'none'}`,
        label: `BC ${po.number} — ${suppliers[key].name} (non facturé)`,
        amount: total,
        occurredAt: po.sentAt ?? new Date(),
      },
    });
  }
  if (open[0]) {
    const post = open[0].budgetLines[0] ?? null;
    await order({
      projectId: open[0].id,
      supplier: 'gilson',
      sentOn: today,
      status: 'draft',
      lines: typicalLines('gilson', euros(480)).map((l) => ({ ...l, budgetLineId: post?.id ?? null })),
    });
  }

  // 4. Boîte « À imputer » : deux factures sans référence exploitable, avec suggestions classées.
  const inProgress = [...projects.values()].filter((p) => p.status === 'in_progress');
  const carrelage = dupont?.budgetLines.find((b) => /carrel/i.test(b.label)) ?? null;
  const other = inProgress.find((p) => p.id !== dupont?.id) ?? null;
  const inbox: { supplier: SupplierKey; lines: Line[]; notes: string | null; suggestions: object[] }[] = [
    {
      supplier: 'brico',
      notes: 'Enlèvement au comptoir — Karim',
      lines: [
        {
          description: 'Silicone sanitaire blanc',
          unit: 'pc',
          supplierCode: 'SIL-BL',
          quantity: '6',
          unitPrice: 890n,
        },
        {
          description: 'Mastic acrylique',
          unit: 'pc',
          supplierCode: 'MA-AC',
          quantity: '4',
          unitPrice: 650n,
        },
      ],
      suggestions: [
        ...(dupont
          ? [
              {
                projectId: dupont.id,
                budgetLineId: carrelage?.id ?? null,
                score: 0.62,
                reason: 'Silicone et mastic : poste carrelage en cours, chef de chantier cité',
              },
            ]
          : []),
        ...(other
          ? [
              {
                projectId: other.id,
                budgetLineId: other.budgetLines[0]?.id ?? null,
                score: 0.31,
                reason: 'Chantier en cours de l’équipe de Karim',
              },
            ]
          : []),
      ],
    },
    {
      supplier: 'gilson',
      notes: null,
      lines: [
        {
          description: 'Sable stabilisé (big bag)',
          unit: 'pc',
          supplierCode: 'SA-BB',
          quantity: '2',
          unitPrice: euros(68),
        },
        {
          description: 'Location bétonnière 2 jours',
          unit: 'j',
          supplierCode: null,
          quantity: '2',
          unitPrice: euros(35),
        },
      ],
      suggestions: inProgress
        .filter((p) => p.id !== dupont?.id)
        .slice(0, 2)
        .map((p, i) => ({
          projectId: p.id,
          budgetLineId: p.budgetLines[0]?.id ?? null,
          score: i === 0 ? 0.48 : 0.36,
          reason:
            i === 0
              ? 'Gros œuvre en cours sur ce chantier'
              : 'Matériaux similaires commandés le mois dernier',
        })),
    },
  ];
  for (const [index, x] of inbox.entries()) {
    const s = suppliers[x.supplier];
    const net = x.lines.reduce((sum, l) => sum + lineTotal(l.quantity, l.unitPrice), 0n);
    const id = randomUUID();
    const at = new Date(Date.now() - (index + 1) * 3_600_000 * 5);
    await tx.supplierInvoice.create({
      data: {
        id,
        tenantId,
        source: 'peppol',
        externalId: `seed-${id}`,
        supplierId: s.id,
        supplierName: s.name,
        supplierVat: s.vat,
        number: `${s.prefix}${year}-${invoiceSeq++}`,
        issueDate: date(day(at)),
        dueDate: date(addDays(day(at), 30)),
        totalNet: net,
        totalVat: vatOf(net),
        totalGross: net + vatOf(net),
        notes: x.notes,
        status: 'to_allocate',
        suggestions: x.suggestions,
        receivedAt: at,
        createdAt: at,
        lines: {
          create: x.lines.map((l, position) => ({
            tenantId,
            position,
            description: l.description,
            supplierCode: l.supplierCode,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            net: lineTotal(l.quantity, l.unitPrice),
            vatRate: '21',
          })),
        },
      },
    });
  }
}
