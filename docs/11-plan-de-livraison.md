# 11 — Plan de livraison

L'agent avance jalon par jalon. Un jalon est terminé quand **tous** ses critères de sortie passent réellement (tests, parcours joués, app démarrée). À chaque fin de jalon : mettre à jour `PROGRESS.md`, noter les ADR pris, faire un commit étiqueté `m<N>-done`, pousser la branche et signaler qu'elle est prête pour une PR vers `main` (Anthony merge, puis Coolify redéploie).

Ordre pensé pour avoir très tôt un fil complet devis → facture, puis l'enrichir.

| Jalon | Contenu | Critères de sortie |
|---|---|---|
| **M0 — Fondations** | Monorepo, outillage, docker compose dev (Postgres, MinIO, Mailpit), CI, `packages/domain` initialisé, Prisma + RLS + outbox + pg-boss, API squelette (health, OpenAPI), web squelette avec tokens et composants de base, auth, tenants, rôles, i18n, audit, Dockerfiles et `docker-compose.coolify.yml` qui démarrent, hook `.claude/hooks/session-start.sh` à jour, workflow GitHub Actions | `pnpm dev`, `pnpm test` et la CI passent ; test d'isolation RLS vert ; un événement test traverse outbox → worker → SSE → navigateur ; la stack Coolify démarre en local |
| **M1 — Entreprise et onboarding** | Paramètres entreprise, VIES, utilisateurs, invitations, équipes, employés, checklist d'onboarding, super-admin | P1 en E2E (hors Peppol réel, mock) |
| **M2 — CRM et bibliothèque** | Clients, contacts, sites, demandes (formulaire embarquable, e-mail entrant mock), opportunités kanban, visite technique, bibliothèque, ouvrages, import Excel/CSV, bibliothèques types | Import d'un fichier de 2 000 articles en moins de 30 s avec rapport ; recherche instantanée |
| **M3 — Devis et signature** | Éditeur de devis complet, calculs en direct, TVA automatique, options, acompte, versions, PDF, envoi, suivi, relance, portail client (devis), signature + attestation 6 %, dictée IA (mock) | P2 en E2E ; signer crée le chantier, les postes, les tâches et l'acompte (idempotent) |
| **M4 — Chantier pivot** | Page chantier (maquette cockpit), budget et marge en direct, timeline, documents et photos, avenants, tâches, temps réel, ⌘K | Page conforme à la maquette ; deux navigateurs synchronisés ; avenant (P5) en E2E |
| **M5 — Terrain** | Vue terrain PWA (maquette), pointage géolocalisé hors ligne, photos, signalements, bons de régie, rapport journalier, validation des heures par le chef | P4 en E2E sur mobile, y compris le test hors ligne |
| **M6 — Planning** | Planning glisser-déposer, conflits, notifications, iCal, date sur le portail | P3 en E2E |
| **M7 — Achats et Peppol entrant** | Fournisseurs, BC, réception, factures fournisseurs (Peppol mock + upload + extraction IA mock), rapprochement, boîte « À imputer », alertes de dérive | P6 en E2E ; 90 % des factures du seed imputées automatiquement |
| **M8 — Facturation et encaissement** | États d'avancement, toutes les factures, notes de crédit, numérotation, PDF + UBL valides, envoi Peppol (mock) ou e-mail, EPC QR + communication structurée, paiements, Mollie (mock), relances B2B/B2C, portail (approbation, paiement) | P7 et P8 en E2E ; UBL validés en test ; numérotation concurrente sans trou |
| **M9 — Sous-traitance et conformité** | Sous-traitants, documents, contrats, 30bis (mock), portail sous-traitant, Check In and Out (mock + export), déclaration de travaux | P9 en E2E ; les deux chemins 30bis testés |
| **M10 — Réception, stock, matériel** | PV provisoire et définitif, réserves, facture finale, libération de retenue, rapport de rentabilité, stock, matériel | P10 et P13 en E2E |
| **M11 — Pilotage et compta** | Aujourd'hui, tableau de bord, rapports, trésorerie 90 j, exports, synchro Chift (mock), rôle Comptable | P11 et P12 en E2E ; chiffres recalculés depuis les données |
| **M12 — Intégrations réelles** | Implémentations réelles getpeppr (sandbox), Chift, Mollie (test), Anthropic, SMTP, activées par variables | Bascule mock ↔ réel sans changement de code. Si le réseau de la session n'autorise pas encore ces API : implémentations testées contre des réponses enregistrées, plus un script `pnpm integrations:smoke` qu'Anthony lance avec les clés sandbox (envoi et réception d'une facture getpeppr). Sinon, le smoke test est joué directement |
| **M13 — Finition et mise en production** | Passe complète UX (tous les parcours rejoués), accessibilité, performance (budgets de `06`), sécurité (revue OWASP, rate limits), seed de démo final, doc Coolify complète, sauvegarde et restauration testées, README | Tous les E2E verts ; aucun axe critique ; budgets de perf tenus ; déploiement Coolify reproduit depuis la doc ; rapport final rédigé |

## Règles de priorisation si un arbitrage s'impose
1. Exactitude de l'argent et conformité, avant toute fonctionnalité.
2. Le fil continu devis → chantier → facture → paiement, avant les modules périphériques.
3. Une fonctionnalité finie et polie, avant deux à moitié faites.
4. Toute coupe de périmètre est notée dans `PROGRESS.md` avec sa raison.
