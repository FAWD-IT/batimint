# ADR 0020 — Pilotage, trésorerie et synchronisation comptable

## Contexte
M11 livre le pilotage (03 §12, 02 P11) et la comptabilité via Chift (03 §13, 02 P12).

Contraintes :
- Les chiffres se recalculent toujours depuis les données (09).
- Les exports se font en CSV et Excel pour chaque liste.
- La comptabilité est synchronisée avec un statut par document et une reprise sur erreur.
- Le Comptable lit et exporte, sans rien modifier.
- Tout tourne sans clé externe (mock).

## Décisions

1. **Aucun agrégat stocké.**
   - « Aujourd'hui », le tableau de bord et les rapports sont calculés à la demande depuis les factures, paiements, achats, coûts des chantiers (`loadProjectNumbers`), planning et pointages.
   - Les règles (période, transformation, carnet, marges groupées, heures, trésorerie) sont des fonctions pures du domaine (`reporting.ts`).
   - Ce n'est pas un problème à l'échelle d'une PME. Un cache viendra si les budgets de performance de `06` l'exigent (M13).

2. **Indicateurs.**
   - **Marge d'un chantier** : vendu (contrat et avenants) moins coût projeté à terminaison, la même formule que le cockpit.
   - **CA facturé** : HTVA des factures émises dans la période, notes de crédit déduites.
   - **Encaissé** : paiements reçus dans la période.
   - **Encours** : solde des factures ouvertes. La retenue de garantie tenue n'est pas due ; la retenue libérée l'est.
   - **Carnet de commandes** : contrat moins facturé HTVA.
   - **Transformation des devis** : devis envoyés dans la période ; signés sur décidés (signés, refusés, expirés).
   - Les filtres équipe et responsable portent sur les chiffres des chantiers. Devis et trésorerie restent ceux de l'entreprise, ce que l'écran explique.

3. **Trésorerie à 90 jours**, par semaine.
   - Entrées :
     - factures émises, au solde et à l'échéance ;
     - retenues libérées, à leur échéance ;
     - retenues tenues, à la réception définitive prévue plus le délai de paiement ;
     - brouillons de chantiers actifs, à aujourd'hui plus le délai de paiement.
   - Sorties :
     - factures fournisseurs non payées (retenue 30bis déduite), à l'échéance ou à 30 jours ;
     - échéanciers de sous-traitance non facturés, à l'échéance plus 30 jours ;
     - salaires estimés, le dernier jour ouvré du mois. Le montant est le coût horaire employeur × 38 h × 52 / 12 **[à valider]**.
   - Une échéance dépassée est attendue aujourd'hui et signalée.
   - Le point de départ est le solde bancaire saisi (paramètre du tenant). Sans lui, on affiche le cumul des flux nets.
   - La TVA à payer n'est pas encore prévue (M12, avec la vraie synchro).

4. **Exports.**
   - Un descriptif de colonnes unique produit :
     - un CSV pour Excel belge : UTF-8 avec BOM, point-virgule, virgule décimale, montants exacts depuis les centimes ;
     - ou un classeur .xlsx (exceljs).
   - Chaque liste a son export, sous la permission de la liste ; les montants n'apparaissent que pour qui les voit.
   - Les exports du comptable sont par période : ventes par taux de TVA, achats, paiements, ZIP des UBL émis et des documents d'achat.
   - Le ZIP est écrit sans dépendance (méthode stockée, CRC32 de Node).

5. **Écritures comptables dans le domaine** (`accounting.ts`), toujours équilibrées.
   - **Vente** : client TVAC, chiffre d'affaires et TVA par code et grille belges (01/02/03, 45, 46, 47 ; TVA en 54). Une note de crédit inverse les sens.
   - **Achat** : charge (matériaux ou sous-traitance), TVA à récupérer (59), fournisseur. Un sous-traitant sans TVA facturée est en autoliquidation (87).
   - **Paiement** : banque contre client ou fournisseur. La retenue 30bis solde le fournisseur via un compte de retenues à verser.
   - Comptes PCMN, journaux et codes TVA par défaut **[à valider avec le comptable]**, paramétrables par tenant. Le paramétrage est rangé dans la connexion « accounting ».

6. **Synchronisation** (`AccountingSync`, mock « WinBooks (simulation) »).
   - Une ligne par document (vente, achat, encaissement, paiement fournisseur) porte :
     - le statut (`waiting`, `pending`, `synced`, `error`) ;
     - l'écriture envoyée, consultable par le comptable ;
     - l'identifiant de pièce, les tentatives et l'erreur lisible.
   - Les consommateurs réagissent à `invoice.issued`, `supplier_invoice.allocated`, `payment.received` et au nouvel événement `supplier_invoice.paid`.
   - Sans connexion, le document attend. La connexion rattrape les documents de l'exercice.
   - Une erreur est notifiée une fois par message (bureau et comptable). La reprise est manuelle, par document ou en masse, et ouverte au Comptable : elle ne modifie aucune donnée métier.
   - Seul l'administrateur change le paramétrage ou connecte.
   - Le mock refuse, avec un message qui dit quoi corriger :
     - un journal, un compte ou un code TVA inconnu ;
     - une écriture déséquilibrée ;
     - un numéro de TVA belge invalide.

7. **Carte des chantiers actifs** (03 §5, reportée du M4).
   - L'adaptateur `Geocoder` (mock par défaut, `GEOCODER_PROVIDER`) donne une position et sa précision. Le mock approche la localité par le code postal belge (province, puis décalage stable).
   - Une position approchée sert à la carte, jamais au contrôle de présence : elle n'est pas enregistrée sur le site.
   - Pas de fond de carte externe (pas de requête vers un serveur de tuiles, RGPD). Les chantiers sont placés sur un plan avec des villes de repère.
   - Marqueurs : couleur de la palette validée **et** forme par statut, plus la liste à côté.

8. **Couleurs de graphiques.** Trois jetons `--chart-1` à `--chart-3` sont ajoutés au design system (clair et sombre). Ils sont validés par le script du skill dataviz : bande de luminance, chroma, séparation daltonisme, contraste.

## Conséquences
- Le passage à Chift réel (M12) ne touche que l'adaptateur : écritures, statuts et reprises sont déjà en place.
- Les numéros d'entreprise du seed sont corrigés (préfixe 0 ou 1, BCE). Un numéro invalide est désormais visible en comptabilité.
