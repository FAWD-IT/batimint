# 06 — Architecture

## Vue d'ensemble
```
            ┌──────────── apps/web (Next.js) ─────────────┐
            │ back-office · portail client · portail sous- │
            │ traitant · vue terrain PWA                   │
            └───────────────┬──────────────────────────────┘
                            │ HTTPS (REST JSON + SSE)
                     apps/api (Fastify 5)
          auth · permissions · RLS · OpenAPI · SSE · webhooks
                            │ transaction : données + outbox
                      PostgreSQL 16 (RLS)
                            │ pg-boss / LISTEN-NOTIFY
                    apps/worker (consommateurs)
     timeline · budget · notifications · PDF · Peppol · compta ·
             ONSS · relances · rapprochement · IA
                            │
         packages/integrations (adaptateurs + mocks)
     getpeppr · Chift · ONSS · Mollie · SMTP · S3 · Anthropic · VIES
```

## Choix structurants
- **Domaine pur** (`packages/domain`) : calculs, transitions d'état, règles TVA, numérotation, communication structurée, rapprochement (scoring). Il est utilisé par l'API, le worker et le web (aperçu des calculs en direct, mêmes fonctions).
- **Transactional outbox** : l'API écrit l'état et l'`OutboxEvent` dans la même transaction. Un relais publie les événements dans pg-boss. Chaque consommateur enregistre `ProcessedEvent(consumer, event_id)` pour être idempotent, avec retries à backoff exponentiel, file morte visible dans l'admin, et rejeu possible.
- **Temps réel** : `pg_notify` depuis le worker, puis l'API diffuse en SSE avec contrôle d'accès par canal. Le front utilise TanStack Query et invalide sur message. Un fallback de polling est prévu si SSE est indisponible.
- **Multi-tenant** : RLS Postgres. L'API ouvre une transaction et appelle `set_config('app.tenant_id', …, true)`. Le rôle applicatif n'a pas `BYPASSRLS`. Le worker positionne le tenant de l'événement. Un test d'isolation inter-tenant est obligatoire dans la CI.
- **Auth** : centralisée dans l'API, avec sessions en cookie httpOnly, Secure et SameSite=Lax. Recommandation : Better Auth (organisations, invitations, lien magique, TOTP), à confirmer par ADR. Les portails externes utilisent des `PortalToken` signés, à portée limitée (un client, un chantier), révocables et à expiration.
- **Permissions** : matrice rôle × action dans `packages/domain`, vérifiée côté API (source de vérité) et utilisée côté web pour masquer les éléments. Les champs financiers sont filtrés pour le rôle Ouvrier **au niveau de l'API**.
- **API** : REST + OpenAPI 3.1 généré depuis les schémas zod, versionnée `/v1`. Pagination par curseur, `Idempotency-Key` sur les POST, IDs générables côté client. Un endpoint de synchro terrain par lots sert la PWA (et Flutter plus tard).
- **Fichiers** : S3-compatible (MinIO). Upload direct par URL pré-signée, miniatures générées par le worker, documents légaux dans un bucket versionné.
- **PDF** : rendu HTML vers PDF (Chromium headless dans le worker, ou bibliothèque équivalente, à justifier par ADR). Gabarits partagés pour devis, facture, avenant, PV et bon de régie, aux couleurs du tenant.
- **Recherche** : Postgres full-text + `pg_trgm` (pas de moteur externe).
- **Observabilité** : logs JSON structurés (pino) avec `tenant_id` et `request_id`, endpoints `/health` (liveness) et `/ready` (DB + migrations), métriques basiques, suivi d'erreurs prévu par variable (Sentry DSN optionnel).
- **Sécurité** : rate limiting (auth, portails, webhooks), signature des webhooks vérifiée, CSP stricte, en-têtes de sécurité, chiffrement applicatif des champs sensibles (INSS, secrets d'intégration), audit log.
- **Hors ligne terrain** : service worker, file d'actions en IndexedDB, rejouée à la reconnexion avec idempotence. Conflits résolus côté serveur (dernier pointage horodaté gagne, signalé si incohérent).

## Arborescence cible
```
apps/web  apps/api  apps/worker
packages/domain  packages/contracts  packages/db  packages/integrations  packages/ui  packages/config
design/  docs/  docs/adr/  e2e/
docker-compose.dev.yml  docker-compose.coolify.yml  .env.example  .github/workflows/ci.yml
```

## Performance (budgets)
- Page chantier interactive en moins de 1,5 s sur un tenant de démo de 200 chantiers.
- Recherche ⌘K en moins de 150 ms côté serveur.
- Recalcul d'un budget chantier après un événement en moins de 500 ms.
- Écrans du back-office en lecture-affichage : moins de 300 ms côté API au p95.
