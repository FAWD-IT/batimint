# 03 — Modules fonctionnels

Chaque module liste ses fonctionnalités, ses règles et ses critères d'acceptation. Tout est dans le scope de la livraison web, sauf mention « hors scope ». Le plan d'activation (Essentiel, Pro, Expert) est géré par des feature flags par tenant ; en démo, tout est activé.

---

## 1. Compte, entreprise et paramètres
- Inscription et connexion : e-mail + mot de passe, lien magique, 2FA TOTP optionnel, réinitialisation, sessions révocables.
- Entreprise : BCE et TVA (validation VIES), adresse, IBAN/BIC, logo, couleur de marque (portails, PDF), conditions générales, mentions légales.
- Utilisateurs et rôles : Owner, Admin, Bureau, Chef de chantier, Ouvrier, Comptable. Matrice de permissions centralisée et testée.
- Paramètres métier :
  - taux horaires par profil, coefficients de frais généraux et de marge, pauses ;
  - délais de paiement, calendrier de relances, retenue de garantie par défaut ;
  - séries de numérotation, langue des documents.
- Équipes : composition, couleurs, chef d'équipe.
- Employés : profil, coût horaire chargé, compétences, numéro INSS (chiffré, pour Check In and Out), congés et indisponibilités.
- Onboarding guidé (P1) avec checklist.
- Abonnement : plan, période d'essai, flags de modules (encaissement hors scope).

**Acceptation :** un Ouvrier ne voit ni les prix ni les marges. Le Comptable ne modifie rien. Toute modification de paramètre est auditée.

## 2. CRM et demandes
- Clients et prospects, particulier ou entreprise. Pour une entreprise : BCE, TVA, statut assujetti, identifiant Peppol (lookup annuaire). Plusieurs contacts et plusieurs adresses de chantier.
- Demandes entrantes : formulaire web embarquable (script et iframe), adresse e-mail d'entrée par tenant (parsing), saisie manuelle.
- Pipeline d'opportunités en kanban : nouvelle, visite planifiée, devis en cours, envoyé, gagnée, perdue (avec motif).
- Visite technique : photos, mesures, notes vocales transcrites, checklist par métier.
- Historique unifié par client : devis, chantiers, factures, échanges.
- Dédoublonnage (même TVA, même e-mail) et fusion.

## 3. Bibliothèque
- Articles typés : matériau, main-d'œuvre, sous-traitance, matériel/location, forfait. Chaque article porte une unité, un prix d'achat, un fournisseur préféré, un coefficient ou prix de vente, un taux de TVA par défaut et le temps de pose pour la main-d'œuvre.
- Ouvrages composés : un ensemble d'articles avec quantités, dont le prix de revient et le prix de vente sont calculés. Les ouvrages sont imbriquables sur un niveau.
- Catégories et métiers, recherche plein texte instantanée (fuzzy).
- Import Excel ou CSV avec mapping de colonnes, aperçu, rapport d'erreurs et mise à jour par code article. Import des tarifs fournisseurs.
- Historique des prix. La mise à jour d'un prix ne modifie jamais un devis existant.
- Bibliothèques types par métier dans le seed : rénovation générale, toiture, électricité, sanitaire.

## 4. Devis
- Structure en sections et postes (arborescence à 2 niveaux), lignes depuis la bibliothèque ou libres, ouvrages éclatables.
- Calcul en direct : prix de revient, marge par ligne, par poste et totale, temps de main-d'œuvre total.
- Remise par ligne, par poste ou globale. Options et variantes que le client choisit sur le portail.
- Régimes de TVA par ligne : 21, 12, 6, 0 et autoliquidation, avec détermination automatique (voir `05`).
- Dictée IA : texte ou voix vers lignes proposées depuis la bibliothèque, validation ligne par ligne. Désactivable.
- Versions : toute modification après envoi crée une nouvelle version, avec un comparatif entre versions.
- Acompte (% ou montant) et échéancier de paiement contractuel.
- PDF soigné, aux couleurs du tenant, avec CGV en annexe.
- Envoi par e-mail avec lien portail, suivi d'ouverture, relance automatique à J+7 si non signé, date de validité et expiration.
- Signature électronique simple : nom, case d'acceptation, signature tracée. Preuve : horodatage, IP, user-agent, empreinte SHA-256 du PDF signé. Attestation 6 % signée dans le même flux.
- Duplication et modèles de devis.

**Acceptation :** signer un devis crée exactement un chantier, ses postes budgétaires (un par poste du devis), ses tâches et la facture d'acompte en brouillon. Ces effets sont idempotents si l'événement est rejoué.

## 5. Chantier (objet pivot)
- Fiche : client, adresse et géolocalisation, statut, dates, responsable, équipe, montant du contrat (devis + avenants), régime TVA, drapeaux (Check In and Out, 30bis).
- Statuts : préparation, en cours, suspendu, réception provisoire, réception définitive, clôturé.
- Budget par poste : budgété (devis + avenants), engagé (BC, factures fournisseurs, heures, stock, matériel, sous-traitance), facturé, encaissé. Marge prévue vs marge réelle en direct.
- Tâches issues des postes, avec checklist, assignation et avancement.
- Timeline unique (fil chronologique) de tous les événements, filtrable, avec commentaires et mentions @.
- Documents et photos : galerie par date et par tâche, choix de ce qui est visible par le client.
- Avenants : création depuis un signalement ou manuelle, envoi au client, signature, puis mise à jour du budget et du contrat.
- Révision de prix (formule paramétrable par contrat, indices saisis) applicable aux états d'avancement.
- Réceptions : PV provisoire avec réserves, PV définitif.
- Rapport de rentabilité final et suggestion d'ajustement des prix de la bibliothèque.
- Vue carte de tous les chantiers actifs.

## 6. Planning
- Vues semaine et mois, par équipe, par personne ou par chantier, glisser-déposer, durée en demi-journées.
- Affectation de tâches et de personnes, détection de conflits (double affectation, congé), météo indicative (optionnel).
- Notifications : planning du lendemain à l'ouvrier (à 18 h), date d'arrivée au client.
- Export iCal par personne.

## 7. Terrain (vue web mobile et PWA, en attendant Flutter)
- Accueil « mon chantier du jour » : adresse, itinéraire, équipe, tâches.
- Pointage IN et OUT géolocalisé avec tolérance de distance paramétrable, hors ligne (file locale + synchro idempotente). Pointage d'équipe par le chef.
- Photos (compression côté client), cocher des tâches, signalement avec photo, note vocale.
- Bons de régie et PV de réception signés à l'écran par le client.
- Rapport journalier auto-généré et éditable.
- Gros boutons (≥ 56 px), contraste élevé, tutoiement, aucun prix visible.

## 8. Achats et fournisseurs
- Fournisseurs (BCE, TVA, Peppol ID, conditions), tarifs.
- Bons de commande depuis les matériaux du devis ou du chantier, groupés par fournisseur, envoyés par e-mail. Réception partielle ou totale.
- Factures fournisseurs :
  - réception Peppol (webhook), ou upload / e-mail entrant avec extraction IA ;
  - rapprochement facture ↔ BC ↔ chantier/poste (P6), ventilation multi-chantiers ;
  - boîte « À imputer » ;
  - statuts : reçue, à imputer, imputée, validée, à payer, payée.
- Alertes d'écart entre BC et facture (prix, quantité).

## 9. Sous-traitance
- Sous-traitants (fournisseurs typés) : documents obligatoires avec échéance (assurance RC, attestations), alerte d'expiration.
- Contrats par poste de chantier (montant, échéancier).
- Contrôle 30bis à la création, avant chaque paiement et à la réception de facture. Calcul de la retenue et génération du document de versement.
- Portail sous-traitant via lien invité : missions, planning, documents, dépôt de facture.

## 10. Facturation et encaissement
- Types de document :
  - facture d'acompte, d'avancement (situation), de régie, finale, de libération de retenue ;
  - facture libre (hors chantier) et note de crédit (totale ou partielle, liée à la facture d'origine).
- États d'avancement en %, quantité ou € par poste, pré-remplis (P7), avec approbation client paramétrable. Déduction des acomptes, retenue de garantie, révision de prix.
- Numérotation légale continue, émission immuable, PDF + UBL Peppol BIS Billing 3.0.
- Envoi : Peppol si le destinataire est inscrit, sinon e-mail. Suivi des statuts d'envoi et de livraison.
- QR code de virement EPC et communication structurée belge sur chaque facture.
- Paiements : saisie manuelle, paiements partiels, lien de paiement Mollie (Bancontact, carte), lettrage.
- Relances : calendrier paramétrable (J+3, J+15, J+30), modèles d'e-mails, intérêts et indemnité forfaitaire optionnels. Les relances s'arrêtent dès que la facture est payée.
- Encours clients et balance âgée.

## 11. Stock et matériel
- Emplacements (dépôt, camionnettes), mouvements (entrée, sortie vers chantier, transfert, inventaire), coût moyen pondéré.
- Sortie vers chantier = coût imputé au poste choisi. Seuils et proposition de BC.
- Matériel : fiche, affectation chantier avec coût d'usage journalier, entretiens et contrôles à échéance, historique.

## 12. Pilotage et rapports
- Aujourd'hui (P11), tableau de bord avec filtres par période, équipe et responsable.
- Rapports :
  - rentabilité par chantier, par client, par type de travaux ;
  - heures par personne et par chantier, comparées au prévu ;
  - transformation des devis ;
  - carnet de commandes ;
  - trésorerie prévisionnelle à 90 jours (factures émises, échéanciers, achats à payer, salaires estimés).
- Exports CSV et Excel de chaque liste.

## 13. Comptabilité (via intégration)
- Synchronisation Chift : ventes, achats, paiements, plan comptable et journaux, avec mapping des codes TVA belges. Statut par document et reprise sur erreur.
- Accès Comptable et exports par période.

## 14. Notifications et communications
- Centre de notifications in-app (temps réel), e-mails transactionnels (modèles éditables par tenant), préférences par utilisateur.
- Fils de discussion sur chaque objet (devis, avenant, facture) partagés avec le client ou le sous-traitant quand c'est pertinent.

## 15. Recherche et commandes
- ⌘K global : recherche multi-objets et actions rapides, avec raccourcis clavier documentés (`?`).

## 16. Administration plateforme (super-admin Batimint)
- Liste des tenants, plans, flags, impersonation auditée (lecture seule par défaut), santé des intégrations, files de jobs en échec.

## Hors scope
Open banking, app native Flutter, néerlandais, paie, appels d'offres publics.
