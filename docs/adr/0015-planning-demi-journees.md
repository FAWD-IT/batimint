# ADR 0015 — Planning en demi-journées, conflits signalés, date de début et iCal

## Contexte
M6 livre le planning (03 §6, 02 P3). Sophie glisse les tâches du devis sur une équipe ou une
personne, en vue semaine ou mois. Les conflits (une personne sur deux chantiers, un congé) sont
signalés. Le client voit la date de début sur son portail, l'ouvrier reçoit son planning du
lendemain à 18 h, et chacun peut s'abonner à son planning en iCal.

## Décisions
1. **Une affectation est une plage** `startDay/startHalf → endDay/endHalf` (`am`/`pm`) sur un
   chantier, pour **une équipe ou une personne** (exactement une), avec une tâche facultative.
   - La migration M5 → M6 conserve les créneaux existants (renommage de `day`, demi-journées déduites
     des heures).
   - Le contrôle de cohérence est fait en base (CHECK) et par l'API.
2. **Seules les demi-journées ouvrées comptent**, ce qui exclut les week-ends et les fériés belges.
   - Déplacer un bloc garde sa durée en demi-journées ouvrées : 3 jours posés un jeudi finissent le
     lundi.
   - Une plage sans aucune demi-journée ouvrée est refusée.
3. **Une affectation d'équipe vaut pour ses membres actuels.** Les conflits sont recalculés à chaque
   lecture par le domaine (`detectConflicts`), personne par personne et demi-journée par
   demi-journée, et ne sont jamais stockés.
   - Les conflits **ne bloquent pas** : la réalité du chantier prime, et l'écran les montre (liseré
     rouge, liste, toast).
   - Deux affectations sur le même chantier ne forment pas un conflit.
4. **Tâches « à planifier »** : une tâche est considérée planifiée si elle a sa propre affectation, ou
   si son chantier a déjà une affectation sans tâche précise (équipe sur le chantier).
5. **Date de début** : tant que le chantier est « en préparation », sa date de début suit la
   première demi-journée planifiée (`syncProjectStart`, même transaction que l'affectation).
   - Le client est prévenu par e-mail et dans son fil (portail, vouvoiement) **une seule fois**,
     quand la date est stable depuis 10 minutes. Une tâche planifiée toutes les 5 minutes s'en
     charge, avec la colonne `arrivalNotifiedOn`.
   - Ce délai évite d'envoyer un e-mail à chaque glisser-déposer.
6. **Planning du lendemain** : une tâche planifiée à 18 h (Europe/Brussels) émet un événement par
   personne qui a un compte et du travail le prochain jour ouvré. Le consommateur envoie une
   notification et un e-mail au tutoiement. Le dédoublonnage se fait par personne et par jour dans
   l'outbox.
7. **iCal** : un lien secret par personne (`/api/v1/ical/{jeton}.ics`, empreinte SHA-256 stockée
   comme pour les portails). Le renouveler révoque l'ancien lien.
   - Le calendrier contient un événement par jour ouvré, de 8 h à 12 h et de 12 h 30 à 16 h 30.
   - Les heures sont données en UTC. Le texte est échappé et les lignes sont pliées à 75 octets
     (RFC 5545).
8. **Interface** : grille ressources × demi-journées, regroupée par équipes, par personnes ou par
   chantiers.
   - Glisser-déposer HTML5 : déplacer un bloc, le réaffecter en le posant sur une autre ligne,
     l'allonger par sa poignée, ou poser une tâche, dont la durée vaut ses heures prévues / 4 h.
   - **Alternative clavier** : flèches pour décaler d'une demi-journée, Maj + flèches pour
     redimensionner, Suppr pour retirer (avec Annuler), Entrée pour ouvrir le dialogue complet.
   - Mises à jour optimistes, puis recalcul des conflits par le serveur.
   - Sur téléphone, un agenda par jour remplace la grille.
   - La vue terrain gagne un onglet « Planning » (deux semaines) et « Ajouter à mon agenda ».

## Conséquences
- Pas de « météo indicative » (03 §6 la dit optionnelle) : elle demanderait une API externe. Elle
  est reportée.
- Les durées sont au demi-jour, pas à l'heure. Le pointage (M5) reste la source des heures réelles.
- Une équipe dont la composition change voit ses conflits recalculés immédiatement, puisque rien
  n'est figé.
