# ADR 0008 — Outbox, relais pg-boss et consommateurs idempotents

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
Règle n°3 et `docs/06` : outbox transactionnelle, pg-boss, LISTEN/NOTIFY, idempotence par consommateur.

## Décision
- L'API écrit `outbox_events` dans la transaction métier (`emitEvent`). Un trigger `NOTIFY outbox_new` réveille le relais au commit ; un balayage toutes les 2 s sert de filet.
- Le relais (`apps/worker/src/relay.ts`) verrouille les événements non publiés (`FOR UPDATE SKIP LOCKED`), crée **dans la même transaction** un job pg-boss par consommateur abonné (adaptateur Prisma de pg-boss) puis marque `published_at`.
- Chaque consommateur a sa file (`consumer.<nom>`), des retries à backoff exponentiel (10 essais, jusqu'à 15 min) et une file morte `dead-letter`. Il s'exécute dans le contexte RLS du tenant de l'événement ; `processed_events(consumer, event_id)` est inséré dans la même transaction que l'effet : rejouer ne double rien, échouer n'enregistre rien.
- Les messages temps réel sont publiés par `pg_notify('realtime')` **dans** la transaction du consommateur (livrés au commit) ; l'API les diffuse en SSE par canal autorisé.

## Conséquences
Livraison au moins une fois, effet exactement une fois par consommateur. Le schéma `pgboss` appartient au rôle applicatif (créé à la migration).
