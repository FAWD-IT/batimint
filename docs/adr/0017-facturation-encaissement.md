# ADR 0017 — Facturation : états d'avancement, émission immuable, documents, paiements, relances

## Contexte
M8 livre la facturation et l'encaissement (03 §10, 05 §1 à §6, 02 P7 et P8).

Contraintes :
- Une facture émise est immuable, avec une numérotation continue et sans trou (règle n°4).
- L'écran, le PDF et l'UBL donnent les mêmes totaux (EN 16931).
- Le client approuve l'état d'avancement (B2C).
- Paiement par virement (QR EPC et communication structurée) ou en ligne (Mollie).
- Relances selon le régime B2B ou B2C.

## Décisions

1. **Un seul modèle `Invoice`** pour les factures (acompte, avancement, régie, finale, libre) et les notes de crédit (`type = credit_note`, `creditedInvoiceId`).
   - Deux séries de numéros : `invoice` et `credit_note`.
   - Le numéro est pris dans la séquence verrouillée (`nextSequenceValue`) au moment de l'émission, jamais avant : un brouillon supprimé ne laisse aucun trou.
   - Testé avec 100 émissions concurrentes.

2. **Émission = gel.** Au moment de l'émission, on fige :
   - le numéro, la date d'émission et l'échéance ;
   - les parties (vendeur et acheteur) et la ventilation TVA ;
   - les mentions : autoliquidation, 6 % avec la date de l'attestation, retenue de garantie ;
   - la communication structurée (préfixe tenant + année + séquence) ;
   - la retenue de garantie.

   Le PDF et l'UBL sont rangés dans le compartiment `legal` avec leur empreinte SHA-256. Un **déclencheur Postgres** refuse ensuite toute modification de ces champs et des lignes. Il double la règle de l'API ; seuls le statut, l'acheminement et les paiements évoluent.

   Les freins à l'émission sont affichés avant l'émission, avec la solution :
   - numéro d'entreprise ou IBAN manquant ;
   - 6 % sans attestation signée ;
   - autoliquidation sans numéro de TVA du client ;
   - total négatif.

3. **États d'avancement.**
   - Le cumul est saisi par poste, en %, en quantité (si toutes les lignes du poste ont la même unité) ou en €. Il est pré-rempli par l'avancement des tâches cochées, jamais en dessous de ce qui est déjà facturé.
   - Le cumul ne peut pas descendre sous l'état précédent : une régularisation se fait par note de crédit.
   - L'approbation est requise selon les paramètres du tenant : par défaut oui pour un particulier, non pour une entreprise.
   - Si elle est requise, l'état est soumis, et le client l'approuve ou le conteste sur son portail.
   - Une fois approuvé, la facture est générée en brouillon, dans la même transaction que l'approbation.

4. **Facture d'avancement.**
   - Une ligne par poste et par taux de TVA. Un poste mixte est réparti au prorata des ventes du poste (devis et avenants signés).
   - L'acompte est **déduit au prorata** de la période (acompte × période / contrat), par taux.
   - La facture qui atteint 100 % déduit tout le solde de l'acompte.
   - La déduction est une ligne en quantité −1 avec un prix positif (BR-27).

5. **Retenue de garantie.**
   - C'est un pourcentage du TVAC, retenu au paiement : la facture garde sa base et sa TVA, et seul le « reste à payer » diminue.
   - L'UBL la porte en note, et PayableAmount reste le TVAC (BR-CO-16).
   - La libération arrive avec la réception définitive (M10).

6. **UBL Peppol BIS Billing 3.0.**
   - Il est généré par `buildInvoiceUbl` à partir des mêmes totaux que l'écran.
   - Il est **validé en test par les règles officielles** EN 16931 et Peppol (schematron OpenPEPPOL, EUPL), exécutées en JavaScript (`node-schematron`). Les fonctions utilitaires XSLT du schematron Peppol sont réimplémentées.
   - Un particulier n'a pas d'adresse Peppol : son UBL d'archive omet `EndpointID`, et seule la règle PEPPOL-EN16931-R010 est alors non satisfaite (sa facture part par e-mail).
   - Un test de propriété vérifie que l'écran et l'UBL donnent les mêmes totaux sur 1 000 factures aléatoires.

7. **Acheminement** (consommateur `invoice.issued`).
   - On cherche le client dans l'annuaire Peppol (schéma 0208 + BCE).
   - S'il est joignable et que l'entreprise est active chez le fournisseur d'accès : envoi Peppol, puis suivi de livraison par une tâche planifiée qui lit le statut et émet `invoice.delivery_updated`.
   - Sinon : e-mail vouvoyé avec le PDF (et l'UBL pour une entreprise), la communication structurée et un lien vers le portail.
   - Sans adresse e-mail : l'envoi est signalé en échec avec une notification au bureau.

8. **Paiements.**
   - Saisie manuelle, partielle ou totale. Le paiement est idempotent par identifiant client, et un trop-perçu est refusé.
   - Un paiement manuel se corrige en annulant ce paiement (pas de suppression de facture).
   - **Lien de paiement** via `PaymentLinkProvider` : `mock` par défaut, avec une page de paiement simulée de l'application ; Mollie au M12.
   - Le webhook ne croit jamais le corps reçu : il relit le statut chez le prestataire. L'identifiant du prestataire empêche un double enregistrement.
   - Un paiement couvre une seule facture. Pour un virement groupé, on saisit un paiement par facture (le lettrage multi-factures viendra avec la synchronisation bancaire, hors périmètre).

9. **Relances.**
   - Une tâche quotidienne (9 h) émet `invoice.reminder_due`, une étape à la fois, selon le calendrier du tenant (J+3, J+15, J+30 par défaut). La dernière étape est une mise en demeure.
   - L'étape est enregistrée en base de façon unique (facture, étape), et rien ne part pour une facture soldée ou dont les relances sont suspendues.
   - **B2B** : indemnité forfaitaire et intérêts (loi du 2 août 2002) si activés.
   - **B2C** : premier rappel gratuit, puis frais plafonnés par le Code de droit économique.
   - Les taux et plafonds sont des paramètres **[à valider]**.

10. **Notes de crédit.**
    - Totale (toutes les lignes) ou partielle (un montant par ligne d'origine). Le total crédité ne dépasse jamais le net de la facture.
    - Une facture entièrement créditée sans paiement passe « annulée ».
    - Le facturé du chantier compte les notes de crédit en négatif.

## Conséquences
- Le seed facture Dupont par trois états d'avancement approuvés par M. Dupont (2026-116 à 118, payables à réception). La facture 2026-118 est échue depuis 3 jours, avec le premier rappel envoyé. La numérotation est continue de 2026-099 à 118.
- La conformité belge est codée dans `packages/domain/src/invoicing.ts`. Les points **[à valider]** (taux légaux, frais B2C, délai d'émission, placement de la communication structurée dans le QR EPC) sont listés dans `PROGRESS.md`.
