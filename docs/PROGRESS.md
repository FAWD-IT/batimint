# PROGRESS — tenu à jour par l'agent

Ce fichier est le point de reprise entre sessions cloud. Une nouvelle session doit pouvoir reprendre le travail en ne lisant que lui et `CLAUDE.md`.

## Jalon en cours
**M7 — Achats et Peppol entrant** — livré (API, worker, écrans, seed, E2E P6 verts en local), en attente de la CI. M6 ✅ validé (CI run 32 : checks + E2E sur les images de production).

(L'étiquette `m0-done` existe localement mais le push de tags est refusé par la politique de la session : seule la branche est poussée.)

## Prochaine action
Vérifier la CI du push M7 ; si verte, marquer M7 ✅ et démarrer M8 (facturation et encaissement : états d'avancement, factures, notes de crédit, numérotation, PDF + UBL, Peppol sortant mock, e-mail, QR EPC, paiements, Mollie mock, relances, portail ; parcours P7 et P8).

## Relancer l'environnement
```bash
# Session cloud : le démon Docker n'est pas lancé par défaut (le hook de session le démarre).
docker info >/dev/null 2>&1 || (nohup dockerd >/tmp/dockerd.log 2>&1 &)
pnpm install
cp -n .env.example .env
pnpm services:up          # Postgres :5432, MinIO :9000/:9001, Mailpit :1025/:8025
pnpm db:migrate           # migrations + rôle batimint_app + vérification RLS (si l'invite « nom de migration » bloque : pnpm --filter @batimint/db migrate:deploy)
pnpm db:seed              # tenant de démo
pnpm dev:apps > /tmp/dev.log 2>&1 &   # web :3000, api :4000, worker (ou `pnpm dev` qui fait tout)
pnpm test                 # unitaires + intégration (bases batimint_test_<package> créées à la volée)
pnpm --filter @batimint/e2e e2e       # E2E (app démarrée avec RATE_LIMIT_DISABLED=true dans .env ; E2E_DEMO=1 pour les tests sur le seed)
```
Stack de production (images) dans la session cloud — l'AC TLS du bac à sable doit être passée au build :
```bash
docker compose -f docker-compose.coolify.yml -f docker/docker-compose.sandbox.yml -f docker/docker-compose.e2e.yml up -d --build --wait
```
(arrêter d'abord `pnpm dev:apps` et le Mailpit de dev : mêmes ports 3000/4000/8025.)

## Fait
### M0 — Fondations ✅
- Monorepo pnpm + Turborepo, TypeScript strict, ESLint 10, Prettier, Vitest 4 (ADR 0001).
- `packages/domain` (pur, 100 % des lignes couvertes) : centimes `bigint`, arrondis EN 16931, TVA par catégorie/taux, détermination du régime (AE / 6 % / 21 % / intracom), justification de forçage, communication structurée mod 97, numérotation, identifiants belges (BCE, TVA, IBAN, Peppol 0208), matrice de permissions, machines d'état (devis, avenant, chantier, état d'avancement, facture, facture fournisseur, pointage), budget et marge (ADR 0004).
- `packages/db` : Prisma 7, RLS forcée sur toutes les tables métier, rôle applicatif provisionné et vérifié à chaque migration, outbox (+ NOTIFY), audit en ajout seul, numérotation sans trou (100 émissions concurrentes testées), seed des personas, `admin:create` (ADR 0005).
- `apps/api` : Fastify 5, OpenAPI 3.1 (`/docs`), auth maison (inscription, connexion, lien magique, reset, TOTP, sessions révocables, Bearer mobile, CSRF Origin) (ADR 0002), contexte tenant par transaction, Idempotency-Key, erreurs françaises, `/health` `/ready`, SSE par canal, notifications, diagnostic temps réel.
- `apps/worker` : relais outbox → pg-boss 12 (même transaction), consommateurs idempotents, file morte, `pg_notify` transactionnel, battement de santé (ADR 0008).
- `apps/web` : Next.js 16, Tailwind 4 + tokens, Geist auto-hébergée (ADR 0009), i18n FR (next-intl), proxy same-origin `/api/v1` (ADR 0003), coquille back-office (barre latérale sombre, menu mobile, indicateur « En direct », cloche + toasts temps réel), pages auth, Aujourd'hui (état vide), Paramètres → Diagnostic.
- `packages/ui` : boutons, champs, cartes, pastilles, jauges, barre d'étapes, toasts « Annuler », états vides/erreur, squelettes.
- `packages/integrations` : interfaces + mocks (mail SMTP/mock, S3/mémoire, VIES/mock).
- Dockerfiles multi-étapes non-root, `docker-compose.coolify.yml` (ADR 0006, 0007), `docker-compose.dev.yml`, CI GitHub Actions (checks + images + E2E), hook de session.
- Critères de sortie vérifiés : `pnpm test` vert (100 tests), RLS vert, E2E M0 verts en dev **et** sur les images de production (événement outbox → worker → SSE → navigateur, deux navigateurs synchronisés, axe sans violation critique/sérieuse, mobile 390×844), stack Coolify démarrée en local avec base migrée et tenant de démo, redéploiement idempotent.

### M1 — Entreprise et onboarding ✅ (hors bibliothèque, M2)
- Écran de bienvenue (BCE → VIES → fiche pré-remplie), checklist d'onboarding sur Aujourd'hui (ADR 0010).
- Paramètres → Entreprise (identité, VIES, adresse, banque avec contrôle IBAN/BIC, logo, couleur de marque avec contrôle AA, CGV, mentions, adresse e-mail entrante), Paramètres métier (profils horaires, coefficients avec exemple, pauses, tolérance de pointage, paiements, relances, retenue, seuil de dérive, approbation des états d'avancement, numérotation avec aperçu), Utilisateurs (rôles, désactivation, dernier patron protégé, invitations), Intégrations (Peppol : entité légale mock → actif ; test de connexion), Abonnement (plans, essai, sièges bureau, modules), Journal d'audit, Mon compte (profil, mot de passe, 2FA TOTP avec QR, sessions), Diagnostic.
- Équipes : employés (INSS chiffré, consultation journalisée, coûts masqués sans `pricing.read`), équipes (couleur, chef, membres), absences.
- Super-admin `/admin` : tenants (plan, modules), impersonation lecture seule auditée avec bandeau « Quitter », santé des intégrations, traitements en échec avec rejeu.
- Worker : envoi des invitations (jeton généré à l'envoi), notification « X a rejoint l'entreprise » en direct.
- Seed : CGV, couleur, profils horaires, Peppol actif, 8 employés en 2 équipes, congés.
- Tests : 35 intégration API, 66 domaine, 5 worker ; E2E P1 (Marc paramètre et invite ; Luca accepte sur mobile), équipes/INSS, compte.

### M2 — CRM et bibliothèque ✅
- Clients (particuliers / entreprises) : recherche floue instantanée (pg_trgm + unaccent), VIES, alerte de doublon (e-mail, TVA, téléphone) avec « Créer quand même », fusion, archivage, contacts, adresses de chantier (logement privé, âge → « 6 % possible »), Peppol joignable, historique unifié.
- Demandes : formulaire public intégrable `/f/{slug}` (+ `/embed.js`), e-mail entrant (webhook signé HMAC), saisie ; le consommateur `lead-intake` crée ou retrouve le prospect, ouvre l'affaire et notifie le bureau en direct. Paramètres → Formulaire web (lien, code d'intégration, aperçu, adresse de réception).
- Pipeline kanban : glisser-déposer, alternative clavier « Déplacer vers… », motif de perte obligatoire, « Annuler », totaux par colonne, temps réel (ADR 0011).
- Visite technique (mobile d'abord) : modèles de points à vérifier par métier, mesures, notes, photos compressées côté navigateur, note vocale (MediaRecorder ou fichier) transcrite par le worker (IA mock).
- Bibliothèque : recherche instantanée, filtres, tiroir article/ouvrage avec prix de vente et marge en direct, ouvrages composés, historique des prix, archivage annulable, bibliothèques types (4 métiers), import Excel/CSV en 3 étapes (mapping proposé, vérification, rapport) — 2 000 lignes < 30 s (test d'intégration).
- Onboarding : étape « Bibliothèque » ajoutée à la checklist (8 étapes).
- Seed : 4 bibliothèques types, 40 clients (28 particuliers, M. Dupont, 11 entreprises dont ACP, commune, ASBL), 17 affaires à toutes les étapes, demandes, visite de Karim chez M. Dupont.
- Outillage : `apps/web/scripts/check-messages.mjs` (dans `pnpm lint`) vérifie que toute clé de traduction utilisée existe.
- Tests : 11 intégration API M2, consommateur lead-intake ; E2E P2.1 (formulaire → pipeline en direct, deux navigateurs), clients/VIES/doublon, pipeline clavier/perte/annuler, bibliothèque (type, recherche, marge, ouvrage), P2.2 sur mobile (photo, note vocale transcrite, pas de débordement horizontal), P1 complet avec import CSV.

### M3 — Devis et signature ✅
- Domaine : `computeQuote` (postes, options, remise ligne × globale, revient, marge, heures, acompte), comparatif de versions, relance J+7 et échéance — tests de propriété (somme des postes = net du document).
- `@batimint/documents` : PDF A4 déterministe (Geist embarquée, OFL), postes, options retenues ou non, TVA par taux, acompte, échéancier, mentions (autoliquidation, 6 %), bloc de signature, CGV en annexe (ADR 0012).
- API : devis depuis l'affaire / un client / un modèle, enregistrement versionné (concurrence optimiste), TVA proposée par ligne avec justification obligatoire en cas d'écart (auditée), lignes de bibliothèque et ouvrages éclatables, dictée IA, comparatif, PDF, envoi, refus, archivage, modèles ; portail public (consultation, ouverture tracée une fois, PDF, signature + attestation 6 %, preuve SHA-256 en ajout seul).
- Worker : lien de portail + e-mail avec PDF, fil chronologique et notifications (« Vu par M. Dupont »), à la signature : chantier, postes budgétaires, tâches, facture d'acompte en brouillon aux bons taux, prospect → client, affaire gagnée (idempotent) ; tâche planifiée relances J+7 et expirations.
- Web : liste des devis, éditeur (calcul instantané, enregistrement automatique, bibliothèque, dictée vocale ou texte, TVA justifiée, options, acompte, validité, visite technique à côté, suivi), envoi, comparatif, duplication, modèles ; carte « Devis » sur l'affaire ; portail client mobile (options en direct, signature tracée ou nom saisi, attestation 6 %).
- Seed : 4 devis (Dupont en préparation à 6 % avec option douche à l'italienne, devis vu, envoyés, B2B en autoliquidation).
- Tests : 14 intégration API M3, 2 worker (chantier créé une seule fois, relances/expirations), 2 PDF, 7 domaine ; E2E P2 complet (devis → envoi → « Vu par » en direct → signature mobile avec attestation → chantier créé, affaire gagnée).

### M4 — Chantier pivot ✅
- Domaine : calendrier belge (fériés, jours ouvrés), étapes du chantier, « jour n sur m », avenants calculés comme un devis, mentions @, liste « À faire » triée ; tests.
- Base : avenants et lignes, grand livre des coûts engagés `ProjectCost`, commentaires, tâches (avancement, checklist, assignation, échéance), timeline (montant, données), relations chantier ↔ client/adresse ; RLS sur tout (ADR 0013).
- API : liste et cockpit recalculés depuis les données (marge prévue/estimée, engagé par catégorie, facturé, avancement pondéré, dérive, pastille d'état), fiche, cycle de vie (préparation → en cours ⇄ suspendu), tâches, coûts divers, fil (entrées + commentaires, filtres), commentaires avec mentions, avenants (brouillon, envoi numéroté avec PDF, retrait, refus, PDF), recherche ⌘K, portail chantier (consultation, questions, validation signée ou refus d'un avenant, documents, flux temps réel), photos de chantier avec visibilité client.
- Worker : e-mail d'avenant (PDF + lien), avenant signé → postes, contrat, tâches, date de fin ; fil (statut, photos regroupées, tâches, coûts, dérive), alerte de dérive unique par poste, notifications (mentions, questions du client), réponse envoyée au client, temps réel cockpit/listes/portail.
- Web : `/chantiers` (vues, recherche, avancement, contrat, marge), cockpit conforme à la maquette (en-tête, barre d'étapes, fil en direct, marge en direct, avancement par poste, à faire) + onglets Tâches, Photos et documents, Avenants (éditeur avec bibliothèque, suivi, échanges client), Budget (par poste, coûts divers) ; « Chantiers actifs » dans la barre latérale ; palette ⌘K (recherche, actions, `?`, « g » + lettre) ; portail chantier mobile conforme à la maquette ; lien « Suivre mon chantier » après la signature du devis.
- Seed : 25 chantiers dans tous les statuts (dont un ≥ 500 000 € en préparation pour Check In and Out) ; chantier Dupont des maquettes (62 %, marge 24,0 % → 21,8 %, dérive Carrelage, facture 2026-118 échue, avenant n°3 en attente avec question du client).
- Tests : 13 intégration API M4 (chiffres, dérive, tâches, statut, fil, mentions, avenants, portail, signature, isolation, Ouvrier), 3 worker (avenant signé idempotent, dérive unique, photos regroupées), 15 domaine ; E2E P5 complet (deux navigateurs synchronisés, question/réponse, validation sur mobile, budget mis à jour, ⌘K) et cockpit mobile.

### M5 — Terrain ✅
- Domaine : distance (haversine), géorepérage avec tolérance + précision GPS, heures par paires IN/OUT (pause paramétrable, anomalies), coût main-d'œuvre et répartition sur les postes, seuil Check In and Out, minuit à Bruxelles, « 8 h 02 » ; tests.
- Base : pointages (UUID du téléphone, position, distance, hors ligne, statut, ONSS), créneaux de planning, signalements, bons de régie et lignes, rapports journaliers ; RLS (ADR 0014).
- API : `/field/today` (chantier du jour, équipe sur place, tâches du jour, droits), pointage idempotent (soi, équipe par le chef, bureau), synchro hors ligne par lots (une transaction par action, erreurs métier par action), signalements (photos, → avenant en un clic, résolu), bons de régie (brouillon sans prix, signature sur téléphone, numéro BR, PDF signé + empreinte, régénéré si absent), heures (anomalies, coût pour les rôles finance), validation par le chef (journée verrouillée), rapport journalier (calculé + notes, arrêté), `/field/hours`, export CSV Check In and Out, relance ONSS. `FieldCipher` partagé dans `packages/db`.
- Worker : arrivée de l'équipe (une entrée par jour, portail « L'équipe de Karim est chez vous depuis 8 h 02 »), coût main-d'œuvre recalculé par personne/jour → `ProjectCost` + dérive, transmission ONSS via l'adaptateur (mock), refus visible + notification, signalements (alerte, photos jointes), bons signés (fil, notification), temps réel terrain.
- Web : `/terrain` PWA conforme à la maquette (manifeste traduit, service worker, icônes), tutoiement, file hors ligne IndexedDB avec affichage optimiste et pastille d'état, photo (compressée, géodatée, par tâche), signaler (photos), faire signer (signature du client), équipe du chef, mes heures, validation, rapport du jour, profil (synchro, installation, déconnexion protégée) ; onglet « Terrain » du cockpit (signalements → avenant, heures et validation, rapports, bons de régie, export et relance ONSS) ; « Vue terrain » dans la barre latérale ; l'Ouvrier arrive directement sur `/terrain`. Le temps réel recharge les requêtes actives après chaque reconnexion SSE.
- Seed : pointages de l'équipe de Karim sur Dupont (validés, dernière journée à valider, un pointage loin du chantier), arrivée de 8 h 02, planning de l'équipe, signalement à l'origine de l'avenant n°3 + un à traiter, bon de régie signé, rapports arrêtés.
- Tests : 10 intégration API M5, 2 worker (arrivée unique, main-d'œuvre, ONSS envoyé/refusé, signalement + photo), domaine ; E2E P4 sur téléphone (pointage, portail, photo, tâche, signalement → avenant, hors ligne puis synchro, bon de régie signé, validation, rapport). Suite E2E complète verte en local (21) et en CI (run 26). Note vocale sur les signalements (transcrite, écoutable au bureau).

### M6 — Planning ✅ (CI run 32)
- Domaine : demi-journées ouvrées (week-ends et fériés exclus), déplacer en gardant la durée, redimensionner, conflits (double affectation, congé, équipes développées), première demi-journée planifiée, iCal RFC 5545 (échappement, pliage à 75 octets) ; tests.
- Base : affectations en plage (`ScheduleSlot` avec demi-journées et tâche, données M5 conservées, CHECK), liens iCal hachés (RLS), date d'arrivée annoncée (ADR 0015).
- API : grille `/planning` (équipes, personnes, chantiers, affectations, congés, conflits, tâches à planifier), création/déplacement/suppression idempotents (identifiant client), date de début du chantier tenue par le planning en préparation, `/field/planning`, liens iCal (soi, ou bureau pour tous).
- Worker : temps réel du planning, date de début annoncée au client une fois stable (fil, portail, e-mail), planning du lendemain à 18 h (notification + e-mail tutoyé).
- Web : `/planning` (semaine/mois, équipes/personnes/chantiers, glisser-déposer des tâches et des blocs, poignée de durée, flèches au clavier, dialogue complet, conflits, agenda sur téléphone), onglet « Planning » du terrain + « Ajouter à mon agenda », lien iCal depuis la fiche employé, date de début sur le portail.
- Seed : équipe de Karim (Dupont → extension → châssis), équipe Toiture ; congés en conflit ; conformité électrique à planifier.
- Tests : 6 intégration API M6, 2 worker (annonce unique et différée, planning du lendemain unique), 5 domaine ; E2E P3 (glisser-déposer, conflit de congé, clavier, dialogue, portail, iCal) + planning sur téléphone.

### M7 — Achats et Peppol entrant (en attente CI)
- Domaine : regroupement par fournisseur, engagement restant, rapprochement (BC → référence chantier → adresse de livraison), appariement des lignes, ventilation, écarts avec la commande ; tests.
- Base : bons de commande (+ lignes), réceptions, factures fournisseurs (+ lignes), imputations ; RLS (ADR 0016).
- Documents : lecture UBL (Peppol BIS 3), PDF de bon de commande (régénéré s'il manque).
- API : fournisseurs (BCE → TVA + Peppol, IBAN), proposition de commande depuis les matériaux du devis (sections obligatoires + options retenues), bons de commande (brouillon idempotent, envoi avec n° BC continu, PDF, réceptions, annulation), factures fournisseurs (à imputer / imputées / à payer, détail, document, imputation et ventilation multi-chantiers, statuts), Peppol entrant simulé (mock) et webhook signé, dépôt PDF/photo/XML.
- Worker : envoi du BC (e-mail + PDF), rapprochement automatique (extraction IA si dépôt), boîte « À imputer » + notification, grand livre (facture par ventilation, engagement restant du BC), écarts notifiés, timeline.
- Web : module « Achats » (barre latérale) — factures fournisseurs (boîte « À imputer » avec suggestions classées et imputation en un clic, ventilation sur plusieurs chantiers et postes, écarts, valider / mettre à payer / bloquer / payée, dépôt d'une facture), bons de commande (liste, tiroir : brouillon modifiable, envoi, PDF, réception partielle, annulation), fournisseurs ; onglet « Achats » du cockpit (« Commander les matériaux » → un BC par fournisseur, factures imputées au chantier).
- Seed : 4 fournisseurs fictifs, fournisseur préféré des matériaux de la bibliothèque, coûts fournisseurs convertis en BC + factures Peppol rapprochées (mêmes montants : marges inchangées) — 61/63 imputées automatiquement (97 %), 2 dans « À imputer », 3 BC ouverts + 1 brouillon, BC2026-417 de Dupont.
- Tests : 6 intégration API, 2 worker ; E2E P6 (BC depuis le devis, envoi, facture Peppol imputée seule avec écart, timeline, validation, « À imputer » ventilée sur deux chantiers, dépôt PDF extrait et rapproché, comptable en lecture) + téléphone.
- Report : contrôle 30bis avant « à payer » (P6.4) → M9 avec la sous-traitance.

## Reste à faire
M8 → M13 selon `docs/11-plan-de-livraison.md`.

## Écarts avec la spécification
- Nouveau paquet `packages/documents` (PDF) en plus de la liste de `CLAUDE.md` (ADR 0012).
- Formule du coût projeté corrigée (ADR 0004).
- `exclude_from_hc` remplacé par des services ponctuels « au repos et sains » (ADR 0007).
- Image MinIO communautaire `pgsty/minio` (ADR 0006).
- Auth maison au lieu de Better Auth (ADR 0002) ; même origine via proxy Next (ADR 0003).
- Navigation : seuls les modules livrés apparaissent (pas de lien vers un écran vide).
- Cockpit : le bouton « Facturer l'avancement » de la maquette arrive avec M8 ; « Nouvel avenant » tient sa place d'action principale d'ici là. « Relancer » une facture échue arrive aussi avec M8.
- Seed Dupont : engagé ≈ 19 000 € au lieu des 21 160 € de la maquette (incompatible avec 21,8 % de marge estimée selon l'ADR 0004)  ; le seed ne dépose pas encore de photos de chantier dans le stockage (à ajouter, M13 seed de démo).
- La numérotation des factures du seed reprend à 2026-100 (« ancien logiciel ») pour que la facture Dupont porte le n° 2026-118.
- Vue carte des chantiers actifs (03 §5) : reportée à M11 (pilotage), avec le géocodage des adresses.
- Vue terrain : onglets Aujourd'hui, Planning, Heures, Profil (la maquette n'en montre que trois) ; la carte du chantier est un lien d'itinéraire (pas de tuiles cartographiques externes). La signature d'un bon de régie demande du réseau (PDF signé produit par le serveur) — ADR 0014.

## Dette technique connue
- Planning : pas de météo indicative (optionnelle en 03 §6, demanderait une API externe).
- Quelques routes M1/M2 lancent des requêtes en parallèle (`Promise.all`) dans une même transaction : accepté par `pg` 8 (avertissement de dépréciation), à rendre séquentiel avant une montée en `pg` 9.

## Limites rencontrées dans l'environnement cloud
- Docker est installé mais le démon n'est pas lancé : `dockerd &` (le hook le fait).
- Le TLS sortant est intercepté par le proxy de session : les conteneurs de build ont besoin de l'AC (`docker/docker-compose.sandbox.yml` la passe en secret de build). Sans effet sur Coolify.
- `minio/minio` et `quay.io` indisponibles : fork `pgsty/minio`.
- Playwright épinglé en 1.56.1 pour utiliser le Chromium préinstallé (`/opt/pw-browsers`).
- `pkill -f` avec un motif présent dans la commande courante tue le shell de l'outil : utiliser `ps | grep | kill`.

## À valider métier (comptable / juriste)
- Taux de retenue 30bis et seuils de la déclaration de travaux (`05` §7)
- Forme de l'attestation 6 % et éligibilité ligne par ligne (`05` §3)
- Mention légale d'autoliquidation (`05` §3)
- Délai d'émission des factures et durée de conservation (`05` §2) — bucket légal paramétré à 10 ans
- Règles de relance B2B / B2C à jour (`05` §6)
- Accès logiciel aux services web ONSS (Check In and Out, 30bis) (`07`)
- Régime intracommunautaire pour un client assujetti étranger (proposé automatiquement, `domain/vat.ts`)

## Améliorations repérées en jouant les parcours
- M4 · Sophie · cockpit : un retard de chantier proposait « Revoir les dates » sans action → bouton retiré tant qu'il ne mène nulle part.
- M4 · Sophie · tâches : l'avancement réel (80 %) s'affichait arrondi au palier (75 %) → la valeur réelle est proposée parmi les paliers.
- M4 · Sophie · avenant : le dialogue d'envoi disparaissait au premier enregistrement d'un nouvel avenant (l'éditeur se recréait) → envoi porté par le tiroir.
- M4 · démo tôt le matin : les événements « du jour » (13 h 30) apparaissaient dans le futur → datés de la veille ouvrable avant 13 h 35.
- M4 · M. Dupont · portail : le devis signé importé sans PDF archivé menait à une erreur → PDF régénéré avec la preuve de signature.
- M3 · M. Dupont (mobile) · signature : un tracé qui finissait hors de la zone fermait le dialogue (clic sur le fond) → un dialogue ne se ferme que si l'appui commence sur le fond.
- M3 · Sophie · éditeur : l'ouvrage était toujours éclaté (`z.coerce.boolean()` lit « false » comme vrai) → `z.stringbool()` dans toute l'API.
- M3 · Sophie · seed/bibliothèques types : l'installation ignorait des articles quand un autre tenant les avait (requête sans filtre tenant en contexte système) → filtre explicite.
- M3 · pastilles « attention » sous 4,5:1 → couleur de texte dédiée `--warn-ink`.
- M3 · Sophie (mobile) · éditeur : total en bas de page → barre de total collante sur téléphone.
- M2 · Karim (mobile) · visite : la barre « Modifications non enregistrées » débordait de l'écran à 390 px → libellé masqué et boutons pleine largeur sur téléphone.
- M2 · Karim (mobile) · visite : photos et note vocale étaient tout en bas → affichées juste après l'adresse sur téléphone ; libellés de mesure sur leur propre ligne.
- M2 · Sophie · bibliothèque : prestations au temps à 0,00 € dans les bibliothèques types → temps × taux de référence.
- M2 · Sophie · pipeline : bouton « Déplacer vers… » encombrant sur chaque carte → icône discrète en coin (toujours accessible au clavier).
- M2 · Sophie · « Enregistrer » ambigu (note vocale / visite) → « Dicter une note ».
- M0 · Luca (Ouvrier) · Paramètres : le lien menait à une page sans rien d'utilisable → lien et page conditionnés aux sections autorisées.
- M0 · tous · police : l'import Google Fonts cassait le CSS et posait un problème RGPD → Geist embarquée.
