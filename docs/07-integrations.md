# 07 — Intégrations

Règle commune : chaque intégration est une **interface** dans `packages/integrations`, avec une implémentation `mock` (par défaut, déterministe, utilisée en dev, en tests et en démo) et une implémentation réelle activée par variables d'environnement. L'état de connexion par tenant est visible dans « Paramètres → Intégrations », avec un bouton « Tester la connexion ». Les erreurs sont lisibles et rejouables.

Pour chaque intégration réelle, l'agent lit la documentation officielle à jour avant de coder. Les liens ci-dessous sont des points d'entrée.

## Peppol — getpeppr (mode Platform)
- **Pourquoi** : getpeppr propose un mode Platform pour les SaaS multi-tenant. Chaque client (tenant) devient une « legal entity » rattachée à notre compte maître ; pas besoin que chaque client ouvre un compte.
- **Compte** : déjà créé (organisation FAWD, mode Platform, sandbox). Clés en `PEPPOL_GETPEPPR_API_KEY` (sandbox `sk_sandbox_…`), `PEPPOL_GETPEPPR_WEBHOOK_SECRET`.
- **Interface** `PeppolProvider` :
  - `registerLegalEntity(tenant)` et `getLegalEntityStatus()` ;
  - `lookupParticipant(scheme, id)` ;
  - `sendInvoice(invoiceJson | ubl)` et `getDeliveryStatus(id)` ;
  - traitement des webhooks : facture reçue, changement de statut.
- Le SDK officiel est `@getpeppr/sdk`, et l'API prend du JSON qu'elle convertit en UBL avec validation versionnée. Nous générons **aussi** notre propre UBL BIS 3.0 pour l'archivage et les exports (voir `05`).
- En production, le client autorise via un lien signé (onboarding P1, étape Peppol).
- Docs : <https://getpeppr.dev/docs/platform/> · référence API <https://getpeppr.dev/reference/> · exemples <https://github.com/zerolooplabs/getpeppr-docs>

## Comptabilité — Chift (API unifiée)
- **Interface** `AccountingSync` : `connect(tenant)` (flux d'autorisation Chift), `pushSale`, `pushPurchase`, `pushPayment`, `listChartOfAccounts`, `listJournals`, `mapVatCodes`.
- Mapping des codes TVA belges et des comptes, paramétrable par tenant avec des valeurs par défaut sensées.
- Synchro déclenchée par événement (`invoice.issued`, `supplier_invoice.allocated`, `payment.received`), avec un statut par document.
- Docs : <https://docs.chift.eu>

## ONSS — Check In and Out at Work et 30bis
- `AttendanceRegistry` : `registerPresence(in|out, worker, workplace)` et `declareWorkplace(project)`.
- `ThirtyBisChecker` : `check(enterpriseNumber)` → `{hasSocialDebt, hasTaxDebt, checkedAt, proof}`.
- Les modalités d'accès logiciel aux services web de l'ONSS sont **[à valider]**. Livrer `mock` + export manuel ; la vraie implémentation suivra.
- Référence : <https://www.socialsecurity.be/site_fr/employer/applics/check-in-and-out-at-work/index.htm>

## Paiements — Mollie
- `PaymentLinkProvider` : `createLink(invoice)` (Bancontact, carte, virement), webhook de paiement vers `payment.received`.
- Clé par tenant (chaque entreprise encaisse sur son compte Mollie) via Mollie Connect, ou clé saisie manuellement en v1 **[ADR]**.
- Docs : <https://docs.mollie.com>

## Validation TVA — VIES
- `VatValidator.validate("BE0123456789")` → raison sociale et adresse si disponibles. API REST publique de la Commission européenne, avec cache et tolérance aux pannes (le formulaire reste utilisable).

## E-mail
- `Mailer` SMTP (Mailpit en dev), modèles React Email ou MJML, versions FR, éditables par tenant (objet et intro).
- E-mail entrant (demandes, factures PDF) : adresse par tenant (`<slug>@in.<domaine>`) via un webhook de fournisseur entrant (Postmark, Mailgun ou équivalent, à choisir par ADR) ; `mock` en dev.

## Stockage — S3
- `ObjectStorage` compatible S3 (MinIO), URL pré-signées, buckets `uploads` et `legal` (versionné, sans suppression).

## IA — Anthropic (optionnelle, désactivable par tenant)
- `AiAssistant` :
  - `draftQuoteLines(text, library)` → lignes proposées avec article de bibliothèque et score de confiance ;
  - `transcribe(audio)` → texte (fournisseur de transcription à choisir par ADR) ;
  - `extractInvoice(pdf)` → données structurées ;
  - `suggestAllocation(invoice, openProjects)` → chantier et poste classés.
- Toujours une validation humaine avant tout effet. Prompts versionnés dans le repo, sorties validées par zod, coûts journalisés par tenant.
- Variable `ANTHROPIC_API_KEY`. Sans clé, le `mock` renvoie des suggestions déterministes basées sur la recherche plein texte.
