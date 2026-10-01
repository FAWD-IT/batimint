# ADR 0002 — Authentification maison plutôt que Better Auth

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
`docs/06` recommande Better Auth « à confirmer par ADR ». Nos contraintes : RLS Postgres par transaction (le tenant actif doit être positionné par nous), modèle `Membership` propre, clients web (cookie) **et** mobile Flutter (jeton), impersonation super-admin auditée en lecture seule.

## Décision
Authentification implémentée dans l'API, sans bibliothèque tierce :
- sessions opaques en base (`sessions`, jeton aléatoire 256 bits, seul le SHA-256 est stocké), cookie `bm_session` httpOnly/SameSite=Lax/Secure en production, ou `Authorization: Bearer` pour le mobile ;
- mots de passe **scrypt** (paramètres encodés), lien magique et réinitialisation par jetons à usage unique (20 min / 1 h), réponses identiques que le compte existe ou non ;
- TOTP optionnel (`otpauth`), secret chiffré AES-256-GCM (`FIELD_ENCRYPTION_KEY`) ;
- sessions listables et révocables ; une réinitialisation révoque toutes les sessions ;
- protection CSRF : cookie SameSite + vérification de l'en-tête `Origin` sur les requêtes modifiantes authentifiées par cookie ;
- impersonation : session portant `impersonator_id`, droits du rôle Comptable (lecture seule) et refus de toute requête modifiante ;
- les e-mails d'authentification (lien magique, réinitialisation) sont envoyés **directement** par l'API : ce ne sont pas des mutations métier, et le jeton en clair ne doit jamais transiter par l'outbox.

## Conséquences
Moins de dépendances et un contrôle total sur la RLS. En contrepartie, nous maintenons ce code : il est couvert par des tests d'intégration (inscription, connexion, lien magique, réinitialisation, TOTP, révocation, CSRF). Passkeys et SSO pourront s'ajouter derrière la même table de sessions.
