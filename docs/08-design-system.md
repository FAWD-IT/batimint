# 08 — Design system

Direction validée : **« l'Uber du BTP »**. Noir et blanc très contrasté, boutons noirs francs, un seul accent bleu électrique réservé à ce qui est **live** ou à **l'action principale**, et des couleurs qui ne servent qu'à signaler un état. Calme, dense mais lisible ; on vise Linear ou Uber, pas un ERP.

Les maquettes de référence sont dans `design/maquettes/` (cockpit chantier, app terrain, portail client). Ce sont des fichiers de travail d'un outil de design : à lire comme référence de structure, de contenu et de style, pas à exécuter. Les tokens sont dans `design/tokens.css` et sont la source de vérité (Tailwind les consomme).

## Couleurs
| Token | Clair | Sombre | Usage |
|---|---|---|---|
| `--bg` | `#F4F3EF` | `#0E0E0E` | Fond d'application (blanc cassé chaud) |
| `--surface` | `#FFFFFF` | `#171717` | Cartes, panneaux |
| `--ink` | `#111111` | `#F2F2F2` | Texte principal, boutons primaires (fond) |
| `--ink-inverse` | `#FFFFFF` | `#111111` | Texte sur `--ink` |
| `--muted` | `#5E5E5A` | `#A3A3A3` | Texte secondaire (contraste AA garanti) |
| `--line` | `#E4E2DC` | `#2A2A2A` | Bordures |
| `--line-soft` | `#EFEDE8` | `#222222` | Séparateurs de liste |
| `--accent` | `#2F4BFF` | `#7D93FF` | Live, action principale, progression |
| `--accent-soft` | `#F5F7FF` | `#1A1F3D` | Fond de mise en avant d'un élément live |
| `--good` | `#1E7B45` | `#3DBE73` | Sain, validé, payé |
| `--warn` | `#B4570B` | `#F0A045` | Dérive, à surveiller |
| `--crit` | `#B42318` | `#EF6B5E` | Perte, retard, échec |
| `--panel-dark` | `#111111` | `#000000` | Barre latérale et cartes « héros » (marge, chantier du jour) |

**Règles d'usage**
- L'accent n'apparaît que pour : l'indicateur « En direct », la progression en cours, l'action principale d'un écran mobile, un élément tout juste arrivé dans le fil. Jamais en décoration.
- Le vert, l'orange et le rouge portent **toujours** un sens d'état. Ils sont doublés d'un libellé ou d'une icône (jamais la couleur seule).
- Le bouton primaire de bureau est **noir**. Sur mobile, l'action unique de l'écran peut être en accent (« Pointer l'arrivée », « Payer »).
- Les portails externes remplacent `--accent` par la couleur de marque du tenant, à condition qu'elle passe le contraste AA (sinon on garde la nôtre).

## Typographie
- **Geist** (Google Fonts) pour tout, chiffres en `font-variant-numeric: tabular-nums` partout où il y a des montants.
- Échelle : 44/700 (KPI héros) · 30/700 (titre de page) · 24/700 (titre mobile) · 17/600 (titre de carte) · 15/600 (libellé fort) · 14/400 (corps) · 13/400 (secondaire) · 12/600 uppercase +0.08em (sur-titres de section).
- Lettrage : −0.025em sur les titres ≥ 24 px.

## Espacement, formes et profondeur
- Base de 4 px. Paddings de carte : 20–24 px desktop, 16–18 px mobile. Gouttières de 24 px.
- Rayons : 8 (vignettes), 10 (contrôles), 12 (boutons), 16 (cartes desktop), 20 (cartes mobiles), 999 (pastilles).
- **Pas d'ombres ni de dégradés décoratifs**. La profondeur vient des bordures `--line` et des contrastes de surface.

## Composants (dans `packages/ui`)
- **Bouton** : primaire (noir), secondaire (bordure), accent (mobile, action unique), danger, ghost. Hauteur 44 (desktop) ou 56+ (terrain). États focus, chargement et désactivé.
- **Barre d'étapes** du chantier : 5 segments (Devis signé · Travaux · Réception · Facture finale · Payé). Le segment en cours est rempli en accent au prorata de l'avancement.
- **Carte héros sombre** (`--panel-dark`) : marge en direct sur le bureau, chantier du jour sur le terrain, carte « À valider » sur le portail. Une seule par écran.
- **Fil chronologique** : heure · pastille d'icône · titre + détail · montant aligné à droite. L'élément le plus récent issu d'un automatisme est surligné `--accent-soft`.
- **Jauges** : barre de 6–8 px, piste `--line`, remplissage `--ink` (normal), `--warn` (dérive) ou `--accent` (en cours).
- **Pastilles** (chips) : régime TVA, B2C/B2B, statut.
- **Tableaux** denses avec en-têtes collants, tri, filtres, sélection multiple et actions groupées. Montants alignés à droite.
- **Palette de commandes ⌘K**, **toasts** avec « Annuler », **tiroirs latéraux** pour l'édition rapide sans quitter le contexte, **états vides** illustrés par une phrase et une action.
- **Éditeur de devis** : arborescence de postes, ligne active étendue, recherche bibliothèque inline (`/`), totaux et marge collants en bas.
- **Planning** : grille ressources × jours, blocs colorés par chantier, glisser-déposer.
- **Signature** : zone de tracé pleine largeur, effacer, nom en clair, case d'acceptation.

## Les 3 surfaces
1. **Back-office** : barre latérale sombre (logo, ⌘K, navigation, chantiers actifs avec pastille d'état et %), contenu sur `--bg`. La page chantier comporte un en-tête (fil d'Ariane, titre, adresse, pastilles, actions), la barre d'étapes, puis deux colonnes : fil chronologique (≈ 60 %) et colonne droite (marge en direct, avancement par poste, à faire).
2. **Terrain** : fond `--bg`, salutation et état hors-ligne, carte héros « ton chantier du jour », énorme bouton accent « Pointer l'arrivée » (88 px), trois actions carrées (Photo, Signaler, Faire signer), tâches à cocher (cibles ≥ 44 px), barre d'onglets en bas. Aucun prix. Tutoiement.
3. **Portail client** : fond blanc, logo et nom de l'entreprise en tête, indicateur « En direct », titre narratif (« L'équipe de Karim est chez vous depuis 8h02 »), progression, photo du jour, cartes d'action (sombre pour « À valider », accent pour « Payer »), contact en pied. Vouvoiement.

## Mouvement et ressenti
- Transitions courtes (120–180 ms, ease-out), squelettes plutôt que spinners, UI optimiste.
- Arrivée d'un événement live : l'entrée glisse dans le fil et le surlignage s'estompe en 2 s. Respect de `prefers-reduced-motion`.

## Ton des textes
Court, concret, au présent. Le système raconte ce qu'il a fait (« Imputée au poste Carrelage, sans saisie »). Pas de jargon technique côté utilisateur (« Peppol » est accepté, c'est un terme métier).

## Accessibilité
Contraste AA minimum, focus visible, vrais éléments `button`/`a`/`input` + `label`, `aria-label` sur les boutons-icônes, navigation clavier complète, cibles ≥ 44 px (≥ 56 px pour le terrain).
