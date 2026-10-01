import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
  COOKIE_DOMAIN: z.string().optional().transform((v) => v || undefined),
  SESSION_SECRET: z.string().min(16),
  PORTAL_TOKEN_SECRET: z.string().min(16),
  FIELD_ENCRYPTION_KEY: z.string().min(16),
  TRUST_PROXY: bool,
  RATE_LIMIT_DISABLED: bool,
  CORS_ORIGINS: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema> & {
  isProduction: boolean;
  allowedOrigins: string[];
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  const c = parsed.data;
  const allowedOrigins = [c.APP_URL, ...(c.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [])];
  return { ...c, isProduction: c.NODE_ENV === 'production', allowedOrigins };
}
