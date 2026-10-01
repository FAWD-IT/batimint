# PROGRESS — tenu à jour par l'agent

Ce fichier est le point de reprise entre sessions cloud. Une nouvelle session doit pouvoir reprendre le travail en ne lisant que lui et `CLAUDE.md`.

## Jalon en cours
**M3 — Devis et signature** — livré (domaine, API, PDF, portail, worker, écrans, seed, E2E P2). Reste : vérifier la CI de la branche, puis démarrer M4.

(L'étiquette `m0-done` existe localement mais le push de tags est refusé par la politique de la session : seule la branche est poussée.)

## Prochaine action
Démarrer M4 (chantier pivot, maquette `design/maquettes/cockpit-chantier.dc.html`) : page `/chantiers/[id]` à partir des `Project`, `BudgetLine`, `Task`, `TimelineEntry` créés à la signature ; budget et marge en direct (`packages/domain/budget.ts`), timeline, documents/photos, avenants (P5), ⌘K. Le seed doit alors créer le chantier Dupont à 62 % (`docs/09`).

## Relancer l'environnement
```bash
# Session cloud : le démon Docker n'est pas lancé par défaut (le hook de session le démarre).
docker info >/dev/null 2>&1 || (nohup dockerd >/tmp/dockerd.log 2>&1 &)
pnpm install
cp -n .env.example .env
pnpm services:up          # Postgres :5432, MinIO :9000/:9001, Mailpit :1025/:8025
pnpm db:migrate           # migrations + rôle batimint_app + vérification RLS
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

## Reste à faire
M1 → M13 selon `docs/11-plan-de-livraison.md`.

## Écarts avec la spécification
- Nouveau paquet `packages/documents` (PDF) en plus de la liste de `CLAUDE.md` (ADR 0012).
- Formule du coût projeté corrigée (ADR 0004).
- `exclude_from_hc` remplacé par des services ponctuels « au repos et sains » (ADR 0007).
- Image MinIO communautaire `pgsty/minio` (ADR 0006).
- Auth maison au lieu de Better Auth (ADR 0002) ; même origine via proxy Next (ADR 0003).
- Navigation : seuls les modules livrés apparaissent (pas de lien vers un écran vide). ⌘K arrive avec M4.

## Dette technique connue
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
