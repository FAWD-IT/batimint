# 01 — Vision produit

## En une phrase
Batimint est l'ERP des PME belges du BTP (2 à 50 personnes) qui fonctionne comme une app grand public : on encode une fois, tout le reste suit, et chacun voit l'état réel du chantier en direct.

## Le nom
**Batimint**, « bâtiment » en wallon. Un nom local, immédiatement compris par le secteur, qui affirme l'ancrage wallon du produit. Orthographe à confirmer par un locuteur avant le dépôt de marque.

## Le problème
Un patron de PME BTP jongle entre Excel pour les prix, Word pour les devis, WhatsApp pour le terrain, un logiciel de facturation, des mails fournisseurs et son comptable. Il découvre la rentabilité d'un chantier des semaines après sa fin. Depuis 2026, Peppol est obligatoire en B2B, et Check In and Out at Work arrive le 1er avril 2027 : la pression administrative augmente.

## Le principe « Uber »
Une course Uber a un état unique, partagé en temps réel entre client, chauffeur et paiement. Chez nous, **le chantier** joue ce rôle.

**Demande → Devis → Signature → Chantier → Planning → Terrain → États d'avancement → Facture (Peppol) → Paiement**

- Le devis signé crée le chantier, son budget par poste et ses tâches.
- Les heures pointées et les factures fournisseurs reçues par Peppol s'imputent au budget.
- La facture d'avancement se construit à partir de l'avancement réel.
- La marge est recalculée à chaque événement.
- Le client final suit tout depuis un lien, valide et paie.

## Principes produit (arbitrent tous les choix)
1. **Zéro ressaisie.** Si une donnée existe quelque part, elle est proposée ailleurs.
2. **Le système agit, puis informe.** Les notifications racontent ce qui a été fait seul (« Facture Brico Pro reçue via Peppol → imputée au poste Carrelage »).
3. **Une page chantier qui dit tout** : état, fil chronologique, marge en direct, prochaines actions.
4. **Conformité invisible.** TVA, autoliquidation, 6 %, Peppol, 30bis et Check In and Out sont gérés par le produit, pas par l'utilisateur.
5. **Terrain d'abord.** La vue ouvrier tient en quelques gros boutons, marche d'une main et tolère le hors-ligne.
6. **Le client final dans la boucle.** C'est notre différenciateur face à Vertuoza.
7. **Rapide.** Chaque action donne un retour immédiat (UI optimiste), et rien ne recharge la page.

## Différenciateurs face à Vertuoza
| Nous | Vertuoza |
|---|---|
| Réception Peppol native, imputation automatique au chantier | Encodage ou OCR des factures d'achat |
| Portail client final (suivi, validation, paiement) | Pas mis en avant |
| Conformité belge intégrée (30bis, Check In and Out, 6 %) | Partielle |
| Temps réel partout, timeline unique | ERP classique |

Il faut aussi la parité sur leur socle : bibliothèque d'ouvrages, devis rapides (dont la dictée IA), avenants, états d'avancement, factures de situation, rappels, marge chantier, planning, sous-traitants, stock.

## Cibles
- **Cœur** : entreprises de rénovation et d'entreprise générale de 3 à 30 personnes en Wallonie et à Bruxelles, en B2C et B2B.
- **Utilisateurs** : patron, employé de bureau, chef de chantier, ouvrier, comptable externe ; côté externe, le client final et le sous-traitant.

## Hors scope de cette livraison
- App native Flutter (la vue terrain web/PWA la remplace temporairement ; l'API doit être prête pour elle).
- Open banking (rapprochement bancaire automatique).
- Néerlandais (structure i18n prête, traductions plus tard).

## Modèle commercial (pour le paramétrage des plans)
Abonnement par utilisateur « bureau », avec ouvriers illimités. Trois plans (Essentiel, Pro, Expert) activent des modules via des feature flags par tenant. Essai de 14 jours. La facturation de l'abonnement elle-même peut rester manuelle en v1 : prévoir le modèle de données et les drapeaux, pas l'encaissement.
