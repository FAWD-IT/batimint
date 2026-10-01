# 05 — Conformité belge

La conformité doit être **portée par le produit**. Chaque règle ci-dessous est codée dans `packages/domain` avec des tests qui citent la règle.

Les points marqués **[à valider]** sont des hypothèses à confirmer par un comptable ou un juriste avant la mise en production. Implémente-les de manière paramétrable et liste-les dans `docs/PROGRESS.md` (section « À valider métier »).

## 1. Facturation électronique Peppol
- Obligatoire depuis le 1er janvier 2026 pour les factures B2B entre assujettis belges.
- E-reporting TVA annoncé pour le 1er janvier 2028 : garder des données de facturation structurées et propres dès maintenant.
- Format **Peppol BIS Billing 3.0** (norme EN 16931), UBL 2.1, factures et notes de crédit. Identifiant belge d'un participant : schéma `0208` + numéro BCE (10 chiffres).
- **Avant d'envoyer**, vérifier dans l'annuaire Peppol que le destinataire est joignable ; sinon, e-mail avec PDF.
- **Réception** : les factures entrantes arrivent par webhook du fournisseur d'accès (getpeppr) et suivent le parcours P6.
- **Validation** : toute facture sortante passe la validation du fournisseur. En local, valider aussi le XML produit avec les règles EN 16931 / Peppol (schematron) dans les tests.

## 2. Mentions et règles de facture
- Numéro unique, continu, sans trou, par série et par année. Une facture émise est immuable : corrections par note de crédit référencée.
- Mentions : date d'émission, date de la prestation ou période, identité, adresse et n° TVA du prestataire et du client (si assujetti), description, quantité, prix unitaire HTVA, base et montant de TVA par taux, total TVAC, échéance, IBAN et communication structurée.
- Délai d'émission : au plus tard le 15e jour du mois suivant la prestation **[à valider]**. Afficher une alerte quand un état d'avancement approuvé n'est pas facturé à temps.
- Conservation : 10 ans **[à valider]**. Les PDF et UBL émis sont stockés de manière immuable (bucket versionné, empreinte en base).

## 3. Taux et régimes de TVA (détermination automatique, forçable avec justification)
| Situation | Régime | Code UBL |
|---|---|---|
| Travaux immobiliers pour un assujetti belge qui dépose des déclarations périodiques | **Autoliquidation** : pas de TVA facturée, mention « Autoliquidation » + référence légale **[à valider]** | `AE` |
| Rénovation d'un logement privé de plus de 10 ans, facturée au consommateur final | **6 %** avec attestation du client (formulaire ou mention selon la règle en vigueur **[à valider]**) | `S` (6 %) |
| Autres cas | **21 %** | `S` |
| Cas particuliers paramétrables : 12 %, 0 %, exonéré, intracommunautaire | selon paramétrage | selon le cas |

- Le régime se décide **par ligne** (un devis peut mixer 6 % et 21 %, par exemple matériaux non éligibles **[à valider]**).
- L'attestation 6 % est signée par le client dans le portail (parcours P2) et liée au chantier. Sans attestation signée, le 6 % ne peut pas être émis : l'utilisateur doit passer en 21 % ou faire signer.

## 4. Arrondis (EN 16931)
- Montant net de ligne = quantité × prix unitaire − remise, arrondi à 2 décimales.
- TVA calculée **par catégorie et taux** sur la somme des montants nets de la catégorie, arrondie à 2 décimales.
- Totaux = sommes de valeurs déjà arrondies. Les mêmes fonctions servent pour le PDF, l'UBL et l'écran. Un test de propriété vérifie que PDF, UBL et écran donnent toujours les mêmes totaux.

## 5. Paiement : communication structurée et QR code
- Communication structurée belge : 10 chiffres de base + 2 chiffres de contrôle (base mod 97, 97 si le reste vaut 0), au format `+++123/4567/89012+++`. Générée par facture et utilisée pour le lettrage.
- QR code de virement **EPC (SEPA Credit Transfer, version 002)** sur le PDF : bénéficiaire, IBAN, BIC, montant, communication structurée.

## 6. Retards de paiement et relances
- **B2B** : intérêts de retard légaux et indemnité forfaitaire de la loi relative aux retards de paiement dans les transactions commerciales **[à valider : taux et montants à jour]**, activables par tenant.
- **B2C** : règles du Code de droit économique pour les dettes des consommateurs **[à valider]** : premier rappel gratuit, délai minimum avant tout frais, frais plafonnés. Le moteur de relances applique automatiquement le bon régime selon le type de client.

## 7. Sous-traitance : article 30bis (dettes sociales et fiscales)
- Avant de conclure le contrat **et** avant chaque paiement, vérifier si le sous-traitant a des dettes sociales ou fiscales (consultation des services en ligne ONSS et SPF Finances).
- En cas de dette, retenir le pourcentage légal (social 35 %, fiscal 15 % du montant HTVA **[à valider]**) et le verser aux administrations. Le système calcule, bloque le paiement normal et génère le document de versement.
- Conserver la preuve de chaque consultation (horodatage, résultat).
- La déclaration de travaux est requise selon des seuils et activités définis par l'ONSS **[à valider]**. Le système signale quand elle est probablement requise et pré-remplit les données.
- Adaptateur `ThirtyBisChecker` avec un `mock` qui renvoie des cas « sans dette » et « avec dette » selon le numéro, pour tester les deux chemins.

## 8. Check In and Out at Work (enregistrement des présences)
- À partir du **1er avril 2027**, l'enregistrement des présences **IN et OUT** est obligatoire pour les travaux immobiliers (hors nettoyage) sur les lieux de travail dont le montant total HTVA est **≥ 500 000 €**. Il remplace Checkinatwork pour ces travaux.
- Le seuil s'apprécie sur **le chantier entier**, pas sur notre seul contrat : un champ « montant total du chantier » est donc à saisir sur le projet si nous sommes sous-traitants.
- L'enregistrement se fait avant le début du travail (IN) et à la fin (OUT), pour chaque travailleur, y compris les sous-traitants indépendants.
- Le pointage de la vue terrain alimente un adaptateur `AttendanceRegistry` (ONSS). La vraie connexion demande un accès au service web de l'ONSS **[à valider : modalités d'accès logiciel]**. Livrer d'abord le `mock` et un export de secours.
- Les échecs de transmission sont visibles et rejouables. Rien n'est perdu.

## 9. RGPD
- **Géolocalisation** : uniquement au moment du pointage, pas de suivi continu. Finalité affichée à l'ouvrier.
- **INSS des employés** : chiffré au repos (chiffrement applicatif), visible seulement par Owner et Admin.
- **Droits** : export des données d'un client sur demande ; effacement limité par les obligations légales (factures conservées, données anonymisées ailleurs).
- **Sous-traitants de données** listés (hébergeur, e-mail, IA, Peppol) ; données hébergées dans l'UE.
- **Journal d'accès** aux données sensibles.

## 10. Signature électronique
Une signature électronique simple (eIDAS) suffit pour les devis, avenants, bons et PV entre particuliers et PME. Preuve conservée : identité déclarée, horodatage, IP, user-agent, empreinte SHA-256 du document. Une signature qualifiée (itsme) est hors scope, mais l'interface `SignatureProvider` doit permettre de l'ajouter.
