import type { PrismaClient } from '@batimint/db';
import type { Action, Role } from '@batimint/domain';
import type { Integrations } from '@batimint/integrations';
import type { Config } from './config';
import type { FieldCipher } from './lib/crypto';
import type { RealtimeHub } from './realtime/hub';

export interface AppDeps {
  config: Config;
  prisma: PrismaClient;
  integrations: Integrations;
  cipher: FieldCipher;
  realtime: RealtimeHub;
}

export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  tenantId: string | null;
  role: Role | null;
  impersonatorId: string | null;
  via: 'cookie' | 'bearer';
}

export interface TenantAuthContext extends AuthContext {
  tenantId: string;
  role: Role;
}

export type { Action };
