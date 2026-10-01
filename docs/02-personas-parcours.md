# 02 — Personas et parcours

Ces parcours sont **la spécification de référence**. Chacun devient un test E2E Playwright joué avec le persona concerné sur le tenant de démo. Les « attendus » décrivent ce que le système doit faire seul.

## Personas

| Persona | Rôle | Support | Ce qu'il veut |
|---|---|---|---|
| **Marc**, 46 ans, patron de « Rénov'Habitat SRL » (12 personnes, Charleroi) | Owner | Ordinateur le soir, téléphone en journée | Savoir où il gagne et perd de l'argent, faire ses devis vite, ne plus courir après les paiements |
| **Sophie**, employée de bureau | Bureau | Ordinateur | Devis, factures, commandes et planning sans double encodage |
| **Karim**, chef de chantier | Chef de chantier | Téléphone, parfois tablette | Savoir où aller, avec qui, quoi faire ; documenter vite |
| **Luca**, ouvrier | Ouvrier | Téléphone, gants, plein soleil | Pointer, prendre des photos, signaler un problème |
| **Mme Lambert**, comptable externe | Comptable (lecture + exports) | Ordinateur | Recevoir ventes et achats propres dans son logiciel |
| **M. Dupont**, particulier | Client final (lien sans compte) | Téléphone | Savoir ce qui se passe chez lui, valider, payer |
| **Électro Pirson SPRL** | Sous-traitant (lien invité) | Téléphone ou ordinateur | Recevoir sa mission, déposer ses documents et sa facture |

## P1 — Inscription et mise en route (Marc, moins de 10 minutes)
1. Marc s'inscrit (e-mail + mot de passe, ou lien magique), puis saisit son numéro d'entreprise.
2. **Attendu :** le numéro de TVA est validé via VIES, et la raison sociale et l'adresse sont pré-remplies.
3. Il ajoute son logo, son IBAN, ses conditions générales, ses taux horaires et ses coefficients de marge par défaut.
4. Il importe sa bibliothèque de prix depuis un Excel ou un CSV, avec un mapping de colonnes assisté, un aperçu et un rapport d'erreurs. Il peut aussi partir d'une bibliothèque type par métier, fournie dans le seed.
5. Il active Peppol : **attendu**, l'entité légale est créée chez le fournisseur Peppol, l'état de vérification est affiché, et le mock passe à « actif » en dev.
6. Il invite Sophie (Bureau), Karim (Chef de chantier) et Luca (Ouvrier) : e-mail d'invitation, rôle pré-attribué.
7. Une checklist d'onboarding est visible tant qu'elle n'est pas complète, et chaque étape renvoie au bon écran.

## P2 — De la demande au devis signé (Sophie, Marc, M. Dupont)
1. Une demande arrive via le formulaire web embarquable, par e-mail transféré à l'adresse dédiée du tenant, ou par saisie manuelle. **Attendu :** fiche prospect et opportunité créées, et notification au bureau.
2. Karim fait la visite technique depuis son téléphone : photos, mesures, note vocale. **Attendu :** la note vocale est transcrite et rattachée à l'opportunité.
3. Sophie crée le devis depuis l'opportunité, avec les photos et notes visibles à côté. Elle compose par postes avec la bibliothèque (recherche instantanée, ouvrages composés, quantités). Elle peut aussi dicter : « 12 m² de faïence murale 30x60 pose comprise ». **Attendu :** lignes proposées par l'IA à partir de la bibliothèque, à valider une par une.
4. Le prix de revient, la marge par ligne et le total, ainsi que le temps de main-d'œuvre estimé, sont visibles en direct.
5. Le régime de TVA est déduit du client : particulier avec logement de plus de 10 ans → 6 % proposé, avec l'attestation à faire signer ; assujetti et travaux immobiliers → autoliquidation ; sinon 21 %. Sophie peut forcer le régime, avec une justification tracée.
6. Elle ajoute une option (« douche à l'italienne : +1 400 € ») et un acompte de 30 %.
7. Envoi : e-mail au client avec le lien du portail. **Attendu :** l'ouverture du devis est tracée et la timeline indique « Vu par M. Dupont ».
8. M. Dupont, sur son téléphone, choisit l'option, lit, signe (signature électronique simple avec horodatage, IP et empreinte du PDF) et signe aussi l'attestation 6 %.
9. **Attendu :** devis « signé », chantier créé automatiquement avec budget par poste et tâches, facture d'acompte générée en brouillon, notification à Marc, et le prospect devient client.

## P3 — Préparer et planifier le chantier (Sophie, Karim)
1. Sur le chantier créé, Sophie voit les tâches issues des postes du devis. Elle les planifie par glisser-déposer sur le planning des équipes (vues semaine et mois, par équipe ou par personne).
2. **Attendu :** les conflits (une personne sur deux chantiers, un congé) sont signalés, et le client reçoit la date de début sur son portail.
3. Elle génère les bons de commande fournisseurs depuis les matériaux du devis, groupés par fournisseur. Ils partent par e-mail avec un numéro de BC que le fournisseur reportera sur sa facture.
4. Pour un chantier ≥ 500 000 € HTVA, le système signale que Check In and Out at Work s'applique et prépare la déclaration de travaux.

## P4 — Une journée sur le terrain (Luca, Karim)
1. Luca ouvre `/terrain` (installé en PWA) : son chantier du jour, l'adresse, l'itinéraire, l'équipe et les tâches.
2. Il appuie sur **Pointer l'arrivée**. **Attendu :** pointage géolocalisé enregistré même hors ligne (synchro dès le retour du réseau), présence IN transmise à l'ONSS si le chantier est concerné, timeline « Équipe arrivée », et portail client « L'équipe est sur place ».
3. Il prend des photos (compressées, géodatées, rattachées à la tâche). Il coche des tâches, ce qui fait avancer le chantier.
4. Il signale un problème (« canalisation en plomb derrière la faïence ») avec photo. **Attendu :** alerte au bureau, proposition de créer un avenant.
5. Karim fait signer un bon de régie au client sur le téléphone pour un travail hors devis. **Attendu :** les heures et le matériel sont repris en facturation régie.
6. Pointage de départ : OUT transmis, heures calculées (pauses paramétrables) et coût main-d'œuvre imputé au chantier.
7. Rapport journalier généré automatiquement (heures, photos, tâches, signalements) et modifiable par Karim.

## P5 — Avenant (Sophie, M. Dupont)
1. Depuis le signalement, Sophie crée l'avenant n°2 en ligne de devis et l'envoie.
2. M. Dupont le reçoit en carte « À valider » sur son portail, valide ou pose une question (fil de discussion sur l'objet).
3. **Attendu :** une fois signé, budget, planning et montant du contrat mis à jour, et l'avenant devient facturable.

## P6 — Factures fournisseurs reçues par Peppol (aucun humain, puis Sophie)
1. Brico Pro envoie sa facture via Peppol. **Attendu :** réception par webhook, puis rapprochement automatique.
   - Le rapprochement se fait par numéro de BC, puis par référence chantier ou adresse, puis par suggestion IA sur les lignes.
   - La facture est imputée au poste du chantier, la marge est recalculée, une entrée timeline est créée, et une alerte part si le poste dépasse son budget.
2. Si le rapprochement est incertain, la facture va dans une boîte « À imputer » avec les suggestions classées. Sophie valide en un clic ou ventile sur plusieurs chantiers.
3. Les factures reçues hors Peppol (PDF par e-mail ou upload) suivent le même flux avec extraction IA.
4. Facture d'un sous-traitant : contrôle 30bis automatique avant le passage en « à payer », avec la retenue calculée si une dette existe.

## P7 — État d'avancement et facturation (Sophie, M. Dupont, Marc)
1. Sophie ouvre « Facturer l'avancement ». **Attendu :** pourcentages pré-remplis par poste à partir des tâches cochées et des quantités pointées, modifiables en %, en quantité ou en €.
2. L'état d'avancement est envoyé au client pour approbation (B2C) ou directement facturé (B2B, selon le paramétrage).
3. Après approbation, la facture d'avancement est générée. Elle déduit l'acompte au prorata, applique la retenue de garantie si le contrat en prévoit une, et porte les bonnes mentions de TVA.
4. Émission : numéro définitif. Envoi Peppol si le client est assujetti et inscrit (vérification dans l'annuaire Peppol), sinon e-mail avec PDF, QR code de virement EPC et communication structurée.
5. **Attendu :** statut d'envoi et de livraison Peppol suivi, relances automatiques selon un calendrier paramétrable, et paiement enregistré manuellement ou via lien de paiement.

## P8 — Le client final suit son chantier (M. Dupont)
Le portail, sans compte et via un lien signé révocable, affiche :
- l'étape actuelle et la progression, la date de fin prévue et la photo du jour ;
- les actions à faire (avenants, états d'avancement, attestation 6 %, paiement) ;
- les documents (devis, factures, PV de réception), un fil de questions par objet et le contact du chef de chantier.

Il est à l'image de l'entreprise (logo et couleur du tenant) et vouvoie le client.

## P9 — Sous-traitance (Sophie, Électro Pirson)
1. Sophie crée un contrat de sous-traitance sur un poste du chantier. **Attendu :** contrôle 30bis à la création et avant chaque paiement, avec l'état visible.
2. Le sous-traitant reçoit son lien invité : la mission, les dates, les documents à fournir (assurance, attestations). Il dépose sa facture, via Peppol ou par upload.
3. **Attendu :** facture imputée au poste, retenue 30bis calculée si nécessaire, et documents expirés signalés.

## P10 — Réception et clôture (Karim, M. Dupont, Marc)
1. Karim fait la réception provisoire sur le téléphone : PV avec réserves photographiées, signé par le client.
2. Les réserves deviennent des tâches. Une fois levées, la facture finale est générée (solde moins les acomptes et situations déjà facturés).
3. Réception définitive à la date prévue au contrat : libération de la retenue de garantie (facture ou note).
4. Clôture : rapport de rentabilité final (prévu vs réel par poste, heures, achats), et réutilisation des écarts pour corriger les prix de la bibliothèque, proposée à Marc.

## P11 — Le pilotage de Marc (tous les jours)
- **Aujourd'hui** : qui est où, ce qui a bougé depuis hier, les alertes (dérive de marge, retard, facture échue, document sous-traitant expiré).
- **Tableau de bord** : CA facturé et encaissé, encours clients, marge par chantier, carnet de commandes (devis signés non facturés), taux de transformation des devis, trésorerie prévisionnelle à 90 jours.
- **⌘K** partout : chercher un chantier, client, devis ou facture, et lancer une action (« nouveau devis Dupont »).

## P12 — Comptable (Mme Lambert)
- Accès en lecture aux ventes, achats et paiements, avec exports par période (CSV, UBL).
- Synchronisation via Chift vers son logiciel (WinBooks, Octopus, Yuki…) avec le statut de synchro par document et les erreurs lisibles.

## P13 — Stock et matériel (Sophie, Karim)
- Stock du dépôt et des camionnettes : sorties imputées au chantier (coût moyen pondéré), seuils d'alerte et réapprovisionnement en bon de commande.
- Matériel et outillage : affectation au chantier (coût d'usage journalier imputé), entretiens et contrôles à date.

## Exigences transverses à vérifier dans chaque parcours
- Aucun écran vide sans explication ni action proposée.
- Les erreurs sont formulées en français clair avec une solution.
- Chaque action destructrice est confirmée ou annulable (toast « Annuler » pendant 5 s).
- Tout est utilisable au clavier sur desktop et au pouce sur mobile.
- Les mises à jour arrivent en direct (deux navigateurs ouverts sur le même chantier voient la même chose sans recharger).
