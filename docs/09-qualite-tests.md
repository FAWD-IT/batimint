# 09 — Qualité, tests et données de démo

## Pyramide de tests
| Niveau | Outil | Ce qui est couvert | Exigence |
|---|---|---|---|
| Domaine | Vitest + tests de propriété (fast-check) | Montants, TVA, arrondis EN 16931, marges, transitions d'état, numérotation, communication structurée, rapprochement, permissions | ≥ 90 % de lignes, 100 % des règles de `05` citées dans un test |
| Intégration API | Vitest + Postgres réel (Testcontainers ou service CI) | Chaque route : droits, validation, effets en base, outbox écrite, isolation RLS | Toutes les routes |
| Consommateurs | Vitest | Chaque consommateur : effet attendu, idempotence (rejeu = aucun double effet), reprise sur erreur | Tous les consommateurs |
| Contrats | Vitest | UBL généré valide (schematron EN 16931/Peppol), OpenAPI cohérent avec les schémas | Factures, notes de crédit, autoliquidation, 6 %, multi-taux |
| E2E | Playwright | Les parcours P1 à P13 de `02`, chacun avec son persona, desktop + mobile (viewport 390×844 pour terrain et portail) | Tous les parcours |
| Temps réel | Playwright (2 contextes) | Une action dans un contexte apparaît dans l'autre sans recharger | Page chantier, portail, boîte « À imputer » |
| Accessibilité | axe-core dans Playwright | Aucune violation critique ou sérieuse | Tous les écrans parcourus |
| Visuel | Captures Playwright | Écrans clés comparés aux maquettes (revue humaine, pas de diff bloquant) | Cockpit, terrain, portail |

## Tests qu'on oublie et qu'on veut
- **Isolation multi-tenant** : un utilisateur du tenant A, avec un ID valide du tenant B, reçoit 404 sur chaque ressource.
- **Ouvrier** : aucune réponse API ne contient de prix, coût ou marge.
- **Facture émise** : toute tentative de modification est refusée, et la numérotation reste continue sous concurrence (100 émissions parallèles, zéro trou ni doublon).
- **Hors ligne** : 10 pointages et photos créés sans réseau, synchronisés une seule fois au retour.
- **Rejeu** : rejouer toute la file d'événements d'un tenant ne change pas l'état final.
- **Portail** : un jeton révoqué ou expiré ne donne plus accès ; un jeton ne donne accès qu'à son chantier.
- **Calcul** : les totaux de l'écran, du PDF et de l'UBL sont identiques pour 1 000 devis générés aléatoirement.

## Tenant de démonstration (seed)
`pnpm db:seed` crée « Rénov'Habitat SRL » (Charleroi) avec les personas de `02` (comptes avec mots de passe documentés dans le README, uniquement en dev), et :
- les bibliothèques types (rénovation, toiture, électricité, sanitaire) ;
- environ 40 clients et 25 chantiers dans tous les statuts, dont le chantier **Dupont** des maquettes à 62 % :
  - marge prévue 24 % et réelle 21,8 % ;
  - poste Carrelage en dérive ;
  - facture 2026-118 échue ;
  - avenant n°3 en attente ;
- des devis à tous les stades, des factures fournisseurs reçues par Peppol (dont deux dans « À imputer »), des sous-traitants (dont un avec dette 30bis simulée et un document expiré), un planning sur 3 semaines, du stock et du matériel ;
- un chantier ≥ 500 000 € soumis à Check In and Out.

Les données doivent être cohérentes : les chiffres du tableau de bord se recalculent à partir des données, sans valeur codée en dur. Le seed est idempotent (`--reset` pour repartir de zéro).

## CI (GitHub Actions)
Sur chaque push : install (cache pnpm), lint, typecheck, tests domaine et intégration (service Postgres), build, E2E Playwright (app démarrée via docker compose), rapport Playwright en artefact. Le build des images Docker de production doit passer.

## Revue avant chaque fin de jalon
L'agent lance l'app, joue les parcours concernés en se mettant à la place du persona et note dans `PROGRESS.md` ce qui est perfectible. Il corrige ce qui gêne vraiment avant de passer au jalon suivant.
