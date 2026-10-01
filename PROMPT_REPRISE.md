# PROMPT DE REPRISE — pour chaque nouvelle session cloud

> À utiliser quand une session s'est arrêtée, ou pour enchaîner le jalon suivant après avoir mergé le précédent.

---

Tu reprends la construction de **Batimint**. Lis `CLAUDE.md`, puis `docs/PROGRESS.md` : il indique le jalon en cours, ce qui est fait et la prochaine action. Relis ensuite les sections de `docs/` utiles au jalon en cours.

Relance l'environnement comme indiqué dans `PROGRESS.md`. Vérifie que l'état du repo correspond bien à ce qui y est écrit (tests, app qui démarre), puis continue là où le travail s'est arrêté, avec les mêmes exigences que le prompt de lancement (`PROMPT_CLAUDE_CODE.md`).

Commite et pousse régulièrement, et tiens `PROGRESS.md` à jour.
