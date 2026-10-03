# ADR 0019 — Réception, stock et matériel

## Contexte
M10 livre la fin de chantier (03 §5, 02 P10) ainsi que le stock et le matériel (03 §11, 02 P13).

La spécification laisse ouverts :
- la forme du PV ;
- le moment de la facture finale ;
- la méthode de valorisation du stock ;
- la manière d'imputer le matériel.

## Décisions

1. **PV de réception** (`Reception`, `Reserve`).
   - Il y a deux PV : provisoire et définitif. Chacun est numéroté à la signature (`PV{YYYY}-{SEQ:3}`), signé par le client à l'écran (sur le téléphone du chef ou au bureau) et rendu en PDF dans le compartiment `legal`.
   - Un PV signé est **immuable** (déclencheur Postgres). Seule la levée d'une réserve est enregistrée.
   - Le PDF peut être rendu une seule fois après coup, pour un PV importé ou du seed : son empreinte, une fois posée, ne change plus.
   - Le PV provisoire fixe la réception définitive prévue : date + délai de garantie du tenant (12 mois par défaut).

2. **Réserves.**
   - Chaque réserve devient une tâche du chantier, sur son poste.
   - Une tâche terminée lève la réserve, et une réserve levée termine sa tâche.
   - Quand la dernière réserve est levée, ou à la signature d'un PV sans réserve, le worker prépare la **facture finale en brouillon** : un état de clôture à 100 %, soit le solde du contrat moins ce qui est déjà facturé, avec la retenue de garantie.
   - La facture finale ne part jamais seule : le bureau l'émet.

3. **Retenue de garantie.**
   - Le PV définitif la libère sur toutes les factures du chantier : `retentionReleasedAt`, échéance au délai de paiement du tenant.
   - Une facture payée redevient « partiellement payée » pour ce seul montant (`paid → partially_paid`).
   - Le client reçoit un avis PDF avec les communications structurées.
   - Les relances partent de cette échéance.

4. **Rapport de rentabilité.**
   - Il donne, par poste : vendu, budget, coûts réels par catégorie, marge et écart, et heures prévues/réelles (déduites des coûts de main-d'œuvre).
   - Un écart de plus de 10 % propose d'ajuster le prix de revient des articles de la bibliothèque. Ce n'est qu'une proposition, appliquée sur demande et auditée.

5. **Stock valorisé au coût moyen pondéré** (CMP) par article, tous emplacements confondus.
   - Une entrée repondère le CMP au prix d'achat (fournisseur, ou réception d'un bon de commande de réapprovisionnement).
   - Une sortie, un transfert ou un inventaire est valorisé au CMP courant.
   - Les montants sont en centimes, arrondis au centime dans le domaine (`receiveStock`, `issueStock`, `countStock`).
   - Les niveaux sont verrouillés (`FOR UPDATE`) pendant un mouvement.
   - Les mouvements portent un identifiant client : un renvoi ne double rien. La sortie depuis la vue terrain passe par la file hors ligne (`/field/sync`, action `stock`).
   - Une sortie vers un chantier émet `stock.moved_to_project.v1`. Le worker l'impute au poste choisi (`ProjectCost`, catégorie `stock`) et la timeline l'affiche.
   - On n'impute rien sur un chantier clôturé.

6. **Seuils et réapprovisionnement.**
   - Le seuil est fixé par article et par emplacement.
   - Le passage sous le seuil émet `stock.level_low.v1` une fois, puis l'alerte est réarmée au-dessus du seuil.
   - La proposition regroupe les besoins par fournisseur préféré de l'article et par emplacement. La quantité commandée est celle saisie, sinon de quoi revenir au double du seuil.
   - Le bon de commande de réapprovisionnement vise un emplacement (`stockLocationId`, sans chantier). Sa réception entre en stock au prix de la ligne, et sa facture est rapprochée sans imputation au chantier.

7. **Matériel.**
   - Un matériel a un coût d'usage journalier, figé dans chaque affectation.
   - Le coût d'une affectation est : jours ouvrés belges entre le début et le retour (ou aujourd'hui) × coût journalier. Il est imputé au poste par le worker (`equipment.assignment_changed.v1`, catégorie `equipment`).
   - Une tâche quotidienne (06:15) recalcule les affectations en cours seulement quand le montant change. Le recalcul n'écrit rien dans la timeline : seules l'affectation et le retour y apparaissent.
   - Deux affectations ne se chevauchent pas.
   - Entretiens et contrôles :
     - l'échéance est bientôt due à 14 jours ;
     - une alerte part par état (`alertState`) ;
     - un entretien périodique fait planifie le suivant.

## Conséquences
- Le chef de chantier (`site_manager`) a `stock.write` et `equipment.write` : il prend dans sa camionnette et rend le matériel.
- Le stock n'est pas un module comptable : la valeur affichée sert à piloter, la comptabilité reste dans Chift (M12).
- Le CMP global, plutôt que par emplacement, garde un seul coût par article. Un transfert ne change donc pas la valeur.
