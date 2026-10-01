# PROMPT DE LANCEMENT — à coller dans une session Claude Code cloud (claude.ai/code)

> Ouvre une session sur le repo GitHub `batimint` (environnement « Batimint », voir README), puis colle le texte ci-dessous.

---

Tu vas construire **Batimint**, un SaaS de gestion pour les entreprises belges de la construction. Le concurrent de référence est Vertuoza. Notre angle : une expérience « Uber du BTP ». Le chantier est l'objet central, chaque action se propage seule aux autres modules, et chaque acteur voit le même état en temps réel (patron, bureau, ouvrier, client final, sous-traitant).

Tout ce qu'on a décidé est dans `docs/`. Lis-le en entier avant d'écrire du code, dans l'ordre des numéros. `CLAUDE.md` contient les règles permanentes du projet, y compris les contraintes de l'environnement cloud dans lequel tu tournes.

**Ce que j'attends : un produit complet, pas un prototype.** Un patron de PME BTP doit pouvoir s'inscrire et paramétrer son entreprise. Il doit pouvoir faire un devis, le faire signer, piloter le chantier, recevoir ses factures fournisseurs par Peppol, facturer l'avancement et se faire payer. Tout ça sans ressaisie et sans tomber sur un écran vide ou un bouton qui ne fait rien. Le périmètre est décrit dans `docs/03-modules-fonctionnels.md`, et tout y est dans le scope de cette livraison web. Seules exceptions : l'app mobile Flutter (elle viendra après, mais l'API doit être prête pour elle) et l'open banking. À la fin, le repo doit se déployer tel quel sur Coolify depuis GitHub.

**Comment je veux que tu travailles :**
- Avance jalon par jalon selon `docs/11-plan-de-livraison.md`. Un jalon n'est fini que quand ses critères de sortie passent réellement : tests verts, parcours joués, app qui démarre. Les critères doivent tenir sur la machine, pas seulement sur le papier.
- Sois autonome. Quand un choix n'est pas tranché dans les docs, décide comme le ferait un excellent CTO. Note la décision dans `docs/adr/` et continue. Ne t'arrête pour me demander que si c'est irréversible, si ça touche à de l'argent réel ou si tu as besoin d'un secret.
- Pense comme un utilisateur, pas comme un développeur. Les parcours de `docs/02-personas-parcours.md` sont la vraie spécification. Joue-les toi-même de bout en bout (Playwright) avec chaque persona et corrige tout ce qui est confus, lent ou incomplet : états vides, erreurs, cas limites, mobile, clavier. Si un parcours te semble mal pensé, améliore-le et explique pourquoi dans l'ADR.
- Les règles belges (TVA, autoliquidation, 6 %, Peppol, 30bis, Check In and Out at Work) ne sont pas négociables. Elles sont dans `docs/05-conformite-belge.md`. Les calculs d'argent vivent dans un package de domaine pur, testé à fond.
- Les intégrations externes (getpeppr, Chift, ONSS, Mollie, VIES, IA) passent par des adaptateurs avec une implémentation simulée. Tout le produit doit donc tourner et se tester sans aucune clé ni accès réseau à ces services.
- Respecte le design system de `docs/08-design-system.md` et les maquettes de `design/maquettes/`. Le niveau visé est celui de Linear ou Uber, pas celui d'un ERP.
- **Tu travailles dans une session cloud qui peut s'arrêter ou être compactée.** Commite et pousse ton travail après chaque étape significative, jamais plus d'une heure de travail non poussé. Tiens `docs/PROGRESS.md` à jour en permanence : il doit suffire à une nouvelle session pour reprendre exactement où tu en es, avec le jalon en cours, la prochaine action et les commandes pour relancer l'environnement.
- Les commandes longues (installations, builds, suites E2E) se lancent en arrière-plan avec un fichier de log, que tu consultes ensuite.

**Fin de mission :**
- Tous les jalons sont validés.
- `docker compose -f docker-compose.coolify.yml up` démarre l'ensemble avec la base migrée et un tenant de démonstration.
- La CI GitHub Actions passe.
- `docs/10-deploiement-coolify.md` permet de déployer sur Coolify depuis GitHub sans autre information.
- Termine par un rapport : ce qui est livré, comment l'essayer, les limites connues et les décisions prises.

Commence par lire les docs, puis donne-moi en quelques lignes ton découpage du jalon M0 et lance-toi.
