/** E-mails d'authentification (envoyés directement par l'API, ADR 0002). */
import { buildEmail, type MailMessage } from '@batimint/integrations';

type Templates = {
  magicLink: { to: string; name: string; link: string; minutes: number };
  passwordReset: { to: string; name: string; link: string; minutes: number };
};

export function renderEmail<K extends keyof Templates>(template: K, vars: Templates[K]): MailMessage {
  if (template === 'magicLink') {
    return buildEmail({
      to: vars.to,
      subject: 'Votre lien de connexion Batimint',
      title: 'Connexion à Batimint',
      paragraphs: [
        `Bonjour ${vars.name},`,
        `Cliquez sur le bouton pour vous connecter. Ce lien est valable ${vars.minutes} minutes et ne sert qu'une fois.`,
      ],
      cta: { label: 'Me connecter', href: vars.link },
    });
  }
  return buildEmail({
    to: vars.to,
    subject: 'Réinitialisation de votre mot de passe Batimint',
    title: 'Nouveau mot de passe',
    paragraphs: [
      `Bonjour ${vars.name},`,
      `Vous avez demandé à changer votre mot de passe. Ce lien est valable ${vars.minutes} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
    ],
    cta: { label: 'Choisir un nouveau mot de passe', href: vars.link },
  });
}
