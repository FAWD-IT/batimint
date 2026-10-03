# ADR 0007 — Services ponctuels portables (migrate, minio-init)

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
`docs/10` prévoit `exclude_from_hc: true` sur `migrate` et `minio-init`. Cette clé propre à Coolify est refusée par `docker compose` standard, or `docker compose -f docker-compose.coolify.yml up` doit fonctionner tel quel.

## Décision
`migrate` et `minio-init` font leur travail puis restent au repos (`sleep infinity`) avec un healthcheck basé sur un fichier témoin. `api` et `worker` dépendent de `migrate` en `service_healthy`. Un échec de migration arrête le conteneur et bloque le démarrage de l'application.

## Conséquences
Deux conteneurs inactifs (quelques Mo de RAM) ; aucune clé spécifique à Coolify, le même fichier marche partout. Le statut de santé global dans Coolify reste significatif.
