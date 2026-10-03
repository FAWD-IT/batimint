# ADR 0009 — Police Geist auto-hébergée, tokens dérivés

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
`design/tokens.css` (source de vérité) importe Geist depuis Google Fonts. Un `@import` distant au milieu du CSS compilé est invalide, charger des polices depuis Google pose un problème RGPD connu dans l'UE, et le build ne doit pas dépendre du réseau.

## Décision
Geist est embarquée via le paquet officiel `geist` (`next/font/local`). `scripts/sync-tokens.mjs` dérive `packages/ui/src/tokens.css` de `design/tokens.css` en retirant l'import distant ; la CI vérifie la synchronisation (`--check`).

## Conséquences
Modifier un token se fait dans `design/tokens.css` puis `node scripts/sync-tokens.mjs`.
