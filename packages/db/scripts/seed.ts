/**
 * Seed de démonstration (09) — idempotent ; `--reset` repart de zéro pour le tenant de démo.
 * Crée « Rénov'Habitat SRL » (Charleroi) et les comptes des personas de docs/02.
 * Les mots de passe de démo sont documentés dans le README (dev / instance de démo uniquement).
 */
import { createPrismaClient, withSystem } from '../src/index';
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
          },
        });
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
        }
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
