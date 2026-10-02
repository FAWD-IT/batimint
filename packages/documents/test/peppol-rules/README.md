# Règles de validation Peppol BIS Billing 3.0 (tests uniquement)

- `CEN-EN16931-UBL.sch` : règles EN 16931 (CEN/TC 434), version 1.3.15.
- `PEPPOL-EN16931-UBL.sch` : règles Peppol BIS Billing 3.0.

Source : <https://github.com/OpenPEPPOL/peppol-bis-invoice-3> (`rules/sch`), commit
`261c458474e27d58a25be629cccac28883171c92` du 2026-03-16. Licence : EUPL 1.2 (en-tête des
fichiers). Copie non modifiée, utilisée par `src/invoice-ubl.test.ts` via `node-schematron`.

Mettre à jour : remplacer les deux fichiers par ceux de la dernière version publiée et relancer
`pnpm --filter @batimint/documents test`.
