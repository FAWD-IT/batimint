/**
 * Seed de démonstration (09) — idempotent ; `--reset` repart de zéro pour le tenant de démo.
 * Crée « Rénov'Habitat SRL » (Charleroi) et les comptes des personas de docs/02.
 * Les mots de passe de démo sont documentés dans le README (dev / instance de démo uniquement).
 */
import { createPrismaClient, withSystem } from '../src/index';
import { brusselsDate } from '@batimint/domain';
import { seedCrm } from './seed-crm';
import { seedField } from './seed-field';
import { seedPlanning } from './seed-planning';
import { seedProjects } from './seed-projects';
import { seedPurchasing } from './seed-purchasing';
import { seedQuotes } from './seed-quotes';
import { seedSubcontracting } from './seed-subcontracting';
import { loadEnv } from './env';
import { hashPassword } from './password';

loadEnv();

export const DEMO_TENANT_SLUG = 'renov-habitat';
export const DEMO_PASSWORD = process.env['SEED_DEMO_PASSWORD'] ?? 'batimint-demo';

export const PERSONAS = [
  { email: 'marc@renov-habitat.be', name: 'Marc Lefèvre', role: 'owner' },
  { email: 'sophie@renov-habitat.be', name: 'Sophie Martin', role: 'office' },
  { email: 'karim@renov-habitat.be', name: 'Karim Benali', role: 'site_manager' },
  { email: 'luca@renov-habitat.be', name: 'Luca Rossi', role: 'worker' },
  { email: 'lambert@fiduciaire-lambert.be', name: 'Isabelle Lambert', role: 'accountant' },
] as const;

type SeedTx = Parameters<Parameters<typeof withSystem>[1]>[0];

/** Équipes, employés (coûts chargés réalistes), congés : de quoi planifier et pointer (M5/M6). */
export const EMPLOYEES = [
  {
    first: 'Karim',
    last: 'Benali',
    job: 'Chef de chantier',
    rate: 'chef',
    cost: 4400,
    team: 'karim',
    email: 'karim@renov-habitat.be',
    skills: ['gros œuvre', 'carrelage'],
  },
  {
    first: 'Luca',
    last: 'Rossi',
    job: 'Carreleur',
    rate: 'ouvrier',
    cost: 3650,
    team: 'karim',
    email: 'luca@renov-habitat.be',
    skills: ['carrelage', 'faïence'],
  },
  {
    first: 'Yanis',
    last: 'Dubois',
    job: 'Plombier',
    rate: 'ouvrier',
    cost: 3800,
    team: 'karim',
    email: null,
    skills: ['sanitaire', 'chauffage'],
  },
  {
    first: 'Thomas',
    last: 'Lambot',
    job: 'Chef couvreur',
    rate: 'chef',
    cost: 4300,
    team: 'toit',
    email: null,
    skills: ['toiture', 'zinguerie'],
  },
  {
    first: 'Kevin',
    last: 'Mertens',
    job: 'Couvreur',
    rate: 'ouvrier',
    cost: 3500,
    team: 'toit',
    email: null,
    skills: ['toiture'],
  },
  {
    first: 'Nicolas',
    last: 'Gilson',
    job: 'Électricien',
    rate: 'ouvrier',
    cost: 3700,
    team: 'toit',
    email: null,
    skills: ['électricité'],
  },
  {
    first: 'Adrien',
    last: 'Collard',
    job: 'Apprenti',
    rate: 'apprenti',
    cost: 2200,
    team: 'karim',
    email: null,
    skills: [],
  },
  {
    first: 'Samir',
    last: 'El Amrani',
    job: 'Plafonneur',
    rate: 'ouvrier',
    cost: 3550,
    team: 'toit',
    email: null,
    skills: ['plafonnage', 'isolation'],
  },
] as const;

async function seedPeople(tx: SeedTx, tenantId: string, users: Map<string, string>): Promise<void> {
  if ((await tx.employee.count({ where: { tenantId } })) > 0) return;
  const karimTeam = await tx.team.create({ data: { tenantId, name: 'Équipe Karim', color: '#2F4BFF' } });
  const toitTeam = await tx.team.create({ data: { tenantId, name: 'Équipe Toiture', color: '#B4570B' } });
  const ids = new Map<string, string>();
  for (const e of EMPLOYEES) {
    const emp = await tx.employee.create({
      data: {
        tenantId,
        firstName: e.first,
        lastName: e.last,
        jobTitle: e.job,
        rateProfile: e.rate,
        hourlyCost: BigInt(e.cost),
        email: e.email,
        userId: e.email ? (users.get(e.email) ?? null) : null,
        skills: [...e.skills],
        teamId: e.team === 'karim' ? karimTeam.id : toitTeam.id,
        hiredOn: new Date('2021-03-01T00:00:00Z'),
      },
    });
    ids.set(e.first, emp.id);
  }
  await tx.team.update({ where: { id: karimTeam.id }, data: { leaderEmployeeId: ids.get('Karim') ?? null } });
  await tx.team.update({ where: { id: toitTeam.id }, data: { leaderEmployeeId: ids.get('Thomas') ?? null } });
  const today = new Date();
  const day = (offset: number) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset));
  await tx.absence.createMany({
    data: [
      { tenantId, employeeId: ids.get('Kevin')!, kind: 'leave', startsOn: day(7), endsOn: day(11) },
      {
        tenantId,
        employeeId: ids.get('Yanis')!,
        kind: 'training',
        startsOn: day(3),
        endsOn: day(3),
        halfDay: 'am',
        note: 'Formation pompes à chaleur',
      },
    ],
  });
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const url = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  const prisma = createPrismaClient({ url, applicationName: 'batimint-seed' });
  try {
    await withSystem(
      prisma,
      async (tx) => {
        if (reset) {
          await tx.$executeRaw`SELECT set_config('app.allow_tenant_purge', 'on', true)`;
          await tx.tenant.deleteMany({ where: { slug: DEMO_TENANT_SLUG } });
          await tx.user.deleteMany({ where: { email: { in: PERSONAS.map((p) => p.email) } } });
        }
        const passwordHash = await hashPassword(DEMO_PASSWORD);
        const tenant = await tx.tenant.upsert({
          where: { slug: DEMO_TENANT_SLUG },
          update: {},
          create: {
            slug: DEMO_TENANT_SLUG,
            name: "Rénov'Habitat",
            legalName: "Rénov'Habitat SRL",
            legalForm: 'SRL',
            enterpriseNumber: '0123456749',
            vatNumber: 'BE0123456749',
            vatValidatedAt: new Date(),
            street: 'Rue de Montigny 112',
            postalCode: '6000',
            city: 'Charleroi',
            email: 'info@renov-habitat.be',
            phone: '+32 71 12 34 56',
            iban: 'BE68539007547034',
            bic: 'GKCCBEBB',
            plan: 'expert',
            structuredCommPrefix: 104,
            featureFlags: { all: true },
            trialEndsAt: null,
            termsAndConditions:
              "1. Nos devis sont valables 30 jours. 2. Un acompte de 30 % est dû à la signature. 3. Nos factures sont payables à 30 jours. 4. Tout retard de paiement entraîne de plein droit l'application des intérêts légaux. 5. Les travaux supplémentaires font l'objet d'un avenant signé.",
            legalMentions:
              "Rénov'Habitat SRL · BCE 0123.456.749 · RPM Hainaut, division Charleroi · Assurance RC Ethias n° 45.123.789",
            brandColor: '#0B6E4F',
            settings: {
              rateProfiles: [
                { key: 'ouvrier', label: 'Ouvrier qualifié', costPerHour: 3600, salePerHour: 5200 },
                { key: 'chef', label: 'Chef de chantier', costPerHour: 4400, salePerHour: 6000 },
                { key: 'apprenti', label: 'Apprenti', costPerHour: 2200, salePerHour: 3800 },
              ],
              overheadCoefficient: '1.12',
              marginCoefficient: '1.28',
              retentionPercent: '5',
            },
          },
        });
        await tx.integrationConnection.upsert({
          where: { tenantId_kind: { tenantId: tenant.id, kind: 'peppol' } },
          update: {},
          create: {
            tenantId: tenant.id,
            kind: 'peppol',
            provider: 'mock',
            status: 'active',
            externalId: 'le_demo_renovhabitat',
            config: {
              participantId: '0208:0123456749',
              message: 'Entreprise inscrite sur le réseau Peppol (simulation).',
            },
            lastCheckedAt: new Date(),
          },
        });
        const users = new Map<string, string>();
        for (const p of PERSONAS) {
          const user = await tx.user.upsert({
            where: { email: p.email },
            update: {},
            create: { email: p.email, name: p.name, passwordHash, emailVerifiedAt: new Date() },
          });
          await tx.membership.upsert({
            where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
            update: { role: p.role },
            create: { tenantId: tenant.id, userId: user.id, role: p.role },
          });
          users.set(p.email, user.id);
        }
        await seedPeople(tx, tenant.id, users);
        await seedCrm(tx, tenant.id, users.get('sophie@renov-habitat.be') ?? null);
        await seedQuotes(tx, tenant.id, users.get('sophie@renov-habitat.be') ?? null);
        await seedProjects(tx, tenant.id, users);
        await seedField(tx, tenant.id, users, brusselsDate(new Date()));
        await seedPlanning(tx, tenant.id, users, brusselsDate(new Date()));
        await seedPurchasing(tx, tenant.id, users, brusselsDate(new Date()));
        await seedSubcontracting(tx, tenant.id, users, brusselsDate(new Date()));
      },
      { timeoutMs: 120_000 },
    );
    console.info(`Seed de démo prêt : ${PERSONAS.length} personas, mot de passe « ${DEMO_PASSWORD} ».`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
