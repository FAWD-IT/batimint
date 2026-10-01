# Batimint

SaaS de gestion pour les PME belges du BTP : le chantier est l'objet pivot, chaque action se propage seule et chacun voit le même état en direct. Spécification dans `docs/` ; avancement dans `docs/PROGRESS.md`.

## Démarrer en local

Prérequis : Node 22, pnpm 10 (`corepack enable`), Docker.

```bash
pnpm install
pnpm dev            # Postgres + MinIO + Mailpit (docker compose), migrations, puis web/api/worker
pnpm db:seed        # tenant de démo « Rénov'Habitat » (idempotent ; pnpm db:reset pour repartir de zéro)
```

| Adresse | Quoi |
|---|---|
| http://localhost:3000 | Interface (back-office, portails, terrain) |
| http://localhost:4000/docs | API (OpenAPI 3.1, `/v1/openapi.json`) |
| http://localhost:8025 | Mailpit (e-mails envoyés en dev) |
| http://localhost:9001 | Console MinIO (`batimint` / `batimint-dev-secret`) |

### Comptes de démonstration (dev et instance de démo uniquement)
Mot de passe commun : `batimint-demo`.

| Persona | E-mail | Rôle |
|---|---|---|
| Marc Lefèvre, patron | marc@renov-habitat.be | Owner |
| Sophie Martin, bureau | sophie@renov-habitat.be | Bureau |
| Karim Benali, chef de chantier | karim@renov-habitat.be | Chef de chantier |
| Luca Rossi, ouvrier | luca@renov-habitat.be | Ouvrier |
| Isabelle Lambert, comptable | lambert@fiduciaire-lambert.be | Comptable |

### Commandes
`pnpm test` (unitaires + intégration contre Postgres) · `pnpm test:e2e` (Playwright, app démarrée) · `pnpm lint` · `pnpm typecheck` · `pnpm build` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm admin:create -- --email …`

### Stack de production en local
```bash
cp .env.example .env
docker compose -f docker-compose.coolify.yml up --build    # ajouter SEED_DEMO=true dans .env pour la démo
```
Déploiement : `docs/10-deploiement-coolify.md`. Décisions d'architecture : `docs/adr/`.

---

# Pack de démarrage pour Claude Code (cloud)

Spécification complète du SaaS BTP « Batimint » (*bâtiment* en wallon), prête à être construite par Claude Code dans une session cloud, puis déployée sur Coolify depuis GitHub.

## Contenu
| Fichier | Rôle |
|---|---|
| `PROMPT_CLAUDE_CODE.md` | Prompt de lancement (première session) |
| `PROMPT_REPRISE.md` | Prompt pour chaque session suivante |
| `CLAUDE.md` | Règles permanentes : stack, non-négociables, environnement cloud, définition de « fini » |
| `.claude/` | Hook de démarrage de session (installation des dépendances) |
| `docs/01` à `docs/11` | Vision, parcours, modules, domaine, conformité belge, architecture, intégrations, design system, tests, déploiement Coolify, plan de livraison |
| `docs/PROGRESS.md`, `docs/adr/` | Suivi et décisions, tenus par l'agent |
| `design/` | Tokens et maquettes validées |

## Mise en place (une seule fois)

### 1. Le repo GitHub
1. Crée un repo **privé** `batimint` sur GitHub.
2. Dézippe le pack, puis pousse-le sur `main` :
   ```bash
   git init -b main && git add . && git commit -m "docs: spécification initiale"
   git remote add origin git@github.com:<toi>/batimint.git && git push -u origin main
   ```
3. Installe la **Claude GitHub App** sur ce repo (proposé à l'onboarding de claude.ai/code, ou via github.com/apps/claude). Elle permet aux sessions de cloner et de pousser, et active l'auto-fix des PR quand la CI casse.

### 2. L'environnement cloud
Sur claude.ai/code, crée un environnement **Batimint** :
- **Réseau** : *Trusted*. Ça suffit jusqu'au jalon M11, puisque tout tourne en mock.
- **Variables d'environnement** : `BASH_DEFAULT_TIMEOUT_MS=600000` et `BASH_MAX_TIMEOUT_MS=600000`, pour laisser plus de temps aux builds et aux tests.
- **Setup script** (optionnel, accélère les sessions grâce au cache) :
  ```bash
  npx -y playwright@latest install-deps chromium || true
  ```

### 3. Lancer la construction
1. Nouvelle session sur claude.ai/code, repo `batimint`, environnement Batimint.
2. Colle le contenu de `PROMPT_CLAUDE_CODE.md`.
3. Laisse-le avancer. Tu peux suivre et intervenir depuis le navigateur ou l'app mobile.

## Le cycle de travail
- L'agent travaille sur la branche de sa session et pousse régulièrement.
- **À chaque jalon terminé**, crée la PR depuis la session, vérifie la CI, puis merge sur `main`.
- Si une session s'arrête, ou pour enchaîner le jalon suivant : nouvelle session, colle `PROMPT_REPRISE.md`. `docs/PROGRESS.md` lui dit où reprendre.
- Les sessions consomment ton quota Claude habituel. Une construction de cette taille prend de nombreuses sessions : c'est normal.

## Jalon M12 (vraies intégrations)
Seulement à ce moment-là :
- passe l'environnement en réseau **Custom** et ajoute les domaines d'API nécessaires (getpeppr, Chift, Mollie, VIES, Anthropic), en plus des domaines par défaut ;
- ajoute les **clés sandbox** dans les variables de l'environnement. Jamais de clé de production : ces variables sont lisibles par quiconque utilise l'environnement.

## Mise en ligne
Suis `docs/10-deploiement-coolify.md` (Coolify branché sur `main`, déploiement automatique à chaque merge). Avant la production réelle, fais valider la section « À valider métier » de `docs/PROGRESS.md` par ton comptable.
