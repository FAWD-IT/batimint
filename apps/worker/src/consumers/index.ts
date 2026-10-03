import type { Consumer } from '../consumer';
import { transcribeVoiceNote } from './attachments';
import { realtimeBroadcast } from './broadcast';
import { sendInvitation } from './invitations';
import { checkInOutTransmission, fieldRealtime, fieldTimeline, labourCosts } from './field';
import { leadIntake } from './leads';
import { arrivalNotice, dayAhead, planningRealtime } from './planning';
import {
  purchaseOrderSent,
  supplierInvoiceInbox,
  supplierInvoiceLedger,
  supplierInvoiceMatching,
} from './purchasing';
import { invoicingConsumers } from './invoicing';
import { subcontractingConsumers } from './subcontracting';
import { receptionConsumers } from './receptions';
import { memberJoined } from './members';
import { diagnosticNotification } from './notifications';
import {
  budgetDriftWatch,
  changeOrderEmail,
  changeOrderSignedProject,
  commentNotifications,
  projectPortalShare,
  projectRealtime,
  projectTimeline,
} from './projects';
import { quoteReminder, quoteSignedProject, quoteTimeline, sendQuoteEmail } from './quotes';

export const CONSUMERS: readonly Consumer[] = [
  diagnosticNotification,
  sendInvitation,
  memberJoined,
  leadIntake,
  transcribeVoiceNote,
  sendQuoteEmail,
  quoteTimeline,
  quoteSignedProject,
  quoteReminder,
  changeOrderEmail,
  changeOrderSignedProject,
  projectPortalShare,
  projectTimeline,
  budgetDriftWatch,
  commentNotifications,
  projectRealtime,
  fieldTimeline,
  labourCosts,
  checkInOutTransmission,
  fieldRealtime,
  planningRealtime,
  arrivalNotice,
  dayAhead,
  purchaseOrderSent,
  supplierInvoiceMatching,
  supplierInvoiceInbox,
  supplierInvoiceLedger,
  ...invoicingConsumers,
  ...subcontractingConsumers,
  ...receptionConsumers,
  realtimeBroadcast,
];

export function consumersFor(type: string): Consumer[] {
  return CONSUMERS.filter((c) => (c.events as readonly string[]).includes(type));
}
