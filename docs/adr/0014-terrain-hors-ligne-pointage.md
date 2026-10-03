# ADR 0014 — Vue terrain hors ligne, pointage, main-d'œuvre et Check In and Out

## Contexte
M5 livre la vue terrain (03 §7, 02 P4, maquette `terrain`) : un ouvrier pointe, photographie, coche
ses tâches et signale un problème depuis une cave ou un grenier sans réseau. Le chef pointe son
équipe, fait signer un bon de régie et valide les heures. Les heures alimentent le coût du chantier,
et les présences doivent partir à l'ONSS (Check In and Out) sur les chantiers concernés. L'app
Flutter viendra plus tard et doit pouvoir consommer la même API.

## Décisions
1. **PWA dans `apps/web`**, sous `/terrain` (pas de second front). Mise en page mobile propre, sans la
   coquille du bureau, avec des boutons d'au moins 56 px, une barre d'onglets en bas et le
   tutoiement. Le manifeste est traduit (route `/terrain/manifest.webmanifest`). Le service worker
   `/terrain/sw.js` (en-tête `Service-Worker-Allowed: /terrain`) sert les pages `/terrain` réseau
   d'abord avec repli en cache, et les fichiers `/_next/static` cache d'abord. Il n'est enregistré
   qu'en production. Il ne met **jamais** l'API en cache.
2. **File hors ligne dans IndexedDB** (`lib/field/queue.ts`), avec un repli en mémoire. Chaque action
   (pointage, tâche, signalement) reçoit un UUIDv7 généré sur le téléphone. La journée reçue en
   dernier est conservée pour un affichage hors ligne. L'écran montre la file de façon optimiste
   (« en attente d'envoi »). Le même chemin sert en ligne et hors ligne : écrire dans la file, puis
   synchroniser tout de suite.
3. **Synchronisation par lots** : `POST /field/sync` exécute une transaction par action. Une erreur
   métier (chantier clôturé, journée validée, droits) est renvoyée pour l'action concernée, qui
   sort de la file et s'affiche à l'ouvrier. Une erreur technique fait rejouer tout le lot plus
   tard. Les photos partent ensuite une à une sur `/attachments?id=…` (idempotent). Une photo de
   signalement attend que son signalement soit arrivé. La synchro se déclenche au retour du réseau,
   au retour au premier plan, toutes les 30 s, et après chaque action.
4. **L'heure du téléphone fait foi** (`at`). Le serveur refuse seulement un pointage dans le futur
   (plus de 5 min), sur un chantier clôturé, ou sur une journée déjà validée (sauf le bureau).
   **La géolocalisation ne bloque jamais** : la distance est calculée et l'anomalie `too_far` ou
   `no_position` est signalée au chef et au bureau. La précision annoncée par le GPS (200 m au plus)
   s'ajoute à la tolérance.
5. **Heures** : calculées à la lecture (`computeWorkedTime`) à partir des paires IN → OUT par jour
   civil à Bruxelles. Deux IN de suite : le dernier gagne et l'anomalie est signalée. La pause est
   déduite une fois au-delà d'un seuil, selon les paramètres de l'entreprise. La validation par le
   chef fige la journée, et elle est refusée tant que quelqu'un est encore pointé sur place.
6. **Coût main-d'œuvre** : le consommateur `labour-costs` le recalcule à chaque pointage et à chaque
   validation, par personne et par jour (minutes nettes × coût horaire chargé). Il le répartit sur les
   postes touchés ce jour-là, sinon au prorata du reste à faire, sinon « non ventilé ». Il l'écrit
   dans le grand livre `ProjectCost` (ADR 0013) avec un `sourceId` stable
   `employé:jour:poste`, corrigé en place. La main-d'œuvre n'apparaît pas dans le fil (trop bavard),
   mais elle passe par la surveillance de dérive.
7. **Check In and Out** : le chantier est concerné si le contrat ou le montant total du chantier
   atteint 500 000 € HTVA, ou si l'option est forcée. Le pointage est alors marqué `pending` et le
   consommateur `check-in-out` le transmet via l'adaptateur `AttendanceRegistry` (mock par défaut).
   Pour cela, l'INSS est déchiffré : le chiffrement `FieldCipher` a été déplacé dans
   `packages/db` pour être partagé par l'API et le worker. Une panne passagère est rejouée par
   pg-boss. Un refus est affiché, notifié au bureau et peut être relancé
   (`POST /projects/:id/attendance/retry`). L'export CSV de secours est disponible pour le bureau.
8. **Bon de régie** sans prix. Le brouillon est préparé par le chef, puis signé sur le téléphone. La
   signature exige le réseau, parce que le PDF signé, son empreinte et la numérotation `BR{YYYY}-{SEQ}`
   sont produits par le serveur. Le bon devient alors immuable. Il sera valorisé en facture de régie
   en M8.
9. **Signalement → avenant** en un clic, côté bureau. L'avenant brouillon reprend le titre et la
   description du signalement, et le signalement passe à l'état « avenant ».
10. **Arrivée de l'équipe** : une seule entrée par chantier et par jour dans le fil (« Équipe de
    Karim arrivée sur chantier »), complétée par les arrivées suivantes. Le portail en tire une
    phrase au vouvoiement : « L'équipe de Karim est chez vous depuis 8 h 02 ».
11. **Onglet « Planning » de la maquette** : remplacé par « Heures » jusqu'à M6, où le planning
    arrivera. D'ici là, le chantier du jour vient des créneaux `ScheduleSlot` (le seed en crée pour
    l'équipe de Karim), sinon des pointages du jour, sinon des chantiers en cours de l'équipe.

## Conséquences
- Le produit tourne sans réseau côté ouvrier. L'app Flutter réutilisera `/field/*` et le même contrat
  d'idempotence.
- Le temps réel se resynchronise après chaque reconnexion du flux SSE : les requêtes actives sont
  rechargées, et aucun message perdu ne laisse un écran figé.
- Un téléphone partagé doit se déconnecter. La déconnexion vide la file et les caches terrain, et
  avertit l'utilisateur si des actions ne sont pas encore parties.
- La signature d'un bon de régie hors ligne n'est pas possible. L'écran l'explique et garde le
  brouillon ouvert.
