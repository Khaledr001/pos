import { z } from "zod";

/**
 * Environment validation.
 *
 * Parsed once at boot; a missing or malformed variable crashes the process
 * immediately with a readable list. The alternative — discovering that
 * JWT_ACCESS_SECRET was undefined when the first user tries to log in — is
 * strictly worse, and on a POS system it happens at the counter with a queue.
 */

// Zod 4 applies .default() to the OUTPUT of a transform, so these defaults
// are booleans, not the strings that appear in .env.
const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const port = z.coerce.number().int().min(1).max(65535);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ---------------------------------------------------------------------------
  // Database
  // ---------------------------------------------------------------------------
  /** The APP role. RLS is enforced against it. Never point this at the migrator. */
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_SSL: bool.default(false),

  // ---------------------------------------------------------------------------
  // Redis
  // ---------------------------------------------------------------------------
  REDIS_URL: z.string().url(),

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  /**
   * 32 chars minimum. A short secret makes the HMAC brute-forceable offline,
   * and every POS terminal holds a token signed with it.
   */
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_TTL: z.string().default("30d"),
  /** Terminals stay signed in far longer than browsers; they are physically controlled. */
  JWT_POS_REFRESH_TTL: z.string().default("90d"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // ---------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------
  API_PORT: port.default(3001),
  API_PREFIX: z.string().default("api/v1"),
  API_CORS_ORIGINS: z.string().default("http://localhost:3000"),
  THROTTLE_TTL: z.coerce.number().int().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().default(120),

  // ---------------------------------------------------------------------------
  // Object storage
  // ---------------------------------------------------------------------------
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET: z.string(),
  S3_FORCE_PATH_STYLE: bool.default(true),
  S3_PUBLIC_URL: z.string().url(),

  // ---------------------------------------------------------------------------
  // WhatsApp (Phase 4 — optional until then)
  // ---------------------------------------------------------------------------
  WHATSAPP_ENABLED: bool.default(false),
  WHATSAPP_API_VERSION: z.string().default("v23.0"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  /** Validates X-Hub-Signature-256 on inbound webhooks. Required once enabled. */
  WHATSAPP_APP_SECRET: z.string().optional(),

  // ---------------------------------------------------------------------------
  // AI (Phase 4)
  // ---------------------------------------------------------------------------
  LLM_PROVIDER: z.enum(["openai", "gemini", "anthropic"]).default("openai"),
  LLM_MODEL: z.string().default("gpt-4o"),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MAX_TOKENS: z.coerce.number().int().default(1024),
  LLM_TIMEOUT_MS: z.coerce.number().int().default(20000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}\n\nCheck .env against .env.example.`);
  }

  const env = parsed.data;

  // Cross-field rules Zod cannot express field-by-field.
  if (env.WHATSAPP_ENABLED) {
    const missing = (
      [
        "WHATSAPP_PHONE_NUMBER_ID",
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_VERIFY_TOKEN",
        "WHATSAPP_APP_SECRET",
      ] as const
    ).filter((k) => !env[k]);

    if (missing.length > 0) {
      throw new Error(
        `WHATSAPP_ENABLED=true but these are unset: ${missing.join(", ")}.\n` +
          "Without WHATSAPP_APP_SECRET, webhook signatures cannot be verified and " +
          "anyone who learns the URL can inject messages.",
      );
    }
  }

  if (env.NODE_ENV === "production") {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      throw new Error(
        "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ in production: " +
          "sharing them lets an access token be replayed as a refresh token.",
      );
    }
    if (env.JWT_ACCESS_SECRET.includes("change-me")) {
      throw new Error("JWT secrets still hold their .env.example placeholder values.");
    }
  }

  return env;
}

/** Typed accessor. Prefer this over `process.env` anywhere in the app. */
export const configuration = () => validateEnv(process.env);
