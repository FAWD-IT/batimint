/**
 * Seed M3 : devis composés depuis la bibliothèque type. Le devis de M. Dupont (salle de bain,
 * TVA 6 %, option douche à l'italienne) est en préparation ; d'autres sont envoyés ou vus.
 */
import {
  computeQuote,
  computeSalePrice,
  DEFAULT_NUMBER_PATTERNS,
  determineVatRegime,
  dwellingAge,
  formatDocumentNumber,
  type VatRegime,
} from '@batimint/domain';
import type { Tx } from '../src/client';
import { loadVersionContent, replaceVersionContent } from '../src/quotes';
import { nextSequenceValue } from '../src/sequences';
import { randomUUID } from 'node:crypto';

type Spec = {
  title: string;
  optional?: boolean;
  selected?: boolean;
  lines: [code: string, quantity: string][];
};

async function createQuote(
  tx: Tx,
  ctx: {
    tenantId: string;
    userId: string | null;
    pattern: string;
    coefs: { overheadCoefficient: string; marginCoefficient: string };
  },
  q: {
    opportunityTitle: string;
    title: string;
    sections: Spec[];
    intro?: string;
    status: 'draft' | 'sent' | 'viewed';
    sentDaysAgo?: number;
  },
): Promise<void> {
  const opp = await tx.opportunity.findFirst({
    where: { tenantId: ctx.tenantId, title: q.opportunityTitle },
    include: { customer: true, site: true },
  });
  if (!opp) return;
  const age = dwellingAge(opp.site?.firstOccupancyYear);
  const suggestion = determineVatRegime({
    customerKind: opp.customer.kind,
    customerFilesPeriodicVatReturns: opp.customer.vatLiable,
    isImmovableWork: true,
    isPrivateDwelling: opp.site?.isPrivateDwelling ?? opp.customer.kind === 'individual',
    ...(age !== undefined ? { dwellingAgeYears: age } : {}),
  });
  const year = new Date().getFullYear();
  const number = formatDocumentNumber(ctx.pattern, {
    year,
    sequence: await nextSequenceValue(tx, ctx.tenantId, 'quote', year),
  });
  const now = Date.now();
  const sentAt = q.status === 'draft' ? null : new Date(now - (q.sentDaysAgo ?? 3) * 86_400_000);
  const quote = await tx.quote.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      title: q.title,
      customerId: opp.customerId,
      siteId: opp.siteId,
      opportunityId: opp.id,
      status: q.status,
      ownerUserId: ctx.userId,
      createdBy: ctx.userId,
      sentAt,
      viewedAt: q.status === 'viewed' && sentAt ? new Date(sentAt.getTime() + 20 * 3_600_000) : null,
      validUntil: sentAt ? new Date(sentAt.getTime() + 30 * 86_400_000) : null,
    },
  });
  const version = await tx.quoteVersion.create({
    data: {
      tenantId: ctx.tenantId,
      quoteId: quote.id,
      version: 1,
      status: q.status,
      intro: q.intro ?? null,
      depositKind: 'percent',
      depositValue: '30',
      vatContext: { regime: suggestion.regime, reason: suggestion.reason },
      sentAt,
      createdBy: ctx.userId,
    },
  });
  await tx.quote.update({ where: { id: quote.id }, data: { currentVersionId: version.id } });
  const codes = q.sections.flatMap((s) => s.lines.map(([c]) => c));
  const items = await tx.item.findMany({ where: { tenantId: ctx.tenantId, code: { in: codes } } });
  const byCode = new Map(items.map((i) => [i.code, i]));
  await replaceVersionContent(tx, ctx.tenantId, version.id, {
    sections: q.sections.map((s) => ({
      key: randomUUID(),
      title: s.title,
      optional: Boolean(s.optional),
      selected: Boolean(s.selected),
      lines: s.lines
        .filter(([code]) => byCode.has(code))
        .map(([code, quantity]) => {
          const i = byCode.get(code)!;
          const regime = (i.vatRate !== 'auto' ? i.vatRate : suggestion.regime) as VatRegime;
          return {
            key: randomUUID(),
            kind: 'item',
            itemId: i.id,
            code: i.code,
            description: i.name,
            unit: i.unit,
            quantity,
            unitPrice: computeSalePrice({
              cost: i.purchasePrice,
              salePrice: i.salePrice,
              itemCoefficient: i.saleCoefficient?.toString() ?? null,
              ...ctx.coefs,
            }),
            unitCost: i.purchasePrice,
            laborHours: i.laborHours.toString(),
            vatRegime: regime,
            vatSuggested: regime,
            discountPercent: '0',
          };
        }),
    })),
  });
  const loaded = (await loadVersionContent(tx, version.id))!;
  const t = computeQuote(loaded.content);
  await tx.quoteVersion.update({
    where: { id: version.id },
    data: {
      totalNet: t.document.totalNet,
      totalVat: t.document.totalVat,
      totalGross: t.document.totalGross,
      totalCost: t.totalCost,
      depositAmount: t.depositAmount,
    },
  });
  if (sentAt) {
    await tx.timelineEntry.create({
      data: {
        tenantId: ctx.tenantId,
        type: 'quote.sent',
        title: 'Devis envoyé',
        body: `${number} — ${q.title}`,
        customerId: opp.customerId,
        opportunityId: opp.id,
        quoteId: quote.id,
        occurredAt: sentAt,
      },
    });
    if (q.status === 'viewed')
      await tx.timelineEntry.create({
        data: {
          tenantId: ctx.tenantId,
          type: 'quote.viewed',
          title: `Vu par ${opp.customer.displayName}`,
          body: `${number} — ${q.title}`,
          customerId: opp.customerId,
          opportunityId: opp.id,
          quoteId: quote.id,
          occurredAt: new Date(sentAt.getTime() + 20 * 3_600_000),
        },
      });
  }
}

export async function seedQuotes(tx: Tx, tenantId: string, userId: string | null): Promise<void> {
  if ((await tx.quote.count({ where: { tenantId } })) > 0) return;
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const settings = (tenant.settings ?? {}) as {
    numbering?: { quote?: string };
    overheadCoefficient?: string;
    marginCoefficient?: string;
  };
  const ctx = {
    tenantId,
    userId,
    pattern: settings.numbering?.quote ?? DEFAULT_NUMBER_PATTERNS.quote,
    coefs: {
      overheadCoefficient: settings.overheadCoefficient ?? '1.10',
      marginCoefficient: settings.marginCoefficient ?? '1.25',
    },
  };
  await createQuote(tx, ctx, {
    opportunityTitle: 'Rénovation salle de bain',
    title: 'Rénovation salle de bain',
    status: 'draft',
    intro:
      'Suite à notre visite, voici notre proposition pour la rénovation complète de votre salle de bain.',
    sections: [
      {
        title: 'Démolition et préparation',
        lines: [
          ['GEN-PROT', '1'],
          ['GEN-DEM-01', '6.2'],
          ['GEN-CONT-08', '1'],
        ],
      },
      {
        title: 'Carrelage',
        lines: [
          ['OUV-FAI-3060', '18.5'],
          ['OUV-SOL-6060', '6.2'],
        ],
      },
      {
        title: 'Sanitaires',
        lines: [
          ['SAN-WC-SUSP', '1'],
          ['SAN-LAVABO', '1'],
          ['SAN-MIT-LAV', '1'],
          ['SAN-DOUCHE-THERMO', '1'],
          ['SAN-RECEV-90', '1'],
        ],
      },
      { title: "Option : douche à l'italienne", optional: true, lines: [['OUV-SAN-ITAL', '1']] },
    ],
  });
  await createQuote(tx, ctx, {
    opportunityTitle: "Douche à l'italienne",
    title: "Douche à l'italienne",
    status: 'viewed',
    sentDaysAgo: 4,
    sections: [
      {
        title: 'Douche',
        lines: [
          ['OUV-SAN-ITAL', '1'],
          ['OUV-FAI-3060', '9'],
        ],
      },
    ],
  });
  await createQuote(tx, ctx, {
    opportunityTitle: "Éclairage LED de l'atelier",
    title: "Éclairage LED de l'atelier",
    status: 'sent',
    sentDaysAgo: 9,
    sections: [
      {
        title: 'Éclairage',
        lines: [
          ['ELE-SPOT', '40'],
          ['OUV-ELE-POINT', '12'],
          ['ELE-TAB-4R', '1'],
        ],
      },
    ],
  });
  await createQuote(tx, ctx, {
    opportunityTitle: 'Ravalement de façade',
    title: 'Ravalement de façade',
    status: 'sent',
    sentDaysAgo: 2,
    sections: [
      {
        title: 'Façade',
        lines: [
          ['TOI-ECHAF', '120'],
          ['OUV-PEINT', '95'],
        ],
      },
    ],
  });
}
