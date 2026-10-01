# ADR 0012 — Devis : versions, PDF, portail et signature (M3)

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
`docs/03` §4, `docs/04` (cycle du devis), `docs/05` §3, §4 et §10 : devis par postes, options choisies par le client, TVA par ligne avec attestation 6 %, versions après envoi, PDF aux couleurs du tenant, portail sans compte, signature électronique simple avec preuve, et à la signature : chantier, postes, tâches et acompte, de manière idempotente.

## Décision
- **Modèle** : `Quote` (en-tête stable) → `QuoteVersion` (contenu, totaux mis en cache, PDF figé) → `QuoteSection` / `QuoteLine` portant une **clé stable** d'une version à l'autre (comparatif, postes budgétaires, tâches). Toute modification d'une version envoyée crée la version suivante ; la précédente passe « remplacée ». Concurrence optimiste par `revision`.
- **Calculs** : `computeQuote` (domaine pur) sert l'éditeur (calcul instantané dans le navigateur), l'API, le portail, le PDF et le worker. La remise globale est appliquée comme remise de ligne combinée `1 − (1 − a)(1 − b)` pour que la TVA reste calculée par catégorie sur des nets remisés (05 §4).
- **TVA** : le régime proposé vient de `determineVatRegime` (client, logement, âge) ; un article peut imposer son taux. Tout écart exige une justification (≥ 5 caractères), tracée dans le journal d'audit.
- **PDF** : nouveau paquet `@batimint/documents` (pdfkit, polices Geist embarquées sous licence OFL, copiées dans les images Docker). Rendu **déterministe** (date de création = date d'émission ou de signature) : l'empreinte SHA-256 d'un document est reproductible et prouvable. Le PDF envoyé est stocké ; le PDF signé va dans le bucket `legal` et c'est exactement lui qui est servi ensuite.
- **Portail** : lien par jeton aléatoire de 256 bits, seule l'empreinte est stockée (`PortalToken`), créé par le consommateur au moment de l'envoi (comme les invitations). Le client voit toujours la **dernière version envoyée** ; une version en préparation reste interne. Pas de prix de revient dans les réponses du portail.
- **Signature** (05 §10) : nom déclaré, case d'acceptation, tracé manuscrit facultatif (le nom saisi tient lieu de signature pour l'accessibilité), horodatage, IP, navigateur et empreinte du PDF signé. Table `signatures` en ajout seul (déclencheur). L'attestation 6 % est signée dans le même flux ; un logement de moins de 10 ans est refusé. L'interface `SignatureProvider` d'une signature qualifiée (itsme) reste ouverte.
- **Effets** (règle 3) : `quote.sent` → lien de portail et e-mail avec le PDF ; `quote.viewed/signed/refused/expired` → fil chronologique, notifications, temps réel ; `quote.signed` → chantier (`CH{YYYY}-{SEQ:3}`), un poste budgétaire par poste retenu, une tâche par ligne chiffrée, facture d'acompte en brouillon répartie sur les taux du devis, prospect → client, affaire gagnée. Idempotence double : `ProcessedEvent` et `Project.quoteId` unique.
- **Relances** : une tâche planifiée pg-boss (toutes les 15 min) émet `quote.reminder_due` à J+7 (une fois) et `quote.expired` à l'échéance ; les e-mails restent dans les consommateurs.
- **Dictée** : la recherche floue présélectionne des candidats de la bibliothèque, l'assistant IA (mock par défaut) propose des lignes, validées une par une dans l'éditeur. La voix utilise la reconnaissance vocale du navigateur quand elle existe.

## Conséquences
Les écrans, le PDF et la signature reposent sur les mêmes calculs, testés par propriété. Un devis signé est immuable : la suite passe par les avenants (M4). Les mentions légales (autoliquidation, 6 %, attestation) sont marquées « à valider » dans `PROGRESS.md`.
