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
  //
  // Only "deepseek" has a client behind it (LlmService). The other three
  // names are the record of an intended future, not working options —
  // selecting one throws LLM_NOT_CONFIGURED rather than silently doing
  // nothing. See docs/DECISIONS.md D19.
  // ---------------------------------------------------------------------------
  LLM_PROVIDER: z.enum(["openai", "gemini", "anthropic", "deepseek"]).default("deepseek"),
  /** Blank = the provider's own recommended default (LlmService resolves it). */
  LLM_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
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

  /**
   * Secret hygiene, in EVERY environment.
   *
   * These checks used to run only when `NODE_ENV === "production"`, which meant
   * a staging box — the one most likely to hold real data and be reachable from
   * the internet — was exempt purely because of how it labelled itself. The
   * cost of holding the rule everywhere is that a developer generates two
   * strings once; the cost of not holding it is a shared or placeholder signing
   * key somewhere nobody thought counted.
   */
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error(
      "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ: sharing them lets " +
        "an access token be replayed as a refresh token.",
    );
  }

  for (const [name, value] of [
    ["JWT_ACCESS_SECRET", env.JWT_ACCESS_SECRET],
    ["JWT_REFRESH_SECRET", env.JWT_REFRESH_SECRET],
  ] as const) {
    /**
     * Length alone is not entropy: a 32-character run of one letter satisfies
     * `min(32)`. Counting distinct characters is a crude floor, but it catches
     * the real failure — somebody padding a string to get past the validator.
     * Enforced everywhere, because a weak key is weak wherever it runs.
     */
    if (new Set(value).size < 12) {
      throw new Error(
        `${name} is not random enough. Generate one with: openssl rand -base64 48`,
      );
    }

    /**
     * The placeholder check stays production-only, and BOTH secrets are now
     * inspected — previously only the access secret was, so a refresh secret
     * left as `change-me-…` booted cleanly in production.
     *
     * Development keeps the placeholders on purpose: a fresh clone should run
     * `pnpm dev` without a key-generation ritual, and a dev database holds
     * nothing worth signing for.
     */
    if (env.NODE_ENV === "production" && value.includes("change-me")) {
      throw new Error(`${name} still holds its .env.example placeholder value.`);
    }
  }

  return env;
}

/** Typed accessor. Prefer this over `process.env` anywhere in the app. */
export const configuration = () => validateEnv(process.env);
