/**
 * Bibliothèques types par métier (03 §3, 02 P1.4) : rénovation générale, toiture, électricité,
 * sanitaire. Prix d'achat HTVA indicatifs (marché belge 2026), à adapter par chaque entreprise.
 * Format compact : [code, désignation, unité, prix d'achat €, type, temps de pose h, catégorie].
 */

export type StarterTrade = 'general' | 'roofing' | 'electrical' | 'plumbing';

type Row = [
  code: string,
  name: string,
  unit: string,
  price: number,
  kind: 'material' | 'labour' | 'subcontracting' | 'equipment' | 'lump_sum',
  hours: number,
  category: string,
];

export interface StarterAssembly {
  code: string;
  name: string;
  unit: string;
  category: string;
  components: [code: string, quantity: number][];
}

export interface StarterLibrary {
  trade: StarterTrade;
  label: string;
  description: string;
  items: Row[];
  assemblies: StarterAssembly[];
}

/** Coût horaire de référence pour les prestations de main-d'œuvre sans prix propre (temps × taux). */
export const DEFAULT_LABOUR_RATE_EUROS = 36;

const LABOUR: Row[] = [
  ['MO-OUV', 'Main-d’œuvre ouvrier qualifié', 'h', 36, 'labour', 1, 'Main-d’œuvre'],
  ['MO-CHEF', 'Main-d’œuvre chef de chantier', 'h', 44, 'labour', 1, 'Main-d’œuvre'],
  ['MO-APP', 'Main-d’œuvre apprenti', 'h', 22, 'labour', 1, 'Main-d’œuvre'],
];

export const STARTER_LIBRARIES: StarterLibrary[] = [
  {
    trade: 'general',
    label: 'Rénovation générale',
    description: 'Démolition, maçonnerie, plafonnage, carrelage, peinture et menuiserie intérieure.',
    items: [
      ...LABOUR,
      [
        'GEN-DEM-01',
        'Démolition de cloison en briques, évacuation comprise',
        'm²',
        0,
        'labour',
        0.9,
        'Démolition',
      ],
      ['GEN-CONT-08', 'Location conteneur 8 m³ (gravats mélangés)', 'u', 365, 'equipment', 0, 'Démolition'],
      ['GEN-BLOC-14', 'Bloc béton 14 cm', 'u', 1.95, 'material', 0.08, 'Maçonnerie'],
      ['GEN-MORT-25', 'Mortier de maçonnerie (sac 25 kg)', 'u', 6.4, 'material', 0, 'Maçonnerie'],
      ['GEN-LINT-120', 'Linteau béton précontraint 120 cm', 'u', 24.5, 'material', 0.5, 'Maçonnerie'],
      ['GEN-GYP-125', 'Plaque de plâtre 12,5 mm standard', 'm²', 4.2, 'material', 0, 'Plafonnage'],
      ['GEN-GYP-H2O', 'Plaque de plâtre hydrofuge 12,5 mm', 'm²', 6.1, 'material', 0, 'Plafonnage'],
      ['GEN-RAIL-48', 'Rail métallique 48 mm (3 m)', 'u', 4.3, 'material', 0, 'Plafonnage'],
      ['GEN-MONT-48', 'Montant métallique 48 mm (3 m)', 'u', 5.1, 'material', 0, 'Plafonnage'],
      ['GEN-LAINE-45', 'Laine minérale 45 mm', 'm²', 5.8, 'material', 0, 'Isolation'],
      ['GEN-ENDUIT-25', 'Enduit de plafonnage (sac 25 kg)', 'u', 11.9, 'material', 0, 'Plafonnage'],
      ['GEN-CARR-3060', 'Carrelage mural faïence 30×60', 'm²', 28.99, 'material', 0, 'Carrelage'],
      ['GEN-CARR-6060', 'Carrelage sol grès cérame 60×60', 'm²', 34.5, 'material', 0, 'Carrelage'],
      ['GEN-COLLE-C2', 'Colle carrelage C2TE (sac 25 kg)', 'u', 18.9, 'material', 0, 'Carrelage'],
      ['GEN-JOINT-5', 'Mortier de joint (sac 5 kg)', 'u', 12.5, 'material', 0, 'Carrelage'],
      ['GEN-ETANCH', 'Kit d’étanchéité sous carrelage (douche)', 'u', 89, 'material', 1.5, 'Carrelage'],
      ['GEN-CHAPE-ST', 'Chape (sous-traitance)', 'm²', 24, 'subcontracting', 0, 'Sols'],
      ['GEN-PEINT-MAT', 'Peinture murale acrylique mate (10 l)', 'u', 79, 'material', 0, 'Peinture'],
      ['GEN-PRIM', 'Primer d’accrochage (5 l)', 'u', 42, 'material', 0, 'Peinture'],
      ['GEN-PORTE-INT', 'Bloc-porte intérieur tubulaire 83 cm', 'u', 189, 'material', 2.5, 'Menuiserie'],
      ['GEN-PLINTHE', 'Plinthe MDF 70 mm', 'm', 3.2, 'material', 0.1, 'Menuiserie'],
      ['GEN-SILICONE', 'Silicone sanitaire (cartouche)', 'u', 7.9, 'material', 0, 'Finitions'],
      ['GEN-PROT', 'Protection des sols et évacuation des déchets', 'forfait', 120, 'lump_sum', 2, 'Divers'],
    ],
    assemblies: [
      {
        code: 'OUV-FAI-3060',
        name: 'Faïence murale 30×60 posée, colle et joints compris',
        unit: 'm²',
        category: 'Carrelage',
        components: [
          ['GEN-CARR-3060', 1.1],
          ['GEN-COLLE-C2', 0.22],
          ['GEN-JOINT-5', 0.08],
          ['MO-OUV', 0.85],
        ],
      },
      {
        code: 'OUV-SOL-6060',
        name: 'Carrelage de sol 60×60 posé, colle et joints compris',
        unit: 'm²',
        category: 'Carrelage',
        components: [
          ['GEN-CARR-6060', 1.08],
          ['GEN-COLLE-C2', 0.28],
          ['GEN-JOINT-5', 0.1],
          ['MO-OUV', 0.75],
        ],
      },
      {
        code: 'OUV-CLOISON',
        name: 'Cloison en plaques de plâtre 98 mm, isolée, 2 faces',
        unit: 'm²',
        category: 'Plafonnage',
        components: [
          ['GEN-GYP-125', 2.1],
          ['GEN-RAIL-48', 0.35],
          ['GEN-MONT-48', 0.7],
          ['GEN-LAINE-45', 1.05],
          ['MO-OUV', 0.9],
        ],
      },
      {
        code: 'OUV-PEINT',
        name: 'Peinture murale 2 couches avec primer',
        unit: 'm²',
        category: 'Peinture',
        components: [
          ['GEN-PRIM', 0.012],
          ['GEN-PEINT-MAT', 0.025],
          ['MO-OUV', 0.22],
        ],
      },
    ],
  },
  {
    trade: 'roofing',
    label: 'Toiture',
    description: 'Couverture en tuiles et ardoises, isolation de toiture, zinguerie et toitures plates.',
    items: [
      ...LABOUR,
      ['TOI-ECHAF', 'Échafaudage de façade (location/semaine)', 'm²', 4.5, 'equipment', 0, 'Échafaudage'],
      ['TOI-TUILE-B', 'Tuile béton grand moule', 'u', 1.15, 'material', 0, 'Couverture'],
      ['TOI-TUILE-TC', 'Tuile terre cuite Romane', 'u', 1.85, 'material', 0, 'Couverture'],
      ['TOI-ARD-NAT', 'Ardoise naturelle 40×25', 'u', 1.6, 'material', 0, 'Couverture'],
      ['TOI-LATTE', 'Latte sapin traité 24×32', 'm', 0.85, 'material', 0, 'Charpente'],
      ['TOI-CONTRE', 'Contre-latte 12×32', 'm', 0.55, 'material', 0, 'Charpente'],
      ['TOI-SOUS', 'Sous-toiture respirante', 'm²', 2.9, 'material', 0, 'Couverture'],
      ['TOI-PIR-120', 'Panneau isolant PIR 120 mm', 'm²', 23.5, 'material', 0, 'Isolation'],
      ['TOI-LAINE-200', 'Laine de verre 200 mm entre chevrons', 'm²', 11.2, 'material', 0, 'Isolation'],
      ['TOI-PV', 'Pare-vapeur', 'm²', 1.4, 'material', 0, 'Isolation'],
      ['TOI-FAIT', 'Faîtière', 'u', 4.9, 'material', 0.15, 'Couverture'],
      ['TOI-GOUT-ZN', 'Gouttière zinc demi-ronde 33', 'm', 14.8, 'material', 0.4, 'Zinguerie'],
      ['TOI-DESC-ZN', 'Tuyau de descente zinc 80 mm', 'm', 12.9, 'material', 0.3, 'Zinguerie'],
      ['TOI-EPDM', 'Membrane EPDM 1,2 mm', 'm²', 13.5, 'material', 0, 'Toiture plate'],
      ['TOI-COLLE-EPDM', 'Colle EPDM (seau 5 l)', 'u', 64, 'material', 0, 'Toiture plate'],
      ['TOI-VELUX', 'Fenêtre de toit 78×118 avec raccord', 'u', 465, 'material', 4, 'Fenêtres de toit'],
      ['TOI-EVAC', 'Évacuation de l’ancienne couverture', 'm²', 0, 'labour', 0.25, 'Démolition'],
    ],
    assemblies: [
      {
        code: 'OUV-TOI-TUILE',
        name: 'Couverture en tuiles béton sur lattage neuf, sous-toiture comprise',
        unit: 'm²',
        category: 'Couverture',
        components: [
          ['TOI-TUILE-B', 10],
          ['TOI-LATTE', 3.1],
          ['TOI-CONTRE', 2],
          ['TOI-SOUS', 1.1],
          ['MO-OUV', 0.95],
        ],
      },
      {
        code: 'OUV-TOI-ISOL',
        name: 'Isolation de toiture PIR 120 mm sur chevrons',
        unit: 'm²',
        category: 'Isolation',
        components: [
          ['TOI-PIR-120', 1.05],
          ['TOI-PV', 1.1],
          ['MO-OUV', 0.45],
        ],
      },
      {
        code: 'OUV-TOI-PLATE',
        name: 'Toiture plate EPDM collée',
        unit: 'm²',
        category: 'Toiture plate',
        components: [
          ['TOI-EPDM', 1.12],
          ['TOI-COLLE-EPDM', 0.08],
          ['MO-OUV', 0.6],
        ],
      },
    ],
  },
  {
    trade: 'electrical',
    label: 'Électricité',
    description: 'Installation domestique conforme RGIE : tableaux, circuits, prises, éclairage et contrôle.',
    items: [
      ...LABOUR,
      ['ELE-TAB-4R', 'Tableau électrique 4 rangées équipé', 'u', 245, 'material', 6, 'Tableaux'],
      ['ELE-DIFF-300', 'Différentiel 300 mA 40 A', 'u', 64, 'material', 0.3, 'Protection'],
      ['ELE-DIFF-30', 'Différentiel 30 mA 40 A type A', 'u', 82, 'material', 0.3, 'Protection'],
      ['ELE-DISJ-16', 'Disjoncteur 16 A', 'u', 9.8, 'material', 0.2, 'Protection'],
      ['ELE-DISJ-20', 'Disjoncteur 20 A', 'u', 10.4, 'material', 0.2, 'Protection'],
      ['ELE-XVB-25', 'Câble XVB 3G2,5', 'm', 1.65, 'material', 0.05, 'Câbles'],
      ['ELE-VOB-15', 'Fil VOB 1,5 mm²', 'm', 0.32, 'material', 0.02, 'Câbles'],
      ['ELE-TUBE-16', 'Tube flexible 16 mm', 'm', 0.45, 'material', 0.03, 'Conduits'],
      ['ELE-BOITE', 'Boîte d’encastrement', 'u', 0.9, 'material', 0.15, 'Appareillage'],
      ['ELE-PRISE', 'Prise de courant avec terre', 'u', 7.5, 'material', 0.35, 'Appareillage'],
      ['ELE-INTER', 'Interrupteur simple allumage', 'u', 6.9, 'material', 0.3, 'Appareillage'],
      ['ELE-SPOT', 'Spot LED encastrable 6 W IP44', 'u', 18.5, 'material', 0.4, 'Éclairage'],
      ['ELE-TERRE', 'Boucle de terre et mesure', 'forfait', 180, 'lump_sum', 4, 'Terre'],
      [
        'ELE-CONTROLE',
        'Contrôle de conformité RGIE (organisme agréé)',
        'forfait',
        165,
        'subcontracting',
        0,
        'Contrôle',
      ],
      ['ELE-SCHEMA', 'Schémas unifilaire et de position', 'forfait', 0, 'labour', 3, 'Contrôle'],
    ],
    assemblies: [
      {
        code: 'OUV-ELE-PRISE',
        name: 'Point prise encastré, câblage depuis le tableau (≈ 8 m)',
        unit: 'u',
        category: 'Appareillage',
        components: [
          ['ELE-PRISE', 1],
          ['ELE-BOITE', 1],
          ['ELE-XVB-25', 8],
          ['ELE-TUBE-16', 8],
          ['MO-OUV', 0.6],
        ],
      },
      {
        code: 'OUV-ELE-POINT',
        name: 'Point lumineux + interrupteur, câblage compris',
        unit: 'u',
        category: 'Éclairage',
        components: [
          ['ELE-INTER', 1],
          ['ELE-BOITE', 2],
          ['ELE-VOB-15', 24],
          ['ELE-TUBE-16', 9],
          ['MO-OUV', 0.9],
        ],
      },
    ],
  },
  {
    trade: 'plumbing',
    label: 'Sanitaire',
    description: 'Alimentation, évacuation, appareils sanitaires et salles de bain clé en main.',
    items: [
      ...LABOUR,
      ['SAN-MULTI-16', 'Tube multicouche 16 mm', 'm', 2.1, 'material', 0.1, 'Alimentation'],
      ['SAN-RACC-16', 'Raccord à sertir 16 mm', 'u', 4.6, 'material', 0.1, 'Alimentation'],
      ['SAN-PVC-50', 'Tuyau PVC évacuation 50 mm', 'm', 3.4, 'material', 0.15, 'Évacuation'],
      ['SAN-PVC-110', 'Tuyau PVC évacuation 110 mm', 'm', 7.9, 'material', 0.25, 'Évacuation'],
      ['SAN-WC-SUSP', 'WC suspendu avec bâti-support', 'u', 389, 'material', 4, 'Appareils'],
      ['SAN-LAVABO', 'Meuble lavabo 80 cm avec vasque', 'u', 495, 'material', 3, 'Appareils'],
      ['SAN-MIT-LAV', 'Mitigeur lavabo', 'u', 89, 'material', 0.75, 'Robinetterie'],
      ['SAN-DOUCHE-THERMO', 'Colonne de douche thermostatique', 'u', 329, 'material', 1.5, 'Robinetterie'],
      ['SAN-RECEV-90', 'Receveur de douche extra-plat 90×90', 'u', 189, 'material', 2.5, 'Douche'],
      ['SAN-CANIV-80', 'Caniveau de douche à l’italienne 80 cm', 'u', 245, 'material', 2, 'Douche'],
      ['SAN-PAROI-90', 'Paroi de douche fixe 90 cm, verre 8 mm', 'u', 410, 'material', 2, 'Douche'],
      ['SAN-BAIGN-170', 'Baignoire acrylique 170×75', 'u', 299, 'material', 3, 'Appareils'],
      ['SAN-BOILER-150', 'Boiler électrique 150 l', 'u', 545, 'material', 4, 'Eau chaude'],
      ['SAN-VANNE', 'Vanne d’arrêt 1/2"', 'u', 12.5, 'material', 0.3, 'Alimentation'],
    ],
    assemblies: [
      {
        code: 'OUV-SAN-ITAL',
        name: 'Douche à l’italienne : caniveau, étanchéité, paroi et colonne thermostatique',
        unit: 'u',
        category: 'Douche',
        components: [
          ['SAN-CANIV-80', 1],
          ['GEN-ETANCH', 1],
          ['SAN-PAROI-90', 1],
          ['SAN-DOUCHE-THERMO', 1],
          ['SAN-PVC-50', 3],
          ['MO-OUV', 6],
        ],
      },
      {
        code: 'OUV-SAN-WC',
        name: 'WC suspendu posé, raccordements compris',
        unit: 'u',
        category: 'Appareils',
        components: [
          ['SAN-WC-SUSP', 1],
          ['SAN-PVC-110', 1.5],
          ['SAN-MULTI-16', 3],
          ['SAN-RACC-16', 3],
          ['SAN-VANNE', 1],
          ['MO-OUV', 1.5],
        ],
      },
      {
        code: 'OUV-SAN-LAV',
        name: 'Meuble lavabo posé avec mitigeur',
        unit: 'u',
        category: 'Appareils',
        components: [
          ['SAN-LAVABO', 1],
          ['SAN-MIT-LAV', 1],
          ['SAN-PVC-50', 1.5],
          ['SAN-MULTI-16', 4],
          ['SAN-RACC-16', 4],
          ['MO-OUV', 1],
        ],
      },
    ],
  },
];

/** Les ouvrages sanitaires réutilisent des articles de rénovation générale : à importer ensemble. */
export const TRADE_DEPENDENCIES: Partial<Record<StarterTrade, StarterTrade[]>> = { plumbing: ['general'] };
