import { z } from "zod";

/**
 * Configuration validée au démarrage (SPECIFICATION §18).
 * - Mode fake formellement refusé en production (§9).
 * - Mode live incomplet échoue explicitement, en listant les clés manquantes (jamais leurs valeurs).
 * - Un connecteur désactivé (feature flag) n'exige pas ses variables.
 */

export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const boolFlag = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v));

const rawSchema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  APP_BASE_URL: z.string().url(),
  ADAPTER_MODE: z.enum(["fake", "live"]),
  AUTH_MODE: z.enum(["fake", "cognito"]),
  DATABASE_URL: optionalString,
  AWS_REGION: optionalString,
  COGNITO_USER_POOL_ID: optionalString,
  COGNITO_CLIENT_ID: optionalString,
  S3_BUCKET_PRIVATE: optionalString,
  SQS_GENERATION_QUEUE_URL: optionalString,
  SQS_PUBLISHING_QUEUE_URL: optionalString,
  KMS_TOKEN_KEY_ID: optionalString,
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  META_API_VERSION: optionalString,
  LINKEDIN_CLIENT_ID: optionalString,
  LINKEDIN_CLIENT_SECRET: optionalString,
  LINKEDIN_API_VERSION: optionalString,
  AI_PROVIDER: optionalString,
  AI_MODEL_TEXT: optionalString,
  AI_API_KEY: optionalString,
  SES_FROM_EMAIL: optionalString,
  SENTRY_DSN: optionalString,
  FEATURE_META_ENABLED: boolFlag,
  FEATURE_LINKEDIN_ENABLED: boolFlag,
});

export type AppConfig = z.output<typeof rawSchema>;

/** Fournisseurs IA approuvés : pas de bascule vers un fournisseur non approuvé (§12). */
export const APPROVED_AI_PROVIDERS = ["openai"] as const;

export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Configuration invalide :\n - ${problems.join("\n - ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

type Key = keyof AppConfig;

const LIVE_REQUIRED: readonly Key[] = [
  "DATABASE_URL",
  "AWS_REGION",
  "S3_BUCKET_PRIVATE",
  "SQS_GENERATION_QUEUE_URL",
  "SQS_PUBLISHING_QUEUE_URL",
  "KMS_TOKEN_KEY_ID",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "AI_PROVIDER",
  "AI_MODEL_TEXT",
  "AI_API_KEY",
  "SES_FROM_EMAIL",
];
const COGNITO_REQUIRED: readonly Key[] = ["AWS_REGION", "COGNITO_USER_POOL_ID", "COGNITO_CLIENT_ID"];
const META_REQUIRED: readonly Key[] = ["META_APP_ID", "META_APP_SECRET", "META_API_VERSION"];
const LINKEDIN_REQUIRED: readonly Key[] = ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_API_VERSION"];

function missing(cfg: AppConfig, keys: readonly Key[], reason: string): string[] {
  return keys.filter((k) => cfg[k] === undefined).map((k) => `${k} requis (${reason})`);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = rawSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "(racine)"} : ${i.message}`));
  }
  const cfg = parsed.data;
  const problems: string[] = [];

  if (cfg.APP_ENV === "production" || cfg.APP_ENV === "staging") {
    if (cfg.ADAPTER_MODE === "fake") problems.push(`ADAPTER_MODE=fake interdit en ${cfg.APP_ENV}`);
    if (cfg.AUTH_MODE === "fake") problems.push(`AUTH_MODE=fake interdit en ${cfg.APP_ENV}`);
  }
  if (cfg.ADAPTER_MODE === "live") {
    problems.push(...missing(cfg, LIVE_REQUIRED, "ADAPTER_MODE=live"));
    if (cfg.AI_PROVIDER !== undefined && !(APPROVED_AI_PROVIDERS as readonly string[]).includes(cfg.AI_PROVIDER)) {
      problems.push(`AI_PROVIDER non approuvé : ${cfg.AI_PROVIDER}`);
    }
    if (cfg.FEATURE_META_ENABLED) problems.push(...missing(cfg, META_REQUIRED, "FEATURE_META_ENABLED"));
    if (cfg.FEATURE_LINKEDIN_ENABLED) problems.push(...missing(cfg, LINKEDIN_REQUIRED, "FEATURE_LINKEDIN_ENABLED"));
  }
  if (cfg.AUTH_MODE === "cognito") problems.push(...missing(cfg, COGNITO_REQUIRED, "AUTH_MODE=cognito"));

  if (problems.length > 0) throw new ConfigError([...new Set(problems)]);
  return cfg;
}

/** Libellé explicite du mode démo/simulation, affichable à l'utilisateur (§17 : mode démo étiqueté). */
export function isSimulation(cfg: Pick<AppConfig, "ADAPTER_MODE">): boolean {
  return cfg.ADAPTER_MODE === "fake";
}
