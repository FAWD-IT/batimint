# ADR 0005 — RLS : contexte par transaction et rôle applicatif provisionné

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
Règle n°1 : isolation multi-tenant par RLS, rôle applicatif sans `BYPASSRLS`, tenant positionné par transaction.

## Décision
- Deux URLs : `MIGRATION_DATABASE_URL` (propriétaire, migrations et seed) et `DATABASE_URL` (rôle applicatif). Le script de migration crée/met à jour le rôle applicatif à partir des identifiants de `DATABASE_URL` (`NOBYPASSRLS NOSUPERUSER`), accorde le DML, révoque UPDATE/DELETE sur `audit_logs`, et **échoue** si une table portant `tenant_id` n'a pas de RLS forcée avec politique.
- Chaque accès passe par `withContext()` qui positionne `app.tenant_id`, `app.user_id` et éventuellement `app.system` via `set_config(..., true)`.
- `rls.enable_tenant_isolation(table)` applique la politique standard ; tables spéciales : `users` (soi-même ou membres du tenant courant), `memberships` et `tenants` (tenant courant ou appartenances de l'utilisateur), `sessions` (soi-même), `auth_tokens` (système).
- `app.system = 'on'` est un contournement **explicite** réservé au relais outbox, à l'authentification et au super-admin ; il n'est jamais positionné à partir d'une entrée utilisateur.
- Le journal d'audit est en ajout seul (trigger + droits).

## Conséquences
Les tests (`packages/db/src/rls.test.ts`) prouvent l'isolation (lecture, écriture, suppression, insertion croisée), l'absence de `BYPASSRLS` et la numérotation sans trou sous concurrence. Toute nouvelle table métier doit appeler `rls.enable_tenant_isolation` dans sa migration, sinon le déploiement échoue.
