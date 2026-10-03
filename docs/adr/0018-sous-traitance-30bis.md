# ADR 0018 — Sous-traitance : contrats, 30bis, documents, portail sous-traitant

## Contexte
M9 livre la sous-traitance et la conformité (03 §9, 05 §7 et §8, 02 P9).

Contraintes :
- Consulter les dettes sociales et fiscales du sous-traitant avant le contrat et avant chaque paiement, et conserver la preuve.
- En cas de dette, retenir le pourcentage légal et le verser aux administrations.
- Signaler les documents expirés.
- Ouvrir un portail sous-traitant sans compte.
- L'accès logiciel aux services de l'ONSS est **[à valider]** : tout fonctionne en `mock`.

## Décisions

1. **Un sous-traitant est un fournisseur marqué `isSubcontractor`.** Pas de nouvelle entité : ses factures passent par les achats (M7). Choisir un fournisseur dans un contrat le marque sous-traitant.

2. **Contrat de sous-traitance** (`Subcontract`).
   - Il porte sur un poste du chantier, avec un montant HTVA et un échéancier en pourcentages. La somme fait 100 % et le dernier versement absorbe l'arrondi.
   - Il est numéroté (`ST{YYYY}-{SEQ:3}`) au moment où il est conclu.
   - **Sans numéro d'entreprise, pas de contrat** : la consultation 30bis est impossible.
   - Le PDF du contrat est rangé dans le compartiment `legal` sous une clé qui contient son empreinte. Le compartiment refuse l'écrasement, donc chaque version a sa propre clé.
   - L'engagé du poste est le montant du contrat moins ce qui a déjà été facturé sur ce contrat. Il sort de l'engagé quand le contrat est clôturé ou annulé.
   - Un contrat qui a des factures ne s'annule pas : on le clôture.

3. **Consultation 30bis** (`ThirtyBisCheck`, adaptateur `ThirtyBisChecker`).
   - Elle est faite à la conclusion du contrat, à la réception d'une facture, avant la mise à payer et le paiement, et à la demande.
   - Chaque consultation est une ligne **immuable** (déclencheur Postgres) : horodatage, résultat, montants des dettes s'ils sont connus, référence du service, réponse brute. Le PDF de preuve est rangé avec son empreinte, ou rendu au premier téléchargement pour une consultation importée.
   - Une consultation vaut pour le jour où elle est faite (jour de Bruxelles). Avant un paiement, celle du jour est réutilisée, sinon une nouvelle est faite.
   - Mock déterministe : le numéro d'entreprise dont les 7e et 8e chiffres valent « 99 » a une dette sociale, « 98 » une dette fiscale, « 97 » les deux. Les débiteurs du seed sont listés à part. Les deux chemins sont testés.

4. **Retenue avant paiement.**
   - La retenue est un pourcentage du HTVA facturé : 35 % pour une dette sociale, 15 % pour une dette fiscale **[à valider]**, paramétrables par tenant. Elle est limitée à la dette quand le service en donne le montant. La TVA reste due au sous-traitant.
   - Mettre à payer ou marquer payée la facture d'un sous-traitant passe par le contrôle. S'il y a une dette, la facture passe **bloquée**, avec la raison et la retenue calculée.
   - « Appliquer la retenue » refait la consultation du jour, fige la retenue, génère le **document de versement** (montants ONSS et SPF Finances, solde au sous-traitant, références à mentionner) et met la facture à payer.
   - Si la dette disparaît, la retenue est levée.
   - Les coordonnées de paiement des administrations ne sont pas codées en dur **[à valider]**.

5. **Documents obligatoires** (`SubcontractorDocument`).
   - Types : assurance RC, attestation ONSS, attestation SPF Finances, accès à la profession, autre. Par défaut, les trois premiers sont exigés (paramètre du tenant).
   - La conformité retient, pour chaque type, le document qui expire le plus tard : valide, expire bientôt (30 jours), expiré ou manquant.
   - Une tâche quotidienne (7 h 30) prévient une seule fois par état (`alertState`) : notification au bureau, et e-mail vouvoyé au sous-traitant avec son lien de dépôt.

6. **Portail sous-traitant** (`/s/[token]`, `PortalToken` de type `subcontractor`).
   - Le lien est créé par le worker à l'invitation (l'événement ne contient jamais le jeton) et est révocable.
   - Le sous-traitant voit ses missions (chantier, dates, montant, échéancier, contrat PDF, responsable), ses documents à fournir avec leur échéance, et ses factures avec leur état (reçue, en traitement, à payer, payée, retenue éventuelle).
   - Il dépose ses documents, et ses factures en UBL ou en PDF. Pour un PDF, il indique le numéro et les montants, car l'extraction automatique n'est qu'une aide.
   - Une facture déposée pour une mission est **imputée au poste du contrat sans saisie**. Une facture Peppol d'un sous-traitant qui n'a qu'un contrat en cours (et sans référence de commande) l'est aussi.

7. **Déclaration de travaux (art. 30bis §7).**
   - Elle est signalée « probablement requise » dès 30 000 € HTVA, ou dès qu'un sous-traitant intervient **[à valider]**.
   - Les données sont pré-remplies (chantier, adresse, période, montant, maître d'ouvrage, entrepreneur, sous-traitants), et la référence de l'ONSS est enregistrée une fois la déclaration faite.

8. **Check In and Out.** Livré au M5 (adaptateur `AttendanceRegistry` mock, export de secours, relance des échecs). M9 n'ajoute rien de neuf ici. L'enregistrement des ouvriers des sous-traitants attend l'accès logiciel de l'ONSS **[à valider]**.

## Conséquences
- Seed : Électro Pirson (sans dette, attestation ONSS à renouveler, acompte payé) et Façades Lemaire (dette sociale, assurance expirée, acompte bloqué avec une retenue de 1 932 €) sont sous contrat sur la « Rénovation de 4 appartements ». La déclaration de travaux y reste à faire.
- Les documents du seed n'ont pas de fichier : leur téléchargement répond « fichier non disponible ».
