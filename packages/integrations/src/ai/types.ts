/**
 * Assistant IA (07) — toujours une validation humaine avant tout effet ; sorties validées par zod
 * côté appelant ; coûts journalisés par tenant.
 */

export interface LibraryCandidate {
  id: string;
  code: string;
  name: string;
  unit: string;
}

export interface DraftLine {
  description: string;
  quantity: string;
  unit: string;
  itemId: string | null;
  /** 0 à 1. */
  confidence: number;
}

export interface ExtractedInvoice {
  supplierName: string | null;
  supplierVat: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  purchaseOrderRef: string | null;
  totalNet: number | null;
  totalVat: number | null;
  totalGross: number | null;
  lines: { description: string; quantity: string | null; unitPrice: number | null; net: number | null }[];
  confidence: number;
}

export interface AllocationSuggestion {
  projectId: string;
  budgetLineId: string | null;
  score: number;
  reason: string;
}

export interface AiUsage {
  provider: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiAssistant {
  readonly provider: string;
  transcribe(
    audio: Uint8Array,
    contentType: string,
  ): Promise<{ text: string; durationSeconds: number | null; usage: AiUsage }>;
  draftQuoteLines(
    text: string,
    library: readonly LibraryCandidate[],
  ): Promise<{ lines: DraftLine[]; usage: AiUsage }>;
  extractInvoice(
    document: Uint8Array,
    contentType: string,
    hints?: { text?: string },
  ): Promise<{ invoice: ExtractedInvoice; usage: AiUsage }>;
  suggestAllocation(
    invoice: { supplierName: string; lines: string[]; reference: string | null },
    projects: readonly {
      id: string;
      name: string;
      address: string;
      budgetLines: { id: string; name: string }[];
    }[],
  ): Promise<{ suggestions: AllocationSuggestion[]; usage: AiUsage }>;
}
