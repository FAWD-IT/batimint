/**
 * Devis côté API : suggestion de TVA, DTO, enregistrement du contenu (versionné après envoi),
 * rendu PDF. Les calculs viennent de `packages/domain` (mêmes fonctions que le portail et le PDF).
 */
import type { QuoteContentSchema } from '@batimint/contracts';
import { type Tx, loadVersionContent, replaceVersionContent, type VersionContent } from '@batimint/db';
import { renderQuotePdf } from '@batimint/documents';
import {
  can,
  computeQuote,
  dwellingAge,
  determineVatRegime,
  type QuoteTotals,
  type Role,
  validateVatOverride,
  type VatRegime,
  VAT_REGIME_LIST,
} from '@batimint/domain';
import type { Integrations } from '@batimint/integrations';
import type { z } from 'zod';
import { badRequest, conflict, notFound } from '../lib/errors';
import { iso } from '../lib/tenant';

type QuoteRow = NonNullable<Awaited<ReturnType<typeof loadQuoteRow>>>;

export function loadQuoteRow(tx: Tx, id: string) {
  return tx.quote.findUnique({
    where: { id },
    include: {
      customer: true,
      site: true,
      versions: { orderBy: { version: 'asc' } },
      vatCertificates: true,
      project: { select: { id: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// TVA (05 §3) : régime proposé à partir du client et de l'adresse de chantier
// ---------------------------------------------------------------------------

export function suggestVat(
  customer: { kind: 'individual' | 'company'; vatLiable: boolean; country: string } | null,
  site: { isPrivateDwelling: boolean; firstOccupancyYear: number | null } | null,
) {
  const age = dwellingAge(site?.firstOccupancyYear);
  const d = determineVatRegime({
    customerKind: customer?.kind ?? 'individual',
    customerFilesPeriodicVatReturns: customer?.vatLiable ?? false,
    customerCountry: customer?.country ?? 'BE',
    isImmovableWork: true,
    isPrivateDwelling: site ? site.isPrivateDwelling : (customer?.kind ?? 'individual') === 'individual',
    ...(age !== undefined ? { dwellingAgeYears: age } : {}),
  });
  return {
    regime: d.regime as VatRegime,
    reason: d.reason,
    requiresCertificate: d.requiresCertificate,
    dwellingAgeYears: age ?? null,
  };
}

/** Régime proposé pour une ligne : celui de l'article s'il est imposé, sinon celui du devis. */
export function lineSuggestion(itemVatRate: string | null | undefined, quoteRegime: VatRegime): VatRegime {
  return itemVatRate && itemVatRate !== 'auto' && (VAT_REGIME_LIST as string[]).includes(itemVatRate)
    ? (itemVatRate as VatRegime)
    : quoteRegime;
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export function totalsDto(t: QuoteTotals, content: VersionContent, withCosts: boolean) {
  const sectionByKey = new Map(t.sections.map((s) => [s.id, s]));
  return {
    totalNet: Number(t.document.totalNet),
    totalVat: Number(t.document.totalVat),
    totalGross: Number(t.document.totalGross),
    vatBreakdown: t.document.vatBreakdown.map((v) => ({
      category: v.category,
      ratePercent: v.ratePercent,
      regimes: v.regimes,
      taxableAmount: Number(v.taxableAmount),
      taxAmount: Number(v.taxAmount),
    })),
    depositAmount: Number(t.depositAmount),
    optionsAvailable: Number(t.optionsAvailable),
    laborHours: t.laborHours.toDecimalPlaces(2).toString(),
    hasReverseCharge: t.document.hasReverseCharge,
    ...(withCosts
      ? {
          totalCost: Number(t.totalCost),
          totalMargin: Number(t.totalMargin),
          marginRate: t.marginRate?.toDecimalPlaces(4).toString() ?? null,
        }
      : {}),
    sections: content.sections.map((s) => {
      const st = sectionByKey.get(s.id)!;
      return {
        key: s.id,
        included: st.included,
        netAmount: Number(st.netAmount),
        laborHours: st.laborHours.toDecimalPlaces(2).toString(),
        ...(withCosts
          ? { cost: Number(st.cost), marginRate: st.marginRate?.toDecimalPlaces(4).toString() ?? null }
          : {}),
      };
    }),
    lines: t.lines.map((l) => ({
      key: l.id,
      netAmount: Number(l.netAmount),
      ...(withCosts
        ? { cost: Number(l.cost), marginRate: l.marginRate?.toDecimalPlaces(4).toString() ?? null }
        : {}),
    })),
  };
}

export async function versionDto(tx: Tx, versionId: string, role: Role) {
  const loaded = await loadVersionContent(tx, versionId);
  if (!loaded) throw notFound('Cette version');
  const { version: v, content } = loaded;
  const withCosts = can(role, 'pricing.read');
  return {
    id: v.id,
    version: v.version,
    status: v.status,
    intro: v.intro,
    notes: v.notes,
    globalDiscountPercent: v.globalDiscountPercent.toString(),
    deposit: content.deposit
      ? content.deposit.kind === 'percent'
        ? { kind: 'percent' as const, value: String(content.deposit.value) }
        : { kind: 'amount' as const, value: Number(content.deposit.value) }
      : null,
    paymentSchedule: (v.paymentSchedule as { label: string; percent: string }[]) ?? [],
    sections: content.sections.map((s) => ({
      id: s.rowId,
      key: s.id,
      title: s.title,
      description: s.description,
      optional: s.optional,
      selected: s.selected,
      lines: s.lines.map((l) => ({
        id: l.rowId,
        key: l.id,
        kind: l.kind,
        itemId: l.itemId,
        code: l.code,
        description: l.description,
        unit: l.unit,
        quantity: String(l.quantity),
        unitPrice: Number(l.unitPrice),
        ...(withCosts ? { unitCost: Number(l.unitCost) } : {}),
        laborHours: String(l.laborHours),
        vatRegime: l.vatRegime,
        vatSuggested: l.vatSuggested,
        vatJustification: l.vatJustification,
        discountPercent: String(l.discountPercent ?? '0'),
      })),
    })),
    totals: totalsDto(computeQuote(content), content, withCosts),
    revision: v.revision,
    sentAt: iso(v.sentAt),
    createdAt: v.createdAt.toISOString(),
  };
}

export async function quoteDto(tx: Tx, id: string, role: Role) {
  const q = await loadQuoteRow(tx, id);
  if (!q || !q.currentVersionId) throw notFound('Ce devis');
  // Requêtes séquentielles : une transaction n'accepte qu'une requête à la fois.
  const currentVersion = await versionDto(tx, q.currentVersionId, role);
  const timeline = await tx.timelineEntry.findMany({
    where: { quoteId: q.id },
    orderBy: { occurredAt: 'desc' },
    take: 50,
  });
  const signature = q.signedAt
    ? await tx.signature.findFirst({
        where: { subjectType: 'quote_version', subjectId: { in: q.versions.map((v) => v.id) } },
        orderBy: { signedAt: 'desc' },
      })
    : null;
  const cert = q.vatCertificates[0];
  return {
    id: q.id,
    number: q.number,
    title: q.title,
    status: q.status,
    isTemplate: q.isTemplate,
    customer: q.customer
      ? {
          id: q.customer.id,
          displayName: q.customer.displayName,
          email: q.customer.email,
          kind: q.customer.kind,
          vatLiable: q.customer.vatLiable,
        }
      : null,
    site: q.site
      ? {
          id: q.site.id,
          label: q.site.label,
          street: q.site.street,
          postalCode: q.site.postalCode,
          city: q.site.city,
          firstOccupancyYear: q.site.firstOccupancyYear,
          isPrivateDwelling: q.site.isPrivateDwelling,
        }
      : null,
    opportunityId: q.opportunityId,
    projectId: q.project?.id ?? null,
    validityDays: q.validityDays,
    validUntil: iso(q.validUntil),
    sentAt: iso(q.sentAt),
    viewedAt: iso(q.viewedAt),
    signedAt: iso(q.signedAt),
    refusedAt: iso(q.refusedAt),
    vatSuggestion: suggestVat(q.customer, q.site),
    certificate: cert ? { status: cert.status as 'pending' | 'signed', signedAt: iso(cert.signedAt) } : null,
    signature: signature
      ? {
          signerName: signature.signerName,
          signedAt: signature.signedAt.toISOString(),
          ip: signature.ip,
          documentSha256: signature.documentSha256,
        }
      : null,
    currentVersion,
    versions: q.versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      totalGross: Number(v.totalGross),
      createdAt: v.createdAt.toISOString(),
      sentAt: iso(v.sentAt),
    })),
    timeline: timeline.map((t) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      body: t.body,
      occurredAt: t.occurredAt.toISOString(),
    })),
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Enregistrement du contenu
// ---------------------------------------------------------------------------

export const EDITABLE_AFTER_SEND = ['sent', 'viewed', 'refused', 'expired'] as const;

/** Met à jour les totaux mis en cache sur la version (listes, tableaux de bord). */
export async function refreshVersionTotals(tx: Tx, versionId: string): Promise<QuoteTotals> {
  const loaded = await loadVersionContent(tx, versionId);
  if (!loaded) throw notFound('Cette version');
  const t = computeQuote(loaded.content);
  await tx.quoteVersion.update({
    where: { id: versionId },
    data: {
      totalNet: t.document.totalNet,
      totalVat: t.document.totalVat,
      totalGross: t.document.totalGross,
      totalCost: t.totalCost,
      depositAmount: t.depositAmount,
    },
  });
  return t;
}

/**
 * Enregistre le contenu de l'éditeur. Un devis déjà envoyé n'est jamais modifié : une nouvelle
 * version est créée et la précédente devient « remplacée » (04, cycle de vie du devis).
 */
export async function saveQuoteContent(
  tx: Tx,
  ctx: { tenantId: string; userId: string },
  quote: QuoteRow,
  input: z.output<typeof QuoteContentSchema>,
): Promise<{ newVersion: boolean }> {
  if (quote.status === 'signed')
    throw conflict('quote_signed', 'Ce devis est signé : créez un avenant depuis le chantier.');
  const current = quote.versions.find((v) => v.id === quote.currentVersionId);
  if (!current) throw notFound('Ce devis');
  if (input.revision !== current.revision) {
    throw conflict(
      'stale_revision',
      'Ce devis vient d’être modifié ailleurs. Rechargez pour voir la dernière version.',
      { revision: current.revision },
    );
  }

  // Régimes de TVA : tout écart à la proposition doit être justifié (02 P2.5, tracé).
  const suggestion = suggestVat(quote.customer, quote.site);
  const itemIds = input.sections.flatMap((s) =>
    s.lines.map((l) => l.itemId).filter((x): x is string => Boolean(x)),
  );
  const items = itemIds.length
    ? await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, vatRate: true } })
    : [];
  const itemRate = new Map(items.map((i) => [i.id, i.vatRate]));
  const missing: string[] = [];
  const sections = input.sections.map((s) => ({
    key: s.key,
    title: s.title,
    description: s.description ?? null,
    optional: s.optional,
    selected: s.selected,
    lines: s.lines.map((l) => {
      const suggested = lineSuggestion(l.itemId ? itemRate.get(l.itemId) : null, suggestion.regime);
      if (l.kind === 'item') {
        const check = validateVatOverride({
          suggested,
          chosen: l.vatRegime as VatRegime,
          justification: l.vatJustification ?? null,
        });
        if (!check.ok) missing.push(l.key);
      }
      return {
        key: l.key,
        kind: l.kind,
        itemId: l.itemId ?? null,
        code: l.code ?? null,
        description: l.description,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: BigInt(l.unitPrice),
        unitCost: BigInt(l.unitCost ?? 0),
        laborHours: l.laborHours ?? '0',
        vatRegime: l.vatRegime,
        vatSuggested: suggested,
        vatJustification: l.vatRegime === suggested ? null : (l.vatJustification ?? null),
        discountPercent: l.discountPercent ?? '0',
      };
    }),
  }));
  if (missing.length) {
    throw badRequest(
      'vat_justification_required',
      'Vous avez changé le taux de TVA proposé : indiquez pourquoi (5 caractères minimum).',
      { lineKeys: missing },
    );
  }

  let versionId = current.id;
  let newVersion = false;
  if ((EDITABLE_AFTER_SEND as readonly string[]).includes(current.status)) {
    const created = await tx.quoteVersion.create({
      data: {
        tenantId: ctx.tenantId,
        quoteId: quote.id,
        version: Math.max(...quote.versions.map((v) => v.version)) + 1,
        status: 'draft',
        createdBy: ctx.userId,
      },
    });
    await tx.quoteVersion.update({ where: { id: current.id }, data: { status: 'superseded' } });
    versionId = created.id;
    newVersion = true;
  }

  await replaceVersionContent(tx, ctx.tenantId, versionId, { sections });
  const deposit = input.deposit === undefined ? undefined : input.deposit;
  await tx.quoteVersion.update({
    where: { id: versionId },
    data: {
      intro: input.intro ?? null,
      notes: input.notes ?? null,
      ...(input.globalDiscountPercent !== undefined
        ? { globalDiscountPercent: input.globalDiscountPercent }
        : {}),
      ...(deposit !== undefined
        ? {
            depositKind: deposit?.kind ?? null,
            depositValue: deposit ? String(deposit.value) : null,
          }
        : {}),
      ...(input.paymentSchedule ? { paymentSchedule: input.paymentSchedule } : {}),
      vatContext: suggestion,
      revision: newVersion ? 1 : { increment: 1 },
    },
  });
  await refreshVersionTotals(tx, versionId);
  await tx.quote.update({
    where: { id: quote.id },
    data: {
      ...(input.title ? { title: input.title } : {}),
      ...(input.validityDays ? { validityDays: input.validityDays } : {}),
      ...(newVersion ? { currentVersionId: versionId, status: 'draft', reminderSentAt: null } : {}),
    },
  });
  return { newVersion };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function addressLines(o: { street: string | null; postalCode: string | null; city: string | null }) {
  return [o.street, [o.postalCode, o.city].filter(Boolean).join(' ')].filter((x): x is string =>
    Boolean(x && x.trim()),
  );
}

export async function renderVersionPdf(
  tx: Tx,
  integrations: Integrations,
  quoteId: string,
  versionId: string,
  options: {
    selection?: Record<string, boolean>;
    signature?: { signerName: string; signedAt: Date; ip: string | null } | null;
    certificate?: { signedAt: Date } | null;
    date?: Date;
  } = {},
): Promise<Buffer> {
  const q = await tx.quote.findUnique({
    where: { id: quoteId },
    include: { tenant: true, customer: true, site: true },
  });
  const loaded = await loadVersionContent(tx, versionId);
  if (!q || !loaded) throw notFound('Ce devis');
  const t = q.tenant;
  let logo: Uint8Array | null = null;
  if (t.logoKey && !t.logoKey.endsWith('.svg')) {
    logo = await integrations.storage.get('uploads', t.logoKey).catch(() => null);
  }
  const content: VersionContent = {
    ...loaded.content,
    sections: loaded.content.sections.map((s) =>
      options.selection && s.optional && s.id in options.selection
        ? { ...s, selected: options.selection[s.id]! }
        : s,
    ),
  };
  return renderQuotePdf({
    tenant: {
      name: t.legalName ?? t.name,
      lines: [
        ...addressLines(t),
        ...(t.vatNumber ? [`TVA ${t.vatNumber}`] : []),
        ...[t.email, t.phone].filter((x): x is string => Boolean(x)),
      ],
      brandColor: t.brandColor,
      logo,
      iban: t.iban,
      bic: t.bic,
      termsAndConditions: t.termsAndConditions,
      legalMentions: t.legalMentions,
    },
    customer: {
      name: q.customer?.displayName ?? '—',
      lines: q.customer
        ? [...addressLines(q.customer), ...(q.customer.vatNumber ? [`TVA ${q.customer.vatNumber}`] : [])]
        : [],
    },
    siteAddress: q.site ? `${q.site.street}, ${q.site.postalCode} ${q.site.city}` : null,
    quote: {
      number: q.number,
      title: q.title,
      version: loaded.version.version,
      date: options.date ?? loaded.version.sentAt ?? new Date(),
      validUntil: q.validUntil,
      intro: loaded.version.intro,
      notes: loaded.version.notes,
      paymentSchedule: (loaded.version.paymentSchedule as { label: string; percent: string }[]) ?? [],
    },
    content,
    signature: options.signature ?? null,
    certificate: options.certificate ?? null,
  });
}
