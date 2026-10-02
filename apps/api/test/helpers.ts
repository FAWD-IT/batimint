import { createPrismaClient, type PrismaClient } from '@batimint/db';
import { testDatabaseUrls } from '@batimint/db/testing';
import {
  MemoryStorage,
  MockAttendanceRegistry,
  MockPaymentLinkProvider,
  MockAiAssistant,
  MockMailer,
  MockPeppolProvider,
  MockVatValidator,
} from '@batimint/integrations';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { loadConfig } from '../src/config';
import type { AppDeps } from '../src/context';
import { FieldCipher } from '../src/lib/crypto';
import { loadDotEnv } from '../src/lib/env';
import { RealtimeHub } from '../src/realtime/hub';
import { buildServer } from '../src/server';

loadDotEnv();

export interface TestApp {
  app: FastifyInstance;
  deps: AppDeps;
  mailer: MockMailer;
  prisma: PrismaClient;
  ownerUrl: string;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const urls = testDatabaseUrls('api');
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: urls.appUrl,
    RATE_LIMIT_DISABLED: 'true',
    APP_URL: 'http://localhost:3000',
  });
  const prisma = createPrismaClient({ url: urls.appUrl, max: 10 });
  const mailer = new MockMailer();
  const deps: AppDeps = {
    config,
    prisma,
    integrations: {
      mailer,
      storage: new MemoryStorage(),
      vat: new MockVatValidator(),
      peppol: new MockPeppolProvider(),
      ai: new MockAiAssistant(),
      attendance: new MockAttendanceRegistry(),
      payments: new MockPaymentLinkProvider(),
    },
    cipher: new FieldCipher(config.FIELD_ENCRYPTION_KEY),
    realtime: new RealtimeHub(null),
  };
  const app = await buildServer(deps, { logger: process.env['DEBUG_API'] ? { level: 'error' } : false });
  await app.ready();
  return {
    app,
    deps,
    mailer,
    prisma,
    ownerUrl: urls.ownerUrl,
    async close() {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

export function sessionCookie(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === 'bm_session');
  if (!c) throw new Error(`Pas de cookie de session (statut ${res.statusCode}) : ${res.body}`);
  return `bm_session=${c.value}`;
}

export interface SignedUp {
  cookie: string;
  token: string;
  email: string;
  password: string;
}

export async function signupCompany(app: FastifyInstance, company = 'Rénov Test'): Promise<SignedUp> {
  const email = `owner-${uuidv7().slice(-12)}@example.test`;
  const password = 'motdepasse-solide-42';
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { companyName: company, name: 'Marc Test', email, password },
  });
  if (res.statusCode !== 201) throw new Error(`signup ${res.statusCode}: ${res.body}`);
  return { cookie: sessionCookie(res), token: res.json().sessionToken, email, password };
}
