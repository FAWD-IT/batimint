/**
 * Chantier (03 §5), avenants (02 P5), commentaires et portail chantier (02 P8).
 * Les champs financiers (coûts, engagé, marges) sont absents pour les rôles sans
 * `projects.finance.read` ; les prix de vente sont absents sans `pricing.read`.
 */
import { PROJECT_STEPS } from '@batimint/domain';
import { z } from 'zod';
import { CentsSchema, DecimalString, Email, Uuid } from './common';
import { VatBreakdownSchema, VatRegimeSchema } from './quotes';

export const ProjectStatusSchema = z.enum([
  'preparation',
  'in_progress',
  'suspended',
  'provisional_acceptance',
  'final_acceptance',
  'closed',
]);
export type ProjectStatusDto = z.infer<typeof ProjectStatusSchema>;
export const ProjectStepSchema = z.enum([...PROJECT_STEPS, 'done']);
export const ProjectHealthSchema = z.enum(['ok', 'warn', 'crit']);
export const ChangeOrderStatusSchema = z.enum(['draft', 'sent', 'signed', 'refused']);
export const ProjectListViewSchema = z.enum(['active', 'preparation', 'finished', 'all']);

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const IsoDay = z.iso.date();

// ---------------------------------------------------------------------------
// Liste et cockpit
// ---------------------------------------------------------------------------

export const ProjectSummarySchema = z.object({
  id: Uuid,
  number: z.string(),
  name: z.string(),
  status: ProjectStatusSchema,
  customer: z.object({ id: Uuid, displayName: z.string() }),
  site: z.object({ city: z.string(), address: z.string() }).nullable(),
  /** Libellé court « Dupont · Jumet » (barre latérale). */
  shortLabel: z.string(),
  progress: DecimalString,
  contractAmount: CentsSchema.optional(),
  plannedMargin: DecimalString.nullable().optional(),
  estimatedMargin: DecimalString.nullable().optional(),
  health: ProjectHealthSchema,
  startDate: IsoDay.nullable(),
  endDate: IsoDay.nullable(),
  manager: z.object({ userId: Uuid, name: z.string() }).nullable(),
  updatedAt: z.string(),
});
export type ProjectSummaryDto = z.infer<typeof ProjectSummarySchema>;

export const ProjectListQuerySchema = z.object({
  view: ProjectListViewSchema.default('active'),
  q: z.string().trim().max(120).optional(),
  customerId: Uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const BudgetLineSchema = z.object({
  id: Uuid,
  position: z.number().int(),
  label: z.string(),
  /** Vente HTVA du poste (devis + avenants). */
  saleAmount: CentsSchema.optional(),
  budgetedCost: CentsSchema.optional(),
  committed: CentsSchema.optional(),
  committedByCategory: z.record(z.string(), CentsSchema).optional(),
  projectedCost: CentsSchema.optional(),
  invoiced: CentsSchema.optional(),
  /** Engagé / budgété. */
  consumption: DecimalString.nullable().optional(),
  progress: DecimalString,
  drift: z.boolean(),
  taskCount: z.number().int(),
  doneCount: z.number().int(),
  fromChangeOrder: z.boolean(),
});
export type BudgetLineDto = z.infer<typeof BudgetLineSchema>;

export const ProjectFinancialsSchema = z.object({
  contractAmount: CentsSchema,
  quoteAmount: CentsSchema,
  changeOrdersAmount: CentsSchema,
  budgetedCost: CentsSchema,
  committed: CentsSchema,
  projectedCost: CentsSchema,
  invoiced: CentsSchema,
  collected: CentsSchema,
  plannedMargin: DecimalString.nullable(),
  estimatedMargin: DecimalString.nullable(),
  plannedMarginAmount: CentsSchema,
  estimatedMarginAmount: CentsSchema,
  driftThreshold: DecimalString,
});
export type ProjectFinancialsDto = z.infer<typeof ProjectFinancialsSchema>;

export const ProjectTodoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('invoice_overdue'),
    ref: Uuid,
    number: z.string().nullable(),
    amount: CentsSchema,
    days: z.number().int(),
    severity: z.literal('crit'),
  }),
  z.object({
    kind: z.literal('budget_drift'),
    ref: Uuid,
    label: z.string(),
    overPercent: z.number().int(),
    severity: z.literal('warn'),
  }),
  z.object({
    kind: z.literal('change_order_draft'),
    ref: Uuid,
    ordinal: z.number().int(),
    title: z.string(),
    severity: z.literal('info'),
  }),
  z.object({
    kind: z.literal('change_order_awaiting'),
    ref: Uuid,
    ordinal: z.number().int(),
    title: z.string(),
    days: z.number().int(),
    severity: z.literal('info'),
  }),
  z.object({
    kind: z.literal('client_question'),
    ref: Uuid,
    subject: z.string(),
    author: z.string(),
    changeOrderId: Uuid.nullable(),
    severity: z.literal('warn'),
  }),
  z.object({
    kind: z.literal('project_late'),
    ref: Uuid,
    days: z.number().int(),
    severity: z.literal('warn'),
  }),
]);
export type ProjectTodoDto = z.infer<typeof ProjectTodoSchema>;

export const ProjectSchema = ProjectSummarySchema.extend({
  description: z.string().nullable(),
  suspendedReason: z.string().nullable(),
  customer: z.object({
    id: Uuid,
    displayName: z.string(),
    kind: z.enum(['individual', 'company']),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  site: z
    .object({
      id: Uuid,
      city: z.string(),
      address: z.string(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
    })
    .nullable(),
  quote: z.object({ id: Uuid, number: z.string().nullable(), title: z.string() }).nullable(),
  /** Régime TVA dominant du contrat et attestation 6 %. */
  vat: z.object({ regime: VatRegimeSchema.nullable(), certificateSigned: z.boolean() }),
  team: z.object({ id: Uuid, name: z.string() }).nullable(),
  manager: z.object({ userId: Uuid, name: z.string(), phone: z.string().nullable() }).nullable(),
  schedule: z.object({
    day: z.number().int().nullable(),
    totalDays: z.number().int().nullable(),
    lateDays: z.number().int(),
  }),
  step: ProjectStepSchema,
  allowedTransitions: z.array(ProjectStatusSchema),
  financials: ProjectFinancialsSchema.optional(),
  budgetLines: z.array(BudgetLineSchema),
  todos: z.array(ProjectTodoSchema),
  counts: z.object({
    tasks: z.number().int(),
    openTasks: z.number().int(),
    photos: z.number().int(),
    documents: z.number().int(),
    changeOrders: z.number().int(),
    pendingChangeOrders: z.number().int(),
    openIssues: z.number().int(),
  }),
  portal: z.object({ lastViewedAt: z.string().nullable(), activeLinks: z.number().int() }),
});
export type ProjectDto = z.infer<typeof ProjectSchema>;

export const ProjectUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  description: optText(4000),
  managerUserId: Uuid.nullable().optional(),
  teamId: Uuid.nullable().optional(),
  startDate: IsoDay.nullable().optional(),
  endDate: IsoDay.nullable().optional(),
});

export const ProjectStatusChangeSchema = z.object({
  to: ProjectStatusSchema,
  reason: optText(500),
});

export const PortalLinkRequestSchema = z.object({
  /** Envoyer le lien par e-mail au client (sinon, le lien est seulement renvoyé). */
  send: z.boolean().default(false),
  email: Email.optional(),
  message: optText(2000),
});
export const PortalLinkResponseSchema = z.object({
  url: z.string().nullable(),
  sentTo: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Fil du chantier
// ---------------------------------------------------------------------------

export const ProjectTimelineFilterSchema = z.enum(['all', 'client', 'money', 'field', 'comments']);

export const ProjectTimelinePhotoSchema = z.object({
  id: Uuid,
  url: z.string(),
  caption: z.string().nullable(),
});

export const ProjectTimelineItemSchema = z.object({
  id: Uuid,
  kind: z.enum(['entry', 'comment']),
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  occurredAt: z.string(),
  amount: CentsSchema.nullable(),
  actorLabel: z.string().nullable(),
  visibleToClient: z.boolean(),
  photos: z.array(ProjectTimelinePhotoSchema),
  changeOrderId: Uuid.nullable(),
  /** Pour un commentaire : auteur, mentions, et s'il vient du client. */
  comment: z
    .object({
      authorUserId: Uuid.nullable(),
      fromClient: z.boolean(),
      subjectType: z.string(),
      subjectId: Uuid,
      mine: z.boolean(),
    })
    .nullable(),
});
export type ProjectTimelineItemDto = z.infer<typeof ProjectTimelineItemSchema>;

export const ProjectTimelineQuerySchema = z.object({
  filter: ProjectTimelineFilterSchema.default('all'),
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export const ProjectTimelinePageSchema = z.object({
  items: z.array(ProjectTimelineItemSchema),
  nextBefore: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Commentaires
// ---------------------------------------------------------------------------

export const CommentSubjectTypeSchema = z.enum(['project', 'change_order', 'quote', 'task']);

export const CommentSchema = z.object({
  id: Uuid,
  subjectType: CommentSubjectTypeSchema,
  subjectId: Uuid,
  body: z.string(),
  authorLabel: z.string(),
  authorUserId: Uuid.nullable(),
  fromClient: z.boolean(),
  visibleToClient: z.boolean(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  mine: z.boolean(),
});
export type CommentDto = z.infer<typeof CommentSchema>;

export const CommentCreateSchema = z.object({
  id: Uuid.optional(),
  subjectType: CommentSubjectTypeSchema,
  subjectId: Uuid,
  body: z.string().trim().min(1).max(4000),
  /** Réponse visible par le client (fil partagé sur le portail). */
  visibleToClient: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Tâches
// ---------------------------------------------------------------------------

export const TaskChecklistItemSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(200),
  done: z.boolean(),
});

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'done']);

export const TaskSchema = z.object({
  id: Uuid,
  budgetLineId: Uuid.nullable(),
  position: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatusSchema,
  progress: DecimalString,
  quantity: DecimalString.nullable(),
  unit: z.string().nullable(),
  plannedHours: DecimalString,
  amount: CentsSchema.optional(),
  assignee: z.object({ id: Uuid, name: z.string() }).nullable(),
  dueDate: IsoDay.nullable(),
  checklist: z.array(TaskChecklistItemSchema),
  photoCount: z.number().int(),
  fromQuote: z.boolean(),
  completedAt: z.string().nullable(),
});
export type TaskDto = z.infer<typeof TaskSchema>;

export const TaskCreateSchema = z.object({
  id: Uuid.optional(),
  budgetLineId: Uuid.nullable(),
  title: z.string().trim().min(2).max(300),
  description: optText(4000),
  assigneeEmployeeId: Uuid.nullable().optional(),
  dueDate: IsoDay.nullable().optional(),
});

export const TaskUpdateSchema = z.object({
  title: z.string().trim().min(2).max(300).optional(),
  description: optText(4000),
  status: TaskStatusSchema.optional(),
  /** Avancement en pourcentage entier (0–100). */
  progressPercent: z.number().int().min(0).max(100).optional(),
  assigneeEmployeeId: Uuid.nullable().optional(),
  dueDate: IsoDay.nullable().optional(),
  checklist: z.array(TaskChecklistItemSchema).max(50).optional(),
});

// ---------------------------------------------------------------------------
// Avenants
// ---------------------------------------------------------------------------

export const ChangeOrderLineSchema = z.object({
  id: Uuid,
  budgetLineId: Uuid.nullable(),
  newPostLabel: z.string().nullable(),
  itemId: Uuid.nullable(),
  code: z.string().nullable(),
  description: z.string(),
  unit: z.string(),
  quantity: DecimalString,
  unitPrice: CentsSchema,
  unitCost: CentsSchema.optional(),
  laborHours: DecimalString,
  discountPercent: DecimalString,
  vatRegime: VatRegimeSchema,
  netAmount: CentsSchema,
});
export type ChangeOrderLineDto = z.infer<typeof ChangeOrderLineSchema>;

export const ChangeOrderSummarySchema = z.object({
  id: Uuid,
  projectId: Uuid,
  ordinal: z.number().int(),
  number: z.string().nullable(),
  title: z.string(),
  status: ChangeOrderStatusSchema,
  delayDays: z.number().int(),
  totalNet: CentsSchema,
  totalGross: CentsSchema,
  sentAt: z.string().nullable(),
  signedAt: z.string().nullable(),
  refusedAt: z.string().nullable(),
  openQuestions: z.number().int(),
  createdAt: z.string(),
});
export type ChangeOrderSummaryDto = z.infer<typeof ChangeOrderSummarySchema>;

export const ChangeOrderSchema = ChangeOrderSummarySchema.extend({
  description: z.string().nullable(),
  revision: z.number().int(),
  totalVat: CentsSchema,
  totalCost: CentsSchema.optional(),
  marginRate: DecimalString.nullable().optional(),
  laborHours: DecimalString,
  vatBreakdown: VatBreakdownSchema,
  sentTo: z.string().nullable(),
  refusalReason: z.string().nullable(),
  signature: z.object({ signerName: z.string(), signedAt: z.string() }).nullable(),
  lines: z.array(ChangeOrderLineSchema),
  project: z.object({
    id: Uuid,
    number: z.string(),
    name: z.string(),
    customerEmail: z.string().nullable(),
    endDate: IsoDay.nullable(),
    defaultVatRegime: VatRegimeSchema,
  }),
});
export type ChangeOrderDto = z.infer<typeof ChangeOrderSchema>;

export const ChangeOrderLineInputSchema = z.object({
  id: Uuid.optional(),
  budgetLineId: Uuid.nullable(),
  newPostLabel: optText(200),
  itemId: Uuid.nullable().optional(),
  code: optText(40),
  description: z.string().trim().min(1).max(2000),
  unit: z.string().trim().min(1).max(12),
  quantity: DecimalString,
  unitPrice: CentsSchema,
  unitCost: CentsSchema.optional(),
  laborHours: DecimalString.default('0'),
  discountPercent: DecimalString.default('0'),
  vatRegime: VatRegimeSchema,
});

export const ChangeOrderCreateSchema = z.object({
  id: Uuid.optional(),
  title: z.string().trim().min(2).max(200),
  description: optText(4000),
  delayDays: z.number().int().min(0).max(250).default(0),
  lines: z.array(ChangeOrderLineInputSchema).max(200).default([]),
});

export const ChangeOrderUpdateSchema = ChangeOrderCreateSchema.omit({ id: true }).extend({
  revision: z.number().int(),
});

export const ChangeOrderSendSchema = z.object({ email: Email, message: optText(2000) });
export const ChangeOrderRefuseSchema = z.object({ reason: optText(1000) });

// ---------------------------------------------------------------------------
// Recherche ⌘K
// ---------------------------------------------------------------------------

export const SearchResultSchema = z.object({
  type: z.enum(['project', 'quote', 'customer', 'opportunity', 'item']),
  id: Uuid,
  title: z.string(),
  subtitle: z.string().nullable(),
  href: z.string(),
});
export type SearchResultDto = z.infer<typeof SearchResultSchema>;
export const SearchResponseSchema = z.object({ items: z.array(SearchResultSchema) });

// ---------------------------------------------------------------------------
// Portail chantier (vouvoiement côté interface)
// ---------------------------------------------------------------------------

export const PortalCommentSchema = z.object({
  id: Uuid,
  body: z.string(),
  authorLabel: z.string(),
  fromClient: z.boolean(),
  createdAt: z.string(),
});

export const PortalProjectSchema = z.object({
  tenant: z.object({
    name: z.string(),
    accent: z.string(),
    logoUrl: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  project: z.object({
    name: z.string(),
    number: z.string(),
    status: ProjectStatusSchema,
    step: ProjectStepSchema,
    progress: DecimalString,
    startDate: IsoDay.nullable(),
    endDate: IsoDay.nullable(),
    address: z.string().nullable(),
  }),
  headline: z.object({ title: z.string(), at: z.string().nullable() }).nullable(),
  photoOfTheDay: z
    .object({ url: z.string(), caption: z.string().nullable(), takenAt: z.string(), count: z.number().int() })
    .nullable(),
  changeOrders: z.array(
    z.object({
      id: Uuid,
      ordinal: z.number().int(),
      number: z.string().nullable(),
      title: z.string(),
      description: z.string().nullable(),
      status: ChangeOrderStatusSchema,
      totalNet: CentsSchema,
      totalGross: CentsSchema,
      delayDays: z.number().int(),
      newEndDate: IsoDay.nullable(),
      lines: z.array(
        z.object({
          description: z.string(),
          quantity: DecimalString,
          unit: z.string(),
          netAmount: CentsSchema,
        }),
      ),
      vatBreakdown: VatBreakdownSchema,
      signedAt: z.string().nullable(),
      thread: z.array(PortalCommentSchema),
    }),
  ),
  /** États d'avancement soumis au client (approbation ou contestation, 02 P7.2). */
  statements: z.array(
    z.object({
      id: Uuid,
      ordinal: z.number().int(),
      status: z.enum(['submitted', 'approved', 'disputed', 'invoiced']),
      periodEnd: IsoDay,
      cumulativePercent: DecimalString,
      periodAmount: CentsSchema,
      lines: z.array(
        z.object({
          label: z.string(),
          previousPercent: DecimalString,
          cumulativePercent: DecimalString,
          periodAmount: CentsSchema,
        }),
      ),
      approvedAt: z.string().nullable(),
      approvedByName: z.string().nullable(),
      disputeReason: z.string().nullable(),
    }),
  ),
  /** Factures émises (vouvoiement : « à payer », paiement en ligne). */
  invoices: z.array(
    z.object({
      id: Uuid,
      number: z.string(),
      title: z.string(),
      type: z.string(),
      issueDate: IsoDay.nullable(),
      dueDate: IsoDay.nullable(),
      totalGross: CentsSchema,
      balance: CentsSchema,
      overdue: z.boolean(),
      structuredCommunication: z.string().nullable(),
      canPayOnline: z.boolean(),
      href: z.string(),
    }),
  ),
  documents: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['quote', 'change_order', 'attachment', 'invoice']),
      title: z.string(),
      date: z.string().nullable(),
      href: z.string(),
    }),
  ),
  timeline: z.array(
    z.object({ id: Uuid, title: z.string(), body: z.string().nullable(), occurredAt: z.string() }),
  ),
  thread: z.array(PortalCommentSchema),
  contact: z
    .object({ name: z.string(), phone: z.string().nullable(), email: z.string().nullable() })
    .nullable(),
  customer: z.object({ displayName: z.string() }),
});
export type PortalProjectDto = z.infer<typeof PortalProjectSchema>;

export const PortalChangeOrderSignSchema = z.object({
  signerName: z.string().trim().min(2).max(120),
  acceptTerms: z.literal(true, { error: 'Cochez la case pour accepter l’avenant.' }),
  /** Tracé SVG (path « d ») de la signature manuscrite, facultatif. */
  signaturePath: z.string().max(60_000).nullable().optional(),
});
export const PortalChangeOrderRefuseSchema = z.object({ reason: optText(1000) });
export const PortalCommentCreateSchema = z.object({
  subjectType: z.enum(['project', 'change_order']),
  /** Avenant concerné ; absent pour une question sur le chantier (déduit du lien). */
  subjectId: Uuid.optional(),
  body: z.string().trim().min(2).max(2000),
});
