/**
 * Mise en page des e-mails transactionnels (FR, vouvoiement), conforme au design system :
 * noir et blanc, bouton noir, aucune image distante. Partagée par l'API et le worker.
 */
import type { MailMessage } from './types';

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface EmailContent {
  to: string;
  subject: string;
  title: string;
  /** Paragraphes en texte brut (échappés). */
  paragraphs: string[];
  cta?: { label: string; href: string };
  /** Nom de l'entreprise émettrice (en-tête), Batimint par défaut. */
  brandName?: string;
  /** Couleur du bouton (déjà vérifiée AA), noir par défaut. */
  buttonColor?: string;
  replyTo?: string;
  footer?: string;
}

export function renderLayout(c: EmailContent): string {
  const button = c.buttonColor ?? '#111111';
  const body = c.paragraphs.map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(c.title)}</title></head>
<body style="margin:0;background:#F4F3EF;font-family:Geist,system-ui,-apple-system,'Segoe UI',sans-serif;color:#111111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E4E2DC;border-radius:16px;padding:32px">
<tr><td style="font-weight:700;font-size:18px;letter-spacing:-0.02em;padding-bottom:24px">${escapeHtml(c.brandName ?? 'Batimint')}</td></tr>
<tr><td style="font-size:22px;font-weight:700;letter-spacing:-0.02em;padding-bottom:12px">${escapeHtml(c.title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.55;color:#111111">${body}</td></tr>
${
  c.cta
    ? `<tr><td style="padding-top:12px"><a href="${escapeHtml(c.cta.href)}" style="display:inline-block;background:${button};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:14px 22px;border-radius:12px">${escapeHtml(c.cta.label)}</a></td></tr>
<tr><td style="padding-top:16px;font-size:12px;color:#5E5E5A;word-break:break-all">Si le bouton ne fonctionne pas, copiez ce lien : ${escapeHtml(c.cta.href)}</td></tr>`
    : ''
}
</table>
<p style="font-size:12px;color:#5E5E5A;margin-top:16px">${escapeHtml(c.footer ?? 'Envoyé avec Batimint.')}</p>
</td></tr></table></body></html>`;
}

export function renderText(c: EmailContent): string {
  return [c.title, '', ...c.paragraphs, ...(c.cta ? ['', `${c.cta.label} : ${c.cta.href}`] : [])].join('\n');
}

export function buildEmail(c: EmailContent): MailMessage {
  return { to: c.to, subject: c.subject, html: renderLayout(c), text: renderText(c), replyTo: c.replyTo };
}
