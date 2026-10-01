# 04 — Modèle de domaine et événements

Ce document fixe les concepts, leurs relations, les cycles de vie et les événements. Le schéma Prisma exact est à concevoir par l'agent à partir d'ici, avec les conventions suivantes.

Chaque table métier porte `id` (UUIDv7), `tenant_id`, `created_at`, `updated_at`, `created_by` et une politique RLS. Les montants sont des `bigint` en centimes, les quantités des `numeric(14,4)`, les taux des `numeric(6,4)`.

## Entités principales

**Plateforme et organisation**
- `Tenant` (entreprise : BCE, TVA, IBAN, branding, paramètres, plan, flags)
- `User` (global), `Membership` (user × tenant × rôle)
- `Employee` (peut exister sans compte utilisateur)
- `Team`, `Absence`

**Commercial**
- `Customer` (particulier | entreprise, assujetti, peppol_id), `Contact`, `Site` (adresse de chantier)
- `Lead` (demande brute), `Opportunity`, `SiteVisit` (photos, mesures, notes)

**Bibliothèque**
- `Item` (type, unité, achat, vente, TVA, temps de pose), `Assembly` (ouvrage) + `AssemblyComponent`, `PriceHistory`, `Supplier`, `SupplierPrice`

**Devis**
- `Quote` (en-tête stable), `QuoteVersion` (contenu figé par version), `QuoteSection`, `QuoteLine`
- `QuoteOption` (choix du client)
- `Signature` (objet signé, preuve, empreinte), `VatCertificate` (attestation 6 %)

**Chantier**
- `Project` (le chantier), `BudgetLine` (une par poste, alimentée par devis et avenants)
- `Task`, `ChangeOrder` (avenant, porte ses propres lignes), `PriceRevisionFormula`, `PriceIndexValue`
- `Reception` (provisoire | définitive) + `Reservation`
- `TimelineEntry` (projection lisible des événements), `Comment`, `Attachment` (photo/document, visibilité client)

**Terrain**
- `ScheduleSlot` (planning), `TimeEntry` (pointage IN/OUT, géoloc, source, hors ligne), `DailyReport`, `Issue` (signalement), `WorkOrder` (bon de régie signé)

**Achats**
- `PurchaseOrder` + lignes, `GoodsReceipt`
- `SupplierInvoice` (source : peppol | upload | email), lignes, `CostAllocation` (ventilation vers projet × poste)

**Sous-traitance**
- `Subcontract`, `SubcontractorDocument` (échéance), `Check30bis` (résultat, horodatage, montant retenu)

**Facturation**
- `ProgressStatement` (état d'avancement) + lignes par poste
- `Invoice` (type : acompte | avancement | régie | finale | libération_retenue | libre), lignes, `CreditNote`
- `NumberSequence` (par tenant × type × année, verrouillée en transaction)
- `Payment`, `PaymentAllocation`, `PaymentLink`, `DunningStep`, `DeliveryStatus` (peppol/e-mail)

**Stock**
- `StockLocation`, `StockMovement`, `Equipment`, `EquipmentAssignment`, `MaintenanceEvent`

**Technique**
- `OutboxEvent`, `ProcessedEvent` (idempotence par consommateur), `Notification`, `AuditLog`, `IntegrationConnection` (état par tenant et par fournisseur), `PortalToken` (lien signé, portée, expiration, révocation), `IdempotencyKey`

## Calcul budgétaire (définition unique, dans `packages/domain`)
- **Budgété(poste)** = Σ lignes du devis signé sur ce poste + Σ avenants signés.
- **Engagé(poste)** = Σ factures fournisseurs imputées + Σ BC non encore facturés + Σ heures × coût horaire chargé + Σ sorties de stock + Σ coût d'usage matériel + Σ sous-traitance contractée.
- **Facturé(poste)** = Σ montants HTVA des factures émises attribués au poste (notes de crédit déduites).
- **Marge réelle estimée** = (contrat − coût projeté) / contrat. Le coût projeté vaut max(engagé, budgété × avancement) par poste, pour ne pas afficher une marge flatteuse en début de chantier. Documenter la formule dans l'UI (infobulle).
- **Alerte de dérive** si un poste a un engagé > budgété × (1 + seuil), seuil paramétrable (défaut 10 %).

## Cycles de vie
- **Devis** : brouillon → envoyé → vu → signé | refusé | expiré. Modifier après envoi crée une nouvelle version, et la version précédente devient « remplacée ».
- **Avenant** : brouillon → envoyé → signé | refusé.
- **Chantier** : préparation → en cours ⇄ suspendu → réception provisoire → réception définitive → clôturé.
- **État d'avancement** : brouillon → soumis → approuvé | contesté → facturé.
- **Facture** : brouillon → émise (numéro définitif, immuable) → envoyée → livrée → partiellement payée → payée. Elle peut passer « en retard » selon l'échéance, et une note de crédit l'annule totalement ou partiellement.
- **Facture fournisseur** : reçue → à imputer → imputée → validée → à payer → payée. Elle peut être bloquée par le 30bis.
- **Pointage** : enregistré localement → synchronisé → validé (par le chef) → transmis ONSS (si applicable).

Les transitions sont implémentées comme fonctions pures dans `packages/domain`, qui refusent les transitions illégales. Elles sont testées exhaustivement.

## Catalogue d'événements (outbox)
Format : `{ id, tenant_id, type, aggregate_type, aggregate_id, payload, actor, occurred_at, version }`. Les types sont versionnés (`quote.signed.v1`).

| Événement | Consommateurs (idempotents) |
|---|---|
| `lead.received` | créer l'opportunité, notifier le bureau |
| `quote.sent` / `quote.viewed` | timeline, planifier la relance |
| `quote.signed` | créer le chantier, ses postes et tâches ; facture d'acompte en brouillon ; convertir le prospect ; notifier ; portail client |
| `change_order.signed` | mettre à jour le budget et le contrat, timeline, portail |
| `schedule.updated` | notifier les ouvriers, mettre à jour la date sur le portail |
| `time_entry.created` | coût main-d'œuvre sur le budget, timeline, portail (« équipe sur place »), ONSS si applicable |
| `task.completed` | avancement du poste, timeline |
| `issue.reported` | alerte bureau, proposition d'avenant |
| `photo.added` | timeline, portail si visible |
| `purchase_order.sent` | timeline, engagé sur le budget |
| `supplier_invoice.received` | rapprochement automatique, puis `supplier_invoice.allocated` ou mise en boîte « À imputer » |
| `supplier_invoice.allocated` | engagé sur le budget, alerte de dérive, synchro compta |
| `subcontract.payment_requested` | contrôle 30bis |
| `progress_statement.submitted` / `.approved` | portail client / génération de la facture |
| `invoice.issued` | envoi Peppol ou e-mail, synchro compta, timeline, relances planifiées |
| `invoice.delivery_updated` | statut, timeline |
| `payment.received` | lettrage, stop relances, encaissé sur le budget, synchro compta, portail |
| `stock.moved_to_project` | engagé sur le budget |
| `reception.signed` | statut chantier, tâches de réserves, facture finale en brouillon |
| `budget.drift_detected` | notification Owner/Bureau, entrée timeline |

## Temps réel
Chaque consommateur qui modifie une projection visible publie un message léger (`{tenant_id, channel, ref}`) via `pg_notify`. L'API diffuse en SSE par canal autorisé (`project:{id}`, `tenant:{id}:inbox`, `portal:{token}`) et le front invalide les requêtes concernées.
