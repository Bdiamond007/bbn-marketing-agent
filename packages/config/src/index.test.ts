import { describe, expect, it } from "vitest";
import { ConfigError, isSimulation, loadConfig } from "./index";

const base = {
  APP_ENV: "development",
  APP_BASE_URL: "http://localhost:3000",
  ADAPTER_MODE: "fake",
  AUTH_MODE: "fake",
};

const liveComplete = {
  DATABASE_URL: "postgres://x",
  AWS_REGION: "ca-central-1",
  S3_BUCKET_PRIVATE: "b",
  SQS_GENERATION_QUEUE_URL: "q1",
  SQS_PUBLISHING_QUEUE_URL: "q2",
  KMS_TOKEN_KEY_ID: "k",
  STRIPE_SECRET_KEY: "placeholder",
  STRIPE_WEBHOOK_SECRET: "placeholder",
  AI_PROVIDER: "openai",
  AI_MODEL_TEXT: "m",
  AI_API_KEY: "placeholder",
  SES_FROM_EMAIL: "no-reply@example.test",
  COGNITO_USER_POOL_ID: "p",
  COGNITO_CLIENT_ID: "c",
};

function problemsOf(env: Record<string, string>): readonly string[] {
  try {
    loadConfig(env);
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
}

describe("loadConfig", () => {
  it("accepte le mode fake en développement sans aucun secret", () => {
    const cfg = loadConfig(base);
    expect(cfg.ADAPTER_MODE).toBe("fake");
    expect(isSimulation(cfg)).toBe(true);
  });

  it("refuse ADAPTER_MODE=fake et AUTH_MODE=fake en production", () => {
    const p = problemsOf({ ...base, APP_ENV: "production" });
    expect(p).toContain("ADAPTER_MODE=fake interdit en production");
    expect(p).toContain("AUTH_MODE=fake interdit en production");
  });

  it("refuse le fake en staging aussi", () => {
    expect(problemsOf({ ...base, APP_ENV: "staging" }).length).toBe(2);
  });

  it("échoue explicitement en live incomplet en listant les clés, jamais les valeurs", () => {
    const p = problemsOf({ ...base, ADAPTER_MODE: "live", STRIPE_SECRET_KEY: "should-not-leak" });
    expect(p).toContain("AI_API_KEY requis (ADAPTER_MODE=live)");
    expect(p.join(" ")).not.toContain("should-not-leak");
  });

  it("traite une valeur vide comme manquante", () => {
    const p = problemsOf({ ...base, ADAPTER_MODE: "live", ...liveComplete, AI_API_KEY: "  " });
    expect(p).toEqual(["AI_API_KEY requis (ADAPTER_MODE=live)"]);
  });

  it("accepte une production live complète, connecteurs désactivés sans leurs variables", () => {
    const cfg = loadConfig({ ...base, APP_ENV: "production", ADAPTER_MODE: "live", AUTH_MODE: "cognito", ...liveComplete });
    expect(cfg.FEATURE_META_ENABLED).toBe(false);
    expect(isSimulation(cfg)).toBe(false);
  });

  it("exige les variables Meta seulement si le flag Meta est ouvert", () => {
    const p = problemsOf({ ...base, ADAPTER_MODE: "live", AUTH_MODE: "cognito", ...liveComplete, FEATURE_META_ENABLED: "true" });
    expect(p).toEqual([
      "META_APP_ID requis (FEATURE_META_ENABLED)",
      "META_APP_SECRET requis (FEATURE_META_ENABLED)",
      "META_API_VERSION requis (FEATURE_META_ENABLED)",
    ]);
  });

  it("refuse un fournisseur IA non approuvé", () => {
    const p = problemsOf({ ...base, ADAPTER_MODE: "live", AUTH_MODE: "cognito", ...liveComplete, AI_PROVIDER: "other" });
    expect(p).toEqual(["AI_PROVIDER non approuvé : other"]);
  });

  it("rejette un APP_ENV inconnu", () => {
    expect(problemsOf({ ...base, APP_ENV: "prod" }).length).toBe(1);
  });
});
