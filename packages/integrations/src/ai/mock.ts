/**
 * Mock déterministe (07) : sans clé, les suggestions reposent sur une recherche textuelle simple.
 */
import type {
  AiAssistant,
  AllocationSuggestion,
  DraftLine,
  ExtractedInvoice,
  LibraryCandidate,
} from './types';

const usage = (operation: string) => ({ provider: 'mock', operation, inputTokens: 0, outputTokens: 0 });

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9²³,. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalizeText(s)
    .split(' ')
    .filter(
      (t) =>
        t.length > 2 &&
        !['pour', 'avec', 'dans', 'comprise', 'compris', 'pose', 'des', 'les', 'une'].includes(t),
    );
}

/** Score de similarité grossier (Jaccard sur les mots). */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t) || [...tb].some((x) => x.startsWith(t) || t.startsWith(x))) inter++;
  return inter / Math.min(ta.size, tb.size);
}

const UNIT_RE =
  /(\d+(?:[.,]\d+)?)\s*(m²|m2|m³|m3|ml|m|mètres?|metres?|u|pcs?|pièces?|pieces?|h|heures?|forfaits?)\b/i;

function unitOf(raw: string): string {
  const u = raw.toLowerCase();
  if (u === 'm2' || u === 'm²') return 'm²';
  if (u === 'm3' || u === 'm³') return 'm³';
  if (u.startsWith('h')) return 'h';
  if (u.startsWith('forfait')) return 'forfait';
  if (u === 'm' || u === 'ml' || u.startsWith('m')) return 'm';
  return 'u';
}

export class MockAiAssistant implements AiAssistant {
  readonly provider = 'mock';

  async transcribe(audio: Uint8Array, _contentType: string) {
    const seconds = Math.max(1, Math.round(audio.byteLength / 16_000));
    return {
      text: `Note vocale de ${seconds} s (transcription simulée) : à réécouter pour le détail des mesures et des remarques du client.`,
      durationSeconds: seconds,
      usage: usage('transcribe'),
    };
  }

  async draftQuoteLines(text: string, library: readonly LibraryCandidate[]) {
    const parts = text
      .split(/[\n;]|(?:\s+et\s+)|(?:,\s+(?=\d))/i)
      .map((p) => p.trim())
      .filter(Boolean);
    const lines: DraftLine[] = parts.map((part) => {
      const m = UNIT_RE.exec(part);
      const quantity = m ? m[1]!.replace(',', '.') : '1';
      const unit = m ? unitOf(m[2]!) : 'u';
      const description = m
        ? part
            .replace(m[0], '')
            .replace(/^\s*(de|d')\s*/i, '')
            .trim()
        : part;
      let best: { c: LibraryCandidate; s: number } | null = null;
      for (const c of library) {
        const s = similarity(description, c.name) + (c.unit === unit ? 0.1 : 0);
        if (!best || s > best.s) best = { c, s };
      }
      const confident = best && best.s >= 0.34;
      return {
        description: confident ? best!.c.name : description,
        quantity,
        unit: confident ? best!.c.unit : unit,
        itemId: confident ? best!.c.id : null,
        confidence: best ? Math.min(0.95, Number(best.s.toFixed(2))) : 0,
      };
    });
    return { lines, usage: usage('draftQuoteLines') };
  }

  async extractInvoice(_document: Uint8Array, _contentType: string, hints?: { text?: string }) {
    const text = hints?.text ?? '';
    const num = /facture\s*(?:n[°o]\s*)?[:#]?\s*([A-Z0-9\-/]+)/i.exec(text)?.[1] ?? null;
    const po = /\b(BC\d{4}-\d{3,})\b/.exec(text)?.[1] ?? null;
    const total = /total\s*(?:tvac|ttc)?\s*[:=]?\s*([\d.,]+)/i.exec(text)?.[1];
    const invoice: ExtractedInvoice = {
      supplierName: null,
      supplierVat: /\bBE\s?0?\d{3}[.\s]?\d{3}[.\s]?\d{3}\b/.exec(text)?.[0]?.replace(/[.\s]/g, '') ?? null,
      invoiceNumber: num,
      issueDate: null,
      dueDate: null,
      purchaseOrderRef: po,
      totalNet: null,
      totalVat: null,
      totalGross: total ? Number(total.replace(/\./g, '').replace(',', '.')) : null,
      lines: [],
      confidence: num ? 0.6 : 0.2,
    };
    return { invoice, usage: usage('extractInvoice') };
  }

  async suggestAllocation(
    invoice: { supplierName: string; lines: string[]; reference: string | null },
    projects: readonly {
      id: string;
      name: string;
      address: string;
      budgetLines: { id: string; name: string }[];
    }[],
  ) {
    const text = [invoice.reference ?? '', ...invoice.lines].join(' ');
    const suggestions: AllocationSuggestion[] = [];
    for (const p of projects) {
      const projectScore = Math.max(similarity(text, p.name), similarity(text, p.address));
      for (const bl of p.budgetLines) {
        const lineScore = Math.max(...invoice.lines.map((l) => similarity(l, bl.name)), 0);
        const score = Number((projectScore * 0.5 + lineScore * 0.5).toFixed(3));
        if (score > 0)
          suggestions.push({
            projectId: p.id,
            budgetLineId: bl.id,
            score,
            reason: 'Correspondance textuelle (simulation)',
          });
      }
    }
    suggestions.sort((a, b) => b.score - a.score);
    return { suggestions: suggestions.slice(0, 5), usage: usage('suggestAllocation') };
  }
}
