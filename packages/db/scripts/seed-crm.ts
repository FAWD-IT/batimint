/**
 * Seed M2 : bibliothèques types, ~40 clients et prospects, demandes reçues et affaires
 * à toutes les étapes du pipeline, dont la visite technique chez M. Dupont (P2), dont le devis
 * signé a donné le chantier des maquettes (seed-projects).
 * Données déterministes (pas d'aléatoire) pour que la démo et les tests E2E soient stables.
 */
import { customerDisplayName } from '@batimint/domain';
import { installStarterLibraries } from '../src/library';
import type { Tx } from '../src/client';

type Stage = 'new' | 'visit_planned' | 'quoting' | 'sent' | 'won' | 'lost';

/**
 * Numéro d'entreprise belge valide à partir d'une base : il commence par 0 ou 1 (BCE) et ses deux
 * derniers chiffres sont le contrôle modulo 97.
 */
function enterpriseNumber(base: number): string {
  const b = String(base % 20_000_000).padStart(8, '0');
  const check = 97 - (Number(b) % 97);
  return `${b}${String(check).padStart(2, '0')}`;
}

const CITIES: [string, string][] = [
  ['6000', 'Charleroi'],
  ['6040', 'Jumet'],
  ['6041', 'Gosselies'],
  ['6001', 'Marcinelle'],
  ['6110', 'Montigny-le-Tilleul'],
  ['6200', 'Châtelet'],
  ['6220', 'Fleurus'],
  ['6030', 'Marchienne-au-Pont'],
  ['5000', 'Namur'],
  ['6120', 'Ham-sur-Heure'],
  ['7100', 'La Louvière'],
  ['6180', 'Courcelles'],
];

const STREETS = [
  'Rue de la Station',
  'Avenue de Waterloo',
  'Rue du Calvaire',
  'Chaussée de Bruxelles',
  'Rue des Écoles',
  'Rue Paul Pastur',
  'Rue de Gosselies',
  'Avenue Mascaux',
  'Rue du Moulin',
  'Rue Destrée',
];

const PEOPLE: [string, string][] = [
  ['Marie', 'Lambert'],
  ['Luc', 'Dubois'],
  ['Nathalie', 'Martin'],
  ['Philippe', 'Lejeune'],
  ['Isabelle', 'Renard'],
  ['Michel', 'Gilson'],
  ['Sophie', 'Wauters'],
  ['Pierre', 'Leroy'],
  ['Anne', 'Collard'],
  ['Christophe', 'Fontaine'],
  ['Véronique', 'Hubert'],
  ['Olivier', 'Mathieu'],
  ['Catherine', 'Delvaux'],
  ['Didier', 'Lemaire'],
  ['Martine', 'Charlier'],
  ['Alain', 'Bastin'],
  ['Françoise', 'Masson'],
  ['Jacques', 'Piron'],
  ['Sylvie', 'Denis'],
  ['Bernard', 'Lefèvre'],
  ['Claire', 'Henrard'],
  ['Thierry', 'Dumont'],
  ['Julie', 'Laurent'],
  ['Marc', 'Simon'],
  ['Laurence', 'Gérard'],
  ['Patrick', 'Thiry'],
  ['Caroline', 'Michaux'],
  ['Daniel', 'Jacquet'],
];

const COMPANIES: { name: string; form: string; base: number; peppol: boolean }[] = [
  { name: 'Immo Sambre', form: 'SRL', base: 45678901, peppol: true },
  { name: 'Résidence Les Tilleuls', form: 'ACP', base: 85012345, peppol: false },
  { name: 'Boulangerie Delcourt', form: 'SRL', base: 66554433, peppol: true },
  { name: 'Cabinet Médical du Centre', form: 'SC', base: 71234567, peppol: true },
  { name: 'Garage Moderne Fleurus', form: 'SA', base: 43219876, peppol: true },
  { name: 'Hainaut Logistics', form: 'SA', base: 47788990, peppol: true },
  { name: 'Commune de Ham-sur-Heure', form: '', base: 21600000, peppol: true },
  { name: 'Brasserie de la Place', form: 'SRL', base: 69990011, peppol: false },
  { name: 'Patrimoine Charleroi', form: 'SRL', base: 72345123, peppol: true },
  { name: 'Studio Archi+', form: 'SRL', base: 66001122, peppol: true },
  { name: 'École Saint-Joseph', form: 'ASBL', base: 41010101, peppol: false },
];

const OPPORTUNITIES: {
  customer: number | 'dupont' | `co${number}`;
  title: string;
  stage: Stage;
  amount: number;
  trade: string;
  lostReason?: string;
  daysAgo: number;
}[] = [
  {
    customer: 'dupont',
    title: 'Rénovation salle de bain',
    // Signée il y a trois semaines : c'est le chantier Dupont des maquettes (09, seed-projects).
    stage: 'won',
    amount: 3_500_000,
    trade: 'plumbing',
    daysAgo: 45,
  },
  {
    customer: 0,
    title: 'Remplacement de la toiture',
    stage: 'new',
    amount: 2_400_000,
    trade: 'roofing',
    daysAgo: 0,
  },
  {
    customer: 3,
    title: 'Mise en conformité électrique',
    stage: 'new',
    amount: 650_000,
    trade: 'electrical',
    daysAgo: 1,
  },
  {
    customer: 'co1',
    title: 'Isolation des combles communs',
    stage: 'new',
    amount: 3_100_000,
    trade: 'roofing',
    daysAgo: 2,
  },
  {
    customer: 5,
    title: 'Cuisine : plomberie et carrelage',
    stage: 'visit_planned',
    amount: 980_000,
    trade: 'plumbing',
    daysAgo: 3,
  },
  {
    customer: 8,
    title: 'Remplacement des châssis',
    stage: 'visit_planned',
    amount: 1_420_000,
    trade: 'general',
    daysAgo: 4,
  },
  {
    customer: 'co3',
    title: 'Rafraîchissement du cabinet',
    stage: 'visit_planned',
    amount: 1_150_000,
    trade: 'general',
    daysAgo: 5,
  },
  {
    customer: 11,
    title: 'Extension arrière 20 m²',
    stage: 'quoting',
    amount: 6_500_000,
    trade: 'general',
    daysAgo: 9,
  },
  {
    customer: 'co0',
    title: 'Rénovation de 4 appartements',
    stage: 'quoting',
    amount: 14_800_000,
    trade: 'general',
    daysAgo: 12,
  },
  {
    customer: 14,
    title: "Douche à l'italienne",
    stage: 'sent',
    amount: 720_000,
    trade: 'plumbing',
    daysAgo: 15,
  },
  {
    customer: 'co4',
    title: "Éclairage LED de l'atelier",
    stage: 'sent',
    amount: 1_380_000,
    trade: 'electrical',
    daysAgo: 18,
  },
  {
    customer: 17,
    title: 'Ravalement de façade',
    stage: 'sent',
    amount: 2_250_000,
    trade: 'general',
    daysAgo: 20,
  },
  {
    customer: 'co6',
    title: 'Toiture de la salle communale',
    stage: 'won',
    amount: 8_900_000,
    trade: 'roofing',
    daysAgo: 30,
  },
  {
    customer: 20,
    title: 'Rénovation complète maison 1960',
    stage: 'won',
    amount: 12_500_000,
    trade: 'general',
    daysAgo: 40,
  },
  {
    customer: 22,
    title: 'Tableau électrique et prises',
    stage: 'won',
    amount: 420_000,
    trade: 'electrical',
    daysAgo: 25,
  },
  {
    customer: 24,
    title: 'Abri de jardin',
    stage: 'lost',
    amount: 380_000,
    trade: 'general',
    lostReason: 'Prix trop élevé',
    daysAgo: 35,
  },
  {
    customer: 'co7',
    title: 'Sanitaires de la brasserie',
    stage: 'lost',
    amount: 1_640_000,
    trade: 'plumbing',
    lostReason: 'Concurrent choisi',
    daysAgo: 28,
  },
];

export async function seedCrm(tx: Tx, tenantId: string, userId: string | null): Promise<void> {
  if ((await tx.customer.count({ where: { tenantId } })) > 0) return;

  await installStarterLibraries(tx, tenantId, ['general', 'roofing', 'electrical', 'plumbing'], userId);

  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  const customerIds: string[] = [];
  const siteIds: string[] = [];
  const companyIds: string[] = [];
  const companySites: string[] = [];

  // Particuliers
  for (const [i, [first, last]] of PEOPLE.entries()) {
    const [postalCode, city] = CITIES[i % CITIES.length]!;
    const street = `${STREETS[i % STREETS.length]} ${10 + ((i * 7) % 140)}`;
    const c = await tx.customer.create({
      data: {
        tenantId,
        kind: 'individual',
        status: 'prospect',
        displayName: customerDisplayName({ kind: 'individual', firstName: first, lastName: last }),
        firstName: first,
        lastName: last,
        email: `${first}.${last}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().concat('@example.be'),
        phone: `+32 47${i % 10} ${String(100 + i * 13).slice(-3)} ${String(10 + i * 7).slice(-2)} ${String(20 + i * 3).slice(-2)}`,
        street,
        postalCode,
        city,
        source: i % 3 === 0 ? 'web_form' : i % 3 === 1 ? 'phone' : 'recommendation',
        createdBy: userId,
        createdAt: day(60 - i),
      },
    });
    customerIds.push(c.id);
    const site = await tx.site.create({
      data: {
        tenantId,
        customerId: c.id,
        street,
        postalCode,
        city,
        isPrivateDwelling: true,
        firstOccupancyYear: i % 5 === 0 ? 2019 : 1955 + ((i * 4) % 50),
        createdBy: userId,
      },
    });
    siteIds.push(site.id);
  }

  // M. Dupont (P2) : logement de 1975, rénovation salle de bain, 6 % possible.
  const dupont = await tx.customer.create({
    data: {
      tenantId,
      kind: 'individual',
      status: 'prospect',
      displayName: 'Jean Dupont',
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean.dupont@example.be',
      phone: '+32 475 12 34 56',
      street: 'Rue de la Station 42',
      postalCode: '6040',
      city: 'Jumet',
      source: 'web_form',
      notes: 'Préfère être contacté en fin de journée.',
      createdBy: userId,
      createdAt: day(7),
    },
  });
  const dupontSite = await tx.site.create({
    data: {
      tenantId,
      customerId: dupont.id,
      label: 'Maison',
      street: 'Rue de la Station 42',
      postalCode: '6040',
      city: 'Jumet',
      isPrivateDwelling: true,
      firstOccupancyYear: 1975,
      accessNotes: 'Stationnement dans la rue ; clé chez la voisine (n° 44).',
      createdBy: userId,
    },
  });

  // Entreprises (B2B : TVA, Peppol)
  for (const [i, co] of COMPANIES.entries()) {
    const [postalCode, city] = CITIES[(i + 3) % CITIES.length]!;
    const n = enterpriseNumber(co.base);
    const c = await tx.customer.create({
      data: {
        tenantId,
        kind: 'company',
        status: 'prospect',
        displayName: customerDisplayName({ kind: 'company', companyName: co.name }),
        companyName: co.name,
        legalForm: co.form || null,
        enterpriseNumber: n,
        vatNumber: co.form === 'ACP' || co.form === '' ? null : `BE${n}`,
        vatLiable: co.form !== 'ACP' && co.form !== 'ASBL' && co.form !== '',
        peppolId: `0208:${n}`,
        peppolReachable: co.peppol,
        peppolCheckedAt: day(3),
        email: `contact@${co.name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z]+/g, '')}.be`,
        phone: `+32 71 ${String(20 + i * 3).slice(-2)} ${String(40 + i * 5).slice(-2)} ${String(10 + i).slice(-2)}`,
        street: `${STREETS[(i + 4) % STREETS.length]} ${2 + i * 11}`,
        postalCode,
        city,
        paymentTermsDays: co.form === '' ? 60 : 30,
        source: 'recommendation',
        createdBy: userId,
        createdAt: day(80 - i),
      },
    });
    companyIds.push(c.id);
    await tx.contact.create({
      data: {
        tenantId,
        customerId: c.id,
        firstName: PEOPLE[(i + 5) % PEOPLE.length]![0],
        lastName: PEOPLE[(i + 9) % PEOPLE.length]![1],
        jobTitle: i % 2 ? 'Gérant' : 'Responsable technique',
        email: `direction@${co.name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z]+/g, '')}.be`,
        isPrimary: true,
        createdBy: userId,
      },
    });
    const site = await tx.site.create({
      data: {
        tenantId,
        customerId: c.id,
        label: i % 2 ? 'Siège' : 'Bâtiment principal',
        street: `${STREETS[(i + 4) % STREETS.length]} ${2 + i * 11}`,
        postalCode,
        city,
        isPrivateDwelling: false,
        createdBy: userId,
      },
    });
    companySites.push(site.id);
  }

  // Affaires : positions continues par colonne, gagnées → client.
  const positions = new Map<Stage, number>();
  let dupontOpportunityId = '';
  for (const o of OPPORTUNITIES) {
    let customerId: string;
    let siteId: string;
    if (o.customer === 'dupont') {
      customerId = dupont.id;
      siteId = dupontSite.id;
    } else if (typeof o.customer === 'string') {
      const idx = Number(o.customer.slice(2));
      customerId = companyIds[idx]!;
      siteId = companySites[idx]!;
    } else {
      customerId = customerIds[o.customer]!;
      siteId = siteIds[o.customer]!;
    }
    const position = positions.get(o.stage) ?? 0;
    positions.set(o.stage, position + 1);
    const opp = await tx.opportunity.create({
      data: {
        tenantId,
        customerId,
        siteId,
        title: o.title,
        stage: o.stage,
        position,
        estimatedAmount: BigInt(o.amount),
        trade: o.trade,
        ownerUserId: userId,
        lostReason: o.lostReason ?? null,
        wonAt: o.stage === 'won' ? day(o.daysAgo - 5) : null,
        lostAt: o.stage === 'lost' ? day(o.daysAgo - 5) : null,
        createdBy: userId,
        createdAt: day(o.daysAgo),
      },
    });
    if (o.customer === 'dupont') dupontOpportunityId = opp.id;
    if (o.stage === 'won')
      await tx.customer.update({ where: { id: customerId }, data: { status: 'customer' } });
    if (o.stage === 'visit_planned') {
      const when = new Date();
      when.setDate(when.getDate() + 1 + (position % 4));
      when.setHours(9 + position * 2, 0, 0, 0);
      await tx.siteVisit.create({
        data: { tenantId, opportunityId: opp.id, scheduledAt: when, trade: o.trade, createdBy: userId },
      });
    }
  }

  // Demandes reçues (déjà traitées : prospect et affaire créés).
  const dupontLead = {
    source: 'web_form' as const,
    name: 'Jean Dupont',
    email: 'jean.dupont@example.be',
    phone: '+32 475 12 34 56',
    street: 'Rue de la Station 42',
    postalCode: '6040',
    city: 'Jumet',
    message:
      'Bonjour, je souhaite rénover entièrement ma salle de bain (environ 6 m²) : remplacer la baignoire par une douche, nouveau meuble lavabo et faïence. Maison de 1975. Merci de me recontacter.',
    customerId: dupont.id,
    opportunityId: dupontOpportunityId,
  };
  await tx.lead.create({
    data: { tenantId, status: 'converted', receivedAt: day(48), ...dupontLead },
  });
  const opps = await tx.opportunity.findMany({
    where: { tenantId, stage: { in: ['new', 'visit_planned'] } },
    include: { customer: true },
  });
  for (const [i, o] of opps.entries()) {
    await tx.lead.create({
      data: {
        tenantId,
        source: (['web_form', 'email', 'phone'] as const)[i % 3]!,
        status: 'converted',
        name: o.customer.displayName,
        email: o.customer.email,
        phone: o.customer.phone,
        city: o.customer.city,
        postalCode: o.customer.postalCode,
        message: `${o.title}. Pouvez-vous passer pour un devis ?`,
        customerId: o.customerId,
        opportunityId: o.id,
        receivedAt: o.createdAt,
      },
    });
  }
  // Une demande indésirable déjà écartée par le filtre anti-robot.
  await tx.lead.create({
    data: {
      tenantId,
      source: 'web_form',
      status: 'discarded',
      name: 'SEO Agency',
      email: 'offer@seo-best.example',
      message: 'Get 1000 backlinks now http://spam.example http://spam.example/2',
      payload: { spamScore: 120 },
      receivedAt: day(2),
    },
  });

  // Visite technique de Karim chez M. Dupont (P2.2).
  await tx.siteVisit.create({
    data: {
      tenantId,
      opportunityId: dupontOpportunityId,
      scheduledAt: day(42),
      visitedAt: day(42),
      trade: 'plumbing',
      measurements: [
        { label: 'Surface au sol', value: '6,2', unit: 'm²' },
        { label: 'Surface murale à carreler', value: '18,5', unit: 'm²' },
        { label: 'Hauteur sous plafond', value: '2,45', unit: 'm' },
      ],
      checklist: [
        { label: 'État des murs et du support (humidité, fissures)', done: true },
        { label: "Arrivées et évacuations d'eau (emplacement, diamètre)", done: true },
        { label: 'Ventilation existante', done: true },
        { label: 'Accès et protection des sols', done: true },
        { label: 'Tableau électrique et liaison équipotentielle', done: false },
        { label: 'Choix des sanitaires et de la faïence avec le client', done: true },
      ],
      notes:
        'Baignoire à remplacer par une douche à l’italienne 90×120. Évacuation au sol possible (chape de 8 cm). Faïence murale 30×60 toute hauteur dans la douche, 1,20 m ailleurs. Le client hésite pour un meuble double vasque. Canalisation en plomb visible sous l’évier : à remplacer.',
      createdBy: userId,
    },
  });
}
