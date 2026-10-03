# ADR 0006 — Image MinIO

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
MinIO a cessé de publier ses images communautaires (`minio/minio`, `minio/mc` ne sont plus téléchargeables, quay.io est restreint). La stack prévoit MinIO en local et sur Coolify.

## Décision
Utiliser `pgsty/minio` (fork communautaire maintenu, construit depuis les sources AGPL, image UBI avec `mc` et `curl`), épinglé sur une release datée. Le code ne dépend que de l'API S3 (`@aws-sdk/client-s3`) : remplacer MinIO par Garage, SeaweedFS ou un S3 managé ne demande qu'un changement de variables.

## Conséquences
Le bucket `batimint-legal` est créé avec verrouillage d'objets, versionnement et rétention GOVERNANCE de 10 ans ([à valider] durée de conservation). Surveiller les mises à jour du fork.
