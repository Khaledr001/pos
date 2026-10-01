import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/**
 * Environment schema. Validated once at boot; the app refuses to start on
 * invalid config instead of failing on the first request.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Auth
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  COOKIE_DOMAIN: z.string().optional(), // ".yourdomain.ae" in production
  COOKIE_SECURE: bool.default(false),

  // Frontend (revalidation + links in emails)
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  REVALIDATE_SECRET: z.string().min(16),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // POS integration
  POS_WEBHOOK_SECRET: z.string().min(16), // verifies POS → website webhooks
  POS_OUTBOUND_SECRET: z.string().min(16), // signs website → POS events
  POS_BASE_URL: z.string().url().optional(), // unset = outbox stays pending
  POS_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().default(300),
  RECONCILIATION_CRON: z.string().default('0 2 * * *'), // 02:00 Asia/Dubai

  // Payments
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  DEV_PAYMENTS: bool.default(false), // fake card gateway for local dev/tests

  // Notifications
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Al-Lahiq <orders@example.ae>'),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  // Background work (disable in tests for deterministic runs)
  QUEUES_ENABLED: bool.default(true),
  SCHEDULER_ENABLED: bool.default(true),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
