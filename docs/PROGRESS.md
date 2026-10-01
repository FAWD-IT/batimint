# PROGRESS — tenu à jour par l'agent

Ce fichier est le point de reprise entre sessions cloud. Une nouvelle session doit pouvoir reprendre le travail en ne lisant que lui et `CLAUDE.md`.

## Jalon en cours
**M1 — Entreprise et onboarding** — écrans et API livrés, E2E P1 vert (hors import de bibliothèque, livré en M2). Reste : relire les écrans mobiles M1, puis passer à M2.

(L'étiquette `m0-done` existe localement mais le push de tags est refusé par la politique de la session : seule la branche est poussée.)

## Prochaine action
Finir M1 : passe mobile (390×844) sur Paramètres, Équipes, Compte ; puis démarrer M2 (CRM et bibliothèque, ajouter l'étape « bibliothèque » à `ONBOARDING_AVAILABLE` dans `apps/api/src/routes/company.ts`).

### Plan initial de M1 (pour mémoire)
M1 : paramètres entreprise (BCE/TVA via VIES mock, adresse, IBAN, logo, couleur, CGV, taux horaires, coefficients, pauses, délais, relances, retenue de garantie, séries de numérotation), utilisateurs et invitations (consommateur `user.invited` qui envoie l'e-mail), équipes, employés (INSS chiffré), checklist d'onboarding, page Sécurité (sessions, TOTP — l'API existe déjà), super-admin (tenants, flags, impersonation auditée, files en échec). Puis E2E P1 complet.

## Relancer l'environnement
```bash
# Session cloud : le démon Docker n'est pas lancé par défaut (le hook de session le démarre).
docker info >/dev/null 2>&1 || (nohup dockerd >/tmp/dockerd.log 2>&1 &)
pnpm install
cp -n .env.example .env
pnpm services:up          # Postgres :5432, MinIO :9000/:9001, Mailpit :1025/:8025
pnpm db:migrate           # migrations + rôle batimint_app + vérification RLS
pnpm db:seed              # tenant de démo
pnpm dev:apps > /tmp/dev.log 2>&1 &   # web :3000, api :4000, worker (ou `pnpm dev` qui fait tout)
pnpm test                 # unitaires + intégration (bases batimint_test_<package> créées à la volée)
pnpm --filter @batimint/e2e e2e       # E2E (app démarrée ; E2E_DEMO=1 pour les tests sur le seed)
```
Stack de production (images) dans la session cloud — l'AC TLS du bac à sable doit être passée au build :
```bash
docker compose -f docker-compose.coolify.yml -f docker/docker-compose.sandbox.yml -f docker/docker-compose.e2e.yml up -d --build --wait
```
(arrêter d'abord `pnpm dev:apps` et le Mailpit de dev : mêmes ports 3000/4000/8025.)

## Fait
### M0 — Fondations ✅
- Monorepo pnpm + Turborepo, TypeScript strict, ESLint 10, Prettier, Vitest 4 (ADR 0001).
- `packages/domain` (pur, 100 % des lignes couvertes) : centimes `bigint`, arrondis EN 16931, TVA par catégorie/taux, détermination du régime (AE / 6 % / 21 % / intracom), justification de forçage, communication structurée mod 97, numérotation, identifiants belges (BCE, TVA, IBAN, Peppol 0208), matrice de permissions, machines d'état (devis, avenant, chantier, état d'avancement, facture, facture fournisseur, pointage), budget et marge (ADR 0004).
- `packages/db` : Prisma 7, RLS forcée sur toutes les tables métier, rôle applicatif provisionné et vérifié à chaque migration, outbox (+ NOTIFY), audit en ajout seul, numérotation sans trou (100 émissions concurrentes testées), seed des personas, `admin:create` (ADR 0005).
- `apps/api` : Fastify 5, OpenAPI 3.1 (`/docs`), auth maison (inscription, connexion, lien magique, reset, TOTP, sessions révocables, Bearer mobile, CSRF Origin) (ADR 0002), contexte tenant par transaction, Idempotency-Key, erreurs françaises, `/health` `/ready`, SSE par canal, notifications, diagnostic temps réel.
- `apps/worker` : relais outbox → pg-boss 12 (même transaction), consommateurs idempotents, file morte, `pg_notify` transactionnel, battement de santé (ADR 0008).
- `apps/web` : Next.js 16, Tailwind 4 + tokens, Geist auto-hébergée (ADR 0009), i18n FR (next-intl), proxy same-origin `/api/v1` (ADR 0003), coquille back-office (barre latérale sombre, menu mobile, indicateur « En direct », cloche + toasts temps réel), pages auth, Aujourd'hui (état vide), Paramètres → Diagnostic.
- `packages/ui` : boutons, champs, cartes, pastilles, jauges, barre d'étapes, toasts « Annuler », états vides/erreur, squelettes.
- `packages/integrations` : interfaces + mocks (mail SMTP/mock, S3/mémoire, VIES/mock).
- Dockerfiles multi-étapes non-root, `docker-compose.coolify.yml` (ADR 0006, 0007), `docker-compose.dev.yml`, CI GitHub Actions (checks + images + E2E), hook de session.
- Critères de sortie vérifiés : `pnpm test` vert (100 tests), RLS vert, E2E M0 verts en dev **et** sur les images de production (événement outbox → worker → SSE → navigateur, deux navigateurs synchronisés, axe sans violation critique/sérieuse, mobile 390×844), stack Coolify démarrée en local avec base migrée et tenant de démo, redéploiement idempotent.

### M1 — Entreprise et onboarding ✅ (hors bibliothèque, M2)
- Écran de bienvenue (BCE → VIES → fiche pré-remplie), checklist d'onboarding sur Aujourd'hui (ADR 0010).
- Paramètres → Entreprise (identité, VIES, adresse, banque avec contrôle IBAN/BIC, logo, couleur de marque avec contrôle AA, CGV, mentions, adresse e-mail entrante), Paramètres métier (profils horaires, coefficients avec exemple, pauses, tolérance de pointage, paiements, relances, retenue, seuil de dérive, approbation des états d'avancement, numérotation avec aperçu), Utilisateurs (rôles, désactivation, dernier patron protégé, invitations), Intégrations (Peppol : entité légale mock → actif ; test de connexion), Abonnement (plans, essai, sièges bureau, modules), Journal d'audit, Mon compte (profil, mot de passe, 2FA TOTP avec QR, sessions), Diagnostic.
- Équipes : employés (INSS chiffré, consultation journalisée, coûts masqués sans `pricing.read`), équipes (couleur, chef, membres), absences.
- Super-admin `/admin` : tenants (plan, modules), impersonation lecture seule auditée avec bandeau « Quitter », santé des intégrations, traitements en échec avec rejeu.
- Worker : envoi des invitations (jeton généré à l'envoi), notification « X a rejoint l'entreprise » en direct.
- Seed : CGV, couleur, profils horaires, Peppol actif, 8 employés en 2 équipes, congés.
- Tests : 35 intégration API, 66 domaine, 5 worker ; E2E P1 (Marc paramètre et invite ; Luca accepte sur mobile), équipes/INSS, compte.

## Reste à faire
M1 → M13 selon `docs/11-plan-de-livraison.md`.

## Écarts avec la spécification
- Formule du coût projeté corrigée (ADR 0004).
- `exclude_from_hc` remplacé par des services ponctuels « au repos et sains » (ADR 0007).
- Image MinIO communautaire `pgsty/minio` (ADR 0006).
- Auth maison au lieu de Better Auth (ADR 0002) ; même origine via proxy Next (ADR 0003).
- Navigation : seuls les modules livrés apparaissent (pas de lien vers un écran vide). ⌘K arrive avec M4.

## Limites rencontrées dans l'environnement cloud
- Docker est installé mais le démon n'est pas lancé : `dockerd &` (le hook le fait).
- Le TLS sortant est intercepté par le proxy de session : les conteneurs de build ont besoin de l'AC (`docker/docker-compose.sandbox.yml` la passe en secret de build). Sans effet sur Coolify.
- `minio/minio` et `quay.io` indisponibles : fork `pgsty/minio`.
- Playwright épinglé en 1.56.1 pour utiliser le Chromium préinstallé (`/opt/pw-browsers`).
- `pkill -f` avec un motif présent dans la commande courante tue le shell de l'outil : utiliser `ps | grep | kill`.

## À valider métier (comptable / juriste)
- Taux de retenue 30bis et seuils de la déclaration de travaux (`05` §7)
- Forme de l'attestation 6 % et éligibilité ligne par ligne (`05` §3)
- Mention légale d'autoliquidation (`05` §3)
- Délai d'émission des factures et durée de conservation (`05` §2) — bucket légal paramétré à 10 ans
- Règles de relance B2B / B2C à jour (`05` §6)
- Accès logiciel aux services web ONSS (Check In and Out, 30bis) (`07`)
- Régime intracommunautaire pour un client assujetti étranger (proposé automatiquement, `domain/vat.ts`)

## Améliorations repérées en jouant les parcours
- M0 · Luca (Ouvrier) · Paramètres : le lien menait à une page sans rien d'utilisable → lien et page conditionnés aux sections autorisées.
- M0 · tous · police : l'import Google Fonts cassait le CSS et posait un problème RGPD → Geist embarquée.
