# ADR 0013 — Chantier pivot : chiffres recalculés, grand livre des coûts, avenants, portail chantier, ⌘K

## Contexte
M4 fait du chantier l'objet pivot (03 §5, maquette `cockpit-chantier`). Il faut afficher en direct
budget, engagé, facturé et marge, alors que les sources de coût (pointages M5, achats et factures
fournisseurs M7, stock et matériel M10) arrivent plus tard. Le client doit valider les avenants et
poser ses questions sans compte (02 P5, P8), et le cockpit doit se mettre à jour dans deux
navigateurs.

## Décisions
1. **Aucun chiffre stocké en double.** Avancement, engagé, coût projeté, marges et alertes sont
   recalculés à chaque lecture par `loadProjectNumbers` (`packages/db`) avec les fonctions pures de
   `packages/domain` (ADR 0004). Seul le montant du contrat est tenu à jour (devis signé + avenants
   signés) par les consommateurs. L'API et le worker partagent ce code.
2. **Grand livre des coûts `ProjectCost`** : une ligne par source (catégorie, type, id source unique),
   imputée à un poste ou « non ventilée ». Chaque module futur y écrit via son consommateur
   (heures validées → `labour`, facture fournisseur → `supplier_invoice`, BC ouvert →
   `purchase_order`…) et peut mettre à jour sa ligne en place. M4 n'expose qu'une saisie manuelle
   « coût divers » (catégorie `other`, auditée).
3. **Avancement d'un poste** = moyenne de l'avancement de ses tâches pondérée par leur montant de
   vente (à défaut les heures prévues, sinon 1). Une tâche a un avancement 0–1 ; « faite » vaut 1.
   L'avancement du chantier est pondéré par le montant vendu des postes.
4. **Avenant = mêmes calculs que le devis** (`computeChangeOrder` → `computeQuote`, un poste cible
   = une section). Rang par chantier (« avenant n°2 ») attribué sous verrou du chantier ; numéro
   légal `AV{YYYY}-{SEQ}` attribué au premier envoi (séquence sans trou). Brouillon modifiable ;
   envoyé = figé (on le retire pour le modifier) ; signé = immuable, PDF signé et preuve SHA-256 en
   ajout seul. À la signature, le consommateur ajoute vente, coût et heures aux postes (ou crée un
   nouveau poste), crée les tâches, augmente le contrat et décale la fin en jours ouvrés belges.
5. **Pastille d'état** du chantier : rouge si retard ou marge estimée négative ; orange si un poste
   dérive, si la marge glisse de plus de 5 points ou si une facture est échue ; vert sinon.
6. **Alerte de dérive une fois par poste** : le consommateur prend un verrou consultatif par chantier
   puis vérifie l'outbox (conservé) avant d'émettre `budget.drift_detected.v1`, pour que deux coûts
   traités en parallèle ne lèvent pas deux alertes.
7. **Fil du chantier** = entrées de timeline (projection des événements) + commentaires, fusionnés
   à la lecture. Les photos envoyées d'affilée par la même personne (30 min) forment une seule entrée
   « 4 photos ». Mentions encodées `@[Nom](userId)` par l'éditeur ; seules les personnes actives du
   tenant sont notifiées.
8. **Portail chantier** : jeton `kind = project` (empreinte seule en base), créé par le consommateur
   qui envoie l'e-mail (jamais en clair dans l'outbox), ou par l'API quand le bureau ouvre/copie le
   lien. `/p/{token}` essaie le chantier puis le devis. Flux temps réel public par jeton, qui ne
   transporte que le sujet à rafraîchir. Une réponse du bureau visible par le client clôt ses
   questions ouvertes sur l'objet et lui est envoyée par e-mail.
9. **⌘K** : recherche multi-objets filtrée par les droits (`/search`) + actions rapides
   (`?nouveau=1` ouvre la création sur l'écran cible) + navigation ; `?` affiche les raccourcis,
   « g » puis une lettre navigue.

## Conséquences
- Les modules M5–M10 n'ont qu'à écrire dans `ProjectCost`, émettre `project.cost_recorded.v1` et,
  pour la facturation, des factures liées au chantier : le cockpit suit sans changement.
- Le recalcul à la lecture coûte quelques requêtes groupées par écran (liste comprise) ; à
  surveiller avec les budgets de performance de M13.
- Le seed Dupont respecte 24,0 % prévus, 21,8 % estimés, 62 %, dérive Carrelage et facture
  2026-118 échue ; l'engagé (≈ 19 000 €) diffère de la maquette (21 160 €), incompatible avec ces
  valeurs selon la formule de l'ADR 0004.
