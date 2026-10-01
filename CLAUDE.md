# CLAUDE.md — Batimint

SaaS de gestion pour PME belges du BTP. Le chantier est l'objet pivot ; chaque action produit un événement qui met à jour le reste du système et les écrans en temps réel. Spécification complète dans `docs/` (lire dans l'ordre des numéros).

## Stack (décidée)

- Monorepo **pnpm + Turborepo**, TypeScript strict partout, Node 22 LTS.
- `apps/web` — Next.js (App Router), Tailwind avec les tokens de `design/tokens.css`. Contient : back-office, portail client (`/p/[token]`), portail sous-traitant (`/s/[token]`), vue terrain mobile web installable en PWA (`/terrain`).
- `apps/api` — Fastify 5, validation zod, OpenAPI généré automatiquement (consommé plus tard par l'app Flutter).
- `apps/worker` — consommateurs d'événements et jobs planifiés (pg-boss).
- `packages/domain` — logique métier **pure** (montants, TVA, marges, numérotation, communication structurée, avancement, révision de prix). Zéro I/O. Couverture visée ≥ 90 %.
- `packages/contracts` — schémas zod partagés web ↔ api ↔ worker.
- `packages/db` — Prisma, migrations, politiques RLS, seed.
- `packages/integrations` — adaptateurs (Peppol, compta, ONSS, paiements, e-mail, stockage, IA), chacun avec une implémentation `mock`.
- `packages/ui` — composants du design system.
- Infra : PostgreSQL 16, stockage S3-compatible (MinIO en local et sur Coolify), Mailpit en dev. Pas de Redis : outbox Postgres + pg-boss + LISTEN/NOTIFY.

Toute dérogation à cette stack passe par un ADR dans `docs/adr/`.

## Règles non négociables

1. **Multi-tenant par RLS Postgres** : chaque table métier a `tenant_id` et une politique RLS. L'API positionne le tenant par transaction. Un test automatisé prouve qu'un tenant ne voit jamais les données d'un autre.
2. **Argent** : montants en centimes (`bigint`), quantités en décimal. Les arrondis suivent EN 16931 (voir `docs/05`). Jamais de `number` flottant pour de l'argent.
3. **Événements** : toute mutation métier écrit, dans la même transaction, ses lignes et un événement dans la table `outbox`. Les effets secondaires (timeline, budget, notifications, Peppol, compta, temps réel) ne vivent **que** dans des consommateurs idempotents.
4. **Documents légaux immuables** : une facture émise ne se modifie pas, on la corrige par note de crédit. Numérotation continue sans trou par tenant et par année.
5. **Intégrations derrière une interface** avec un `mock` par défaut. Le produit entier tourne et se teste sans aucune clé externe.
6. **Idempotence** : les endpoints de création acceptent un `Idempotency-Key`, et les IDs peuvent être générés côté client (UUIDv7). C'est indispensable pour le mobile hors ligne.
7. **Audit** : qui a fait quoi, quand, sur chaque objet légal (devis, facture, avenant, signature, pointage).
8. **i18n** : aucune chaîne en dur dans l'UI. FR complet maintenant, structure prête pour NL. Le tutoiement est réservé à la vue terrain, le vouvoiement au portail client.
9. **Pas de secret dans le repo**. Tout passe par les variables d'environnement documentées dans `.env.example`.

## Définition de « fini » (pour chaque fonctionnalité)

- Le parcours utilisateur correspondant de `docs/02` passe en E2E Playwright.
- Les états vide, chargement, erreur, sans droits et mobile sont traités.
- Les règles métier sont testées en unitaire dans `packages/domain`, l'API est testée en intégration contre un vrai Postgres.
- L'événement émis est consommé, et la timeline et la marge du chantier se mettent à jour.
- Le seed de démo montre la fonctionnalité.
- Accessibilité : navigation clavier, labels, contraste AA, aucune violation axe critique.

## Commandes attendues (à créer en M0)

`pnpm dev` (tout en local avec docker compose pour Postgres, MinIO et Mailpit) · `pnpm test` · `pnpm test:e2e` · `pnpm lint` · `pnpm typecheck` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm build`.

## Environnement d'exécution : session Claude Code cloud

Le projet est construit dans des sessions Claude Code cloud (VM Ubuntu 24.04 gérée par Anthropic), sur le repo GitHub. Il est ensuite déployé par Coolify depuis la branche `main`.

- **Outils présents** : Node 22 (avec pnpm), Docker + `docker compose`, PostgreSQL 16 et Redis 7. Postgres et Redis sont installés mais arrêtés : `service postgresql start` si tu utilises le Postgres local plutôt que celui du compose de dev.
- **Réseau filtré** : les registres de paquets (npm…), GitHub, Docker Hub et Google Fonts sont accessibles. **Les API externes (getpeppr, Chift, Mollie, VIES, ONSS, Anthropic côté produit) ne le sont pas forcément** : c'est une raison de plus pour que tout fonctionne en mock. Si le téléchargement des navigateurs Playwright est bloqué, consigne-le dans `PROGRESS.md` et utilise un navigateur Chromium installable via apt.
- **Durée des commandes** : 2 minutes par défaut, 10 au maximum. Lance les installations, builds et suites E2E en arrière-plan avec un fichier de log, et consulte ce log ensuite.
- **La session peut s'arrêter** (inactivité, VM recyclée) et le contexte peut être compacté. Seul ce qui est poussé sur GitHub survit. Commite et pousse après chaque étape significative, et garde `docs/PROGRESS.md` à jour, avec la section « Relancer l'environnement » qui liste les commandes exactes.
- **Le hook de démarrage** `.claude/hooks/session-start.sh` installe les dépendances au début de chaque session. Garde-le rapide et à jour quand l'outillage évolue.
- **Branches** : travaille sur la branche de la session et pousse-la. Anthony relit et merge vers `main` (en général une PR par jalon). Ne pousse jamais directement sur `main` sauf demande explicite.
- **Secrets** : aucun dans le repo ni dans les logs. Les variables de l'environnement cloud sont visibles par les utilisateurs de l'environnement : elles ne contiennent que des clés sandbox.

## Méthode de travail

- Suivre `docs/11-plan-de-livraison.md` jalon par jalon. Tenir `docs/PROGRESS.md` à jour.
- Décider seul quand la spec ne tranche pas, puis écrire un ADR court (contexte, décision, conséquences).
- Après chaque jalon : lancer l'app, jouer les parcours, regarder les écrans, corriger. Ne jamais déclarer fini sans l'avoir vérifié.
- Commits petits et explicites, en anglais, format conventional commits.
