/**
 * E-mails transactionnels d'authentification (FR, vouvoiement). Mise en page sobre, conforme au
 * design system (noir et blanc, bouton noir). Les modèles métier éditables par tenant arrivent en M3.
 */
import type { MailMessage } from '@batimint/integrations';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function layout(title: string, bodyHtml: string, cta?: { label: string; href: string }): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:#F4F3EF;font-family:Geist,system-ui,-apple-system,'Segoe UI',sans-serif;color:#111111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E4E2DC;border-radius:16px;padding:32px">
<tr><td style="font-weight:700;font-size:18px;letter-spacing:-0.02em;padding-bottom:24px">Batimint</td></tr>
<tr><td style="font-size:22px;font-weight:700;letter-spacing:-0.02em;padding-bottom:12px">${esc(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.55;color:#111111">${bodyHtml}</td></tr>
${
  cta
    ? `<tr><td style="padding-top:24px"><a href="${esc(cta.href)}" style="display:inline-block;background:#111111;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:14px 22px;border-radius:12px">${esc(cta.label)}</a></td></tr>
<tr><td style="padding-top:16px;font-size:12px;color:#5E5E5A;word-break:break-all">Si le bouton ne fonctionne pas, copiez ce lien : ${esc(cta.href)}</td></tr>`
    : ''
}
</table>
<p style="font-size:12px;color:#5E5E5A;margin-top:16px">Vous recevez cet e-mail car une action a été demandée sur Batimint.</p>
</td></tr></table></body></html>`;
}

type Templates = {
  magicLink: { to: string; name: string; link: string; minutes: number };
  passwordReset: { to: string; name: string; link: string; minutes: number };
};

export function renderEmail<K extends keyof Templates>(template: K, vars: Templates[K]): MailMessage {
  switch (template) {
    case 'magicLink': {
      const v = vars as Templates['magicLink'];
      return {
        to: v.to,
        subject: 'Votre lien de connexion Batimint',
        html: layout(
          'Connexion à Batimint',
          `<p>Bonjour ${esc(v.name)},</p><p>Cliquez sur le bouton pour vous connecter. Ce lien est valable ${v.minutes} minutes et ne sert qu'une fois.</p>`,
          { label: 'Me connecter', href: v.link },
        ),
        text: `Bonjour ${v.name},\n\nPour vous connecter à Batimint, ouvrez ce lien (valable ${v.minutes} minutes) :\n${v.link}\n`,
      };
    }
    case 'passwordReset': {
      const v = vars as Templates['passwordReset'];
      return {
        to: v.to,
        subject: 'Réinitialisation de votre mot de passe Batimint',
        html: layout(
          'Nouveau mot de passe',
          `<p>Bonjour ${esc(v.name)},</p><p>Vous avez demandé à changer votre mot de passe. Ce lien est valable ${v.minutes} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>`,
          { label: 'Choisir un nouveau mot de passe', href: v.link },
        ),
        text: `Bonjour ${v.name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable ${v.minutes} minutes) :\n${v.link}\n`,
      };
    }
  }
  throw new Error(`Modèle inconnu : ${String(template)}`);
}
