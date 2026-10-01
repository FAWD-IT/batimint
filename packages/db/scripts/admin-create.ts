/**
 * pnpm admin:create -- --email admin@exemple.be --name "Admin" [--password ...]
 * Crée (ou promeut) un super-admin Batimint. Sans --password, un mot de passe aléatoire est affiché.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createPrismaClient, withSystem } from '../src/index';
import { loadEnv } from './env';
import { hashPassword } from './password';

loadEnv();

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' }, password: { type: 'string' } },
  allowPositionals: true,
});
const email = (values.email ?? process.env['ADMIN_EMAIL'])?.trim().toLowerCase();
if (!email) {
  console.error('Usage : pnpm admin:create -- --email admin@exemple.be [--name "Nom"] [--password "…"]');
  process.exit(1);
}
const password = values.password ?? process.env['ADMIN_PASSWORD'] ?? randomBytes(12).toString('base64url');
const prisma = createPrismaClient({
  url: process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'],
});
try {
  const passwordHash = await hashPassword(password);
  await withSystem(prisma, (tx) =>
    tx.user.upsert({
      where: { email },
      update: { isPlatformAdmin: true, passwordHash },
      create: {
        email,
        name: values.name ?? 'Administrateur Batimint',
        passwordHash,
        isPlatformAdmin: true,
        emailVerifiedAt: new Date(),
      },
    }),
  );
  console.info(
    `Super-admin prêt : ${email}${values.password || process.env['ADMIN_PASSWORD'] ? '' : ` (mot de passe : ${password})`}`,
  );
} finally {
  await prisma.$disconnect();
}
