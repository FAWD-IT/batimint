# ADR 0004 — Formule du coût projeté (marge réelle estimée)

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
`docs/04` définit le coût projeté d'un poste comme `max(engagé, budgété × avancement)`, avec l'objectif de « ne pas afficher une marge flatteuse en début de chantier ». Appliquée telle quelle, la formule fait l'inverse : à 0 % d'avancement et sans dépense, le coût projeté vaut 0 et la marge affichée ~100 %.

## Décision
`projeté = max(engagé, budgété × avancement) + budgété × (1 − avancement)` (`packages/domain/src/budget.ts`).
La part consommée vaut au moins ce que l'avancement laisse prévoir (aucune économie comptée avant la fin du poste) et on ajoute le reste à faire au coût budgété. En début de chantier, la marge estimée vaut la marge prévue ; un dépassement la fait baisser immédiatement. La formule est expliquée dans une infobulle de l'interface.

## Conséquences
La marge ne s'améliore jamais avant la fin d'un poste (choix prudent). Au rapport de clôture, on affiche le réel (engagé) et non le projeté.
