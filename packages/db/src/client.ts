import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/client';

export { Prisma, PrismaClient };
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient;

export interface CreateClientOptions {
  url?: string;
  /** Taille max du pool de connexions. */
  max?: number;
  applicationName?: string;
}

export function createPrismaClient(options: CreateClientOptions = {}): PrismaClient {
  const url = options.url ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL manquant');
  const adapter = new PrismaPg({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'batimint',
  });
  return new PrismaClient({ adapter });
}
