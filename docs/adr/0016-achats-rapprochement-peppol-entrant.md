# ADR 0016 — Achats : bons de commande, rapprochement des factures fournisseurs, Peppol entrant

## Contexte
M7 livre les achats (03 §8, 02 P3.3 et P6).
- Sophie commande les matériaux du devis, un bon par fournisseur.
- Les factures fournisseurs arrivent par Peppol (webhook du fournisseur d'accès) ou hors Peppol (PDF, photo ou XML déposé).
- Ces factures doivent s'imputer **seules** au bon chantier et au bon poste.
- La marge du chantier doit se recalculer, une entrée doit apparaître dans la timeline, et une alerte doit partir en cas de dérive ou d'écart.
- Ce qui reste incertain va dans une boîte « À imputer ».

## Décisions
1. **Rapprochement déterministe d'abord** (`matchSupplierInvoice`, domaine pur), dans l'ordre de P6 :
   - **Numéro de BC** (dans la référence de commande UBL, les remarques ou les lignes) : confiance 0,99, ou 0,9 si le fournisseur diffère.
   - **Référence du chantier**, seulement si un seul chantier correspond : confiance 0,95.
   - **Adresse de livraison** (rue + code postal), seulement si un seul chantier correspond : confiance 0,85.
   - Sinon, l'IA classe des **suggestions** (chantier, poste, score, raison). Une suggestion IA n'impute jamais automatiquement : la facture va dans « À imputer », avec une notification au bureau. Valider se fait en un clic ou en ventilant.
2. **Ventilation.** Une facture se répartit en `CostAllocation` (chantier, poste facultatif, montant).
   - La somme des montants doit égaler le total HTVA de la facture, au centime près. L'API le vérifie.
   - Le rapprochement par BC répartit les lignes sur les postes du BC (`pairLine` par code fournisseur, puis par similarité de libellé). Le reste va au poste principal du BC.
3. **Grand livre unique.** Les effets sur la marge passent par `ProjectCost`, écrit uniquement par des consommateurs idempotents :
   - Une ligne `supplier_invoice` par ventilation (`sourceId = facture:ventilation`).
   - Un **engagement** `purchase_order` par BC et par poste, égal à ce qui reste non facturé (`commandé − facturé`, jamais négatif). Il est recalculé à l'envoi, à la réception, à l'annulation et à chaque imputation.
   - Ainsi, un BC envoyé pèse sur le budget dès l'envoi, sans double comptage à l'arrivée de la facture.
   - La timeline ne montre pas ces écritures comptables : elle montre l'événement métier (BC envoyé, facture reçue et imputée, écart).
4. **Écarts BC ↔ facture** (`compareWithOrder`) :
   - Prix unitaire ou quantité au-delà d'une **tolérance de 2 %**.
   - Ligne non commandée.
   - Total.
   - Les écarts sont stockés sur la facture, affichés dans le détail et notifiés au bureau, mais **ne bloquent pas** l'imputation : Sophie décide, et peut bloquer la facture.
5. **Statuts de la facture** (machine d'états du domaine) : reçue → à imputer ↔ imputée → validée → à payer ↔ bloquée → payée.
   - Une facture validée ne se ventile plus. Il faut la rouvrir pour la réimputer.
   - Le contrôle 30bis avant « à payer » d'une facture de sous-traitant arrive avec M9 (sous-traitance).
6. **Peppol entrant.**
   - Le webhook est public, avec une signature vérifiée sur le corps brut (plugin Fastify séparé). L'entité légale désigne le tenant, et `externalId` déduplique (`@@unique([tenantId, externalId])`).
   - Le document UBL est rangé dans le compartiment `legal`, puis lu par `parseUbl` (Peppol BIS 3).
   - En mode `mock`, `POST /integrations/peppol/simulate-inbound` fabrique un UBL et suit **exactement** le chemin du webhook. Il sert pour la démo et les E2E, et il est refusé avec un fournisseur réel.
   - Le dépôt hors Peppol (PDF ou photo) passe par l'extraction IA (adaptateur `ai`, `mock` par défaut), puis suit le même rapprochement. Un XML déposé est lu comme de l'UBL.
7. **Bons de commande.**
   - Ils sont créés en brouillon avec un identifiant client (idempotent), depuis la proposition du devis ou à la main.
   - À l'envoi, ils reçoivent un **numéro BC continu** par tenant et par année (séquence `purchase_order`, motif `BC{YYYY}-{SEQ:3}`). Ce numéro est porté sur le PDF et dans l'e-mail : c'est lui que le fournisseur reporte sur sa facture.
   - Le PDF est régénéré à la demande s'il manque (reprise de données, stockage perdu).
   - **Proposition** : ce sont les lignes des sections retenues du devis courant (obligatoires, et options choisies) qui sont des matériaux. Ce sont soit des articles « matériau », soit des lignes libres sans main-d'œuvre. Elles sont groupées par fournisseur préféré de l'article, et les lignes déjà commandées sont marquées (`sourceKey`).
8. **Fournisseurs.**
   - Le numéro BCE donne le numéro de TVA et l'identifiant Peppol (`0208:`).
   - Les fournisseurs sont lisibles avec `purchases.read` (bureau, chef de chantier, comptable) et modifiables avec `purchases.write`.

## Conséquences
- Le seed convertit les coûts « factures fournisseurs » de M4 en vraies factures rapprochées, avec les mêmes montants : les marges ne bougent pas.
  - 61 des 63 factures sont imputées automatiquement (97 %).
  - Deux factures attendent dans « À imputer ».
  - Trois BC restent ouverts (engagement).
  - Le BC du carrelage de Dupont est le `BC{année}-417`.
- La boîte « À imputer » est l'unique file de travail humaine des achats. Tout le reste arrive déjà imputé.
- Le paiement réel des factures fournisseurs (virements, rapprochement bancaire) reste hors périmètre (open banking exclu). « Payée » est posé à la main ou par la synchro comptable (M11).
