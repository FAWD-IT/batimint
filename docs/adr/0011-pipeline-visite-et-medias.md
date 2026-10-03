# ADR 0011 — Pipeline, visite technique et médias (M2)

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
`docs/02` P2.1–P2.2 et `docs/03` §2 : pipeline kanban avec motif de perte, demandes multi-canal qui créent prospect et affaire, visite technique sur téléphone (photos, mesures, note vocale transcrite). `docs/08` exige que tout soit faisable au clavier et qu'une action soit annulable.

## Décision
- **Kanban** : glisser-déposer HTML5 natif (pas de dépendance), avec mise à jour optimiste qui reproduit le réordonnancement de l'API, puis invalidation. Alternative clavier et tactile : un bouton « Déplacer vers… » par carte (menu ARIA, flèches, Échap). Chaque déplacement propose « Annuler » pendant 5 s. Passer en « Perdue » exige un motif (liste fermée + précision), refusé aussi côté API.
- **Temps réel** : les consommateurs publient `opportunities`, `leads`, `customers`, `items`, `attachments` ; les cartes modifiées par un collègue s'illuminent brièvement. Planifier une visite fait passer l'affaire en « Visite planifiée » et émet `opportunity.stage_changed.v1`.
- **Demandes** : toute demande (formulaire public, e-mail entrant signé, saisie) passe par `lead.received.v1` ; c'est le consommateur qui crée ou retrouve la fiche (même e-mail) et ouvre l'affaire. Le formulaire public `/f/{slug}` est intégrable en iframe (en-têtes `frame-ancestors *` limités à `/f/*`, hauteur ajustée par `/embed.js`) ; anti-robot discret (champ piège + temps de saisie), réponse identique pour un robot.
- **Photos** : compressées dans le navigateur (≤ 1600 px, JPEG 80 %) avant envoi, identifiant client (UUIDv7) pour qu'un renvoi ne duplique rien. Note vocale : `MediaRecorder` (WebM/Opus ou MP4 selon le navigateur), avec repli « envoyer un fichier audio » si le micro est refusé.
- **Transcription** : faite par le consommateur `transcribe-voice-note` (IA mock par défaut). Un échec n'est **pas** rejoué : le statut `failed` est conservé (relancer l'exception annulerait la transaction et laisserait la note « en cours » à jamais) ; l'écran invite à réécouter.
- **Mesures et points à vérifier** : modèles par métier (salle de bain, toiture, électricité, rénovation) stockés dans les traductions, ajoutés sans doublon ; la visite garde des JSON simples (libellé, valeur, unité).
- **Bibliothèque** : le prix de vente et la marge se recalculent en direct dans le tiroir avec les fonctions de `packages/domain` (mêmes règles que l'API). Les prestations au temps des bibliothèques types sans prix propre valent « temps × 36 €/h ».

## Conséquences
Aucune librairie de glisser-déposer ni de capture à maintenir. Le kanban reste utilisable au clavier et sur téléphone (colonnes défilantes). Le contrôle des clés de traduction (`apps/web/scripts/check-messages.mjs`, lancé par `pnpm lint`) empêche une clé manquante d'apparaître brute à l'écran.
