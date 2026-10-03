# ADR 0010 — Parcours P1 : écran de bienvenue et checklist

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
`docs/02` P1 : Marc s'inscrit « puis saisit son numéro d'entreprise » et la checklist d'onboarding renvoie vers chaque écran. Demander le numéro BCE dans le formulaire d'inscription allonge celui-ci (et fait échouer des inscriptions pour une faute de frappe) ; le laisser enfoui dans les paramètres fait que personne ne le remplit.

## Décision
- Inscription minimale (nom, entreprise, e-mail, mot de passe), puis **écran de bienvenue** dédié : numéro d'entreprise → VIES → raison sociale et adresse pré-remplies et modifiables → « C'est bien nous ». L'étape peut être remise à plus tard (lien, fonctionne même avant le chargement du JavaScript).
- La checklist d'« Aujourd'hui » n'affiche que les étapes dont le module est livré (la bibliothèque arrive en M2), se masque d'un clic, disparaît une fois complète, et n'est montrée qu'aux rôles qui peuvent agir (`company.update`).
- Les intégrations simulées sont signalées par une pastille « Simulation » et un bandeau explicatif : l'utilisateur sait qu'aucun échange réel n'a lieu.
- Les e-mails d'invitation sont envoyés par le consommateur de `user.invited.v1` : le jeton est créé au moment de l'envoi, seule son empreinte est stockée ; renvoyer une invitation invalide l'ancien lien.

## Conséquences
Moins de 2 minutes du formulaire d'inscription à une fiche entreprise validée (mesuré en E2E). L'import de bibliothèque (P1.4) sera ajouté à la checklist et au parcours E2E en M2.
