import { ManualClock } from "@bbn/domain";
import { describe, expect, it } from "vitest";
import { AiProviderError } from "./ai";
import { req } from "./contracts/social";
import { FakeAiTextProvider, FakeEmailSender, FakeMessageQueue, FakeOAuthConnector, FakeObjectStorage, FakeSocialPublisher, sha256Hex } from "./fakes";
import { createAdapters, LiveAdapterNotImplementedError } from "./index";
import { SimulatedProviderError, SimulatedTimeoutError } from "./scenario";

describe("FakeSocialPublisher — scénarios déterministes", () => {
  it("timeout après émission : unknown, le post existe, la réconciliation le confirme", async () => {
    const p = new FakeSocialPublisher("facebook_page");
    p.scenarios.next("timeout_after_send");
    const out = await p.publish(req("attempt-1"));
    expect(out).toEqual({ kind: "unknown", reason: "timeout_after_send" });
    expect(p.postsFor("acct_1", "attempt-1")).toHaveLength(1);
    const rec = await p.reconcile({ connectionRef: req("x").connectionRef, requestKey: "attempt-1", externalRef: null });
    expect(rec.kind).toBe("confirmed");
  });

  it("un renvoi aveugle après unknown crée un doublon détectable", async () => {
    const p = new FakeSocialPublisher("facebook_page");
    p.scenarios.next("timeout_after_send");
    await p.publish(req("attempt-1"));
    await p.publish(req("attempt-1"));
    expect(p.postsFor("acct_1", "attempt-1")).toHaveLength(2);
  });

  it("timeout avant émission : unknown et réconciliation not_found", async () => {
    const p = new FakeSocialPublisher("instagram_business");
    p.scenarios.next("timeout_before_send");
    expect((await p.publish(req("a"))).kind).toBe("unknown");
    expect(await p.reconcile({ connectionRef: req("a").connectionRef, requestKey: "a", externalRef: null })).toEqual({ kind: "not_found" });
  });

  it("processing puis fin de traitement", async () => {
    const p = new FakeSocialPublisher("instagram_business");
    p.scenarios.next("processing");
    const out = await p.publish(req("a"));
    if (out.kind !== "processing") throw new Error("attendu processing");
    const ref = { connectionRef: req("a").connectionRef, requestKey: "a", externalRef: out.externalRef };
    expect((await p.reconcile(ref)).kind).toBe("processing");
    p.completeProcessing(out.externalRef);
    expect((await p.reconcile(ref)).kind).toBe("confirmed");
  });

  it("classes de rejet distinctes, avec Retry-After pour la limitation", async () => {
    const p = new FakeSocialPublisher("facebook_page");
    p.scenarios.next("rejected_permission", "rejected_token_expired", "rate_limited", "provider_error");
    expect(await p.publish(req("1"))).toMatchObject({ rejection: "permission" });
    expect(await p.publish(req("2"))).toMatchObject({ rejection: "token_expired" });
    expect(await p.publish(req("3"))).toMatchObject({ rejection: "rate_limited", retryAfterSeconds: 60 });
    expect(await p.publish(req("4"))).toMatchObject({ rejection: "provider_error" });
    expect(p.posts).toHaveLength(0);
  });

  it("le manifeste du simulateur est explicitement non vérifié", () => {
    const m = new FakeSocialPublisher("linkedin_page").getCapabilities();
    expect(m.source).toBe("simulator");
    expect(m.verifiedAt).toBeNull();
  });
});

describe("FakeMessageQueue", () => {
  it("double livraison forcée pour tester l'idempotence des consommateurs", async () => {
    const q = new FakeMessageQueue(new ManualClock());
    await q.send("publishing", { publicationId: "p1" });
    q.duplicateNext();
    const msgs = await q.receive<{ publicationId: string }>("publishing", { maxMessages: 10, visibilityTimeoutSeconds: 30 });
    expect(msgs.map((m) => m.body.publicationId)).toEqual(["p1", "p1"]);
  });

  it("déplace en DLQ après le nombre maximal de réceptions", async () => {
    const clock = new ManualClock();
    const q = new FakeMessageQueue(clock, 2);
    await q.send("generation", { job: "poison" });
    for (let i = 0; i < 2; i++) {
      expect(await q.receive("generation", { maxMessages: 1, visibilityTimeoutSeconds: 1 })).toHaveLength(1);
      clock.advanceSeconds(2);
    }
    expect(await q.receive("generation", { maxMessages: 1, visibilityTimeoutSeconds: 1 })).toHaveLength(0);
    expect(q.deadLetters("generation")).toEqual([{ job: "poison" }]);
    expect(q.depth("generation")).toBe(0);
  });
});

describe("FakeObjectStorage — URLs signées", () => {
  it("refuse une URL altérée ou utilisée avec une autre méthode", async () => {
    const s = new FakeObjectStorage(new ManualClock());
    const put = await s.createSignedPutUrl("org/a/u.png", { contentType: "image/png", maxBytes: 20 * 1024 * 1024, ttlSeconds: 300 });
    expect(s.verifySignedUrl(put, "PUT").ok).toBe(true);
    expect(s.verifySignedUrl(put, "GET")).toEqual({ ok: false, reason: "bad_signature" });
    expect(s.verifySignedUrl(put.replace("u.png", "v.png"), "PUT")).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("FakeEmailSender", () => {
  it("simule échec et délai sans enregistrer de message, puis réussit", async () => {
    const e = new FakeEmailSender();
    e.scenarios.next("failure", "timeout");
    const m = { to: "A@example.test", locale: "en-CA" as const, templateKey: "t", templateVersion: 1, subject: "s", text: "t", idempotencyKey: "k" };
    await expect(e.send(m)).rejects.toBeInstanceOf(SimulatedProviderError);
    await expect(e.send(m)).rejects.toBeInstanceOf(SimulatedTimeoutError);
    await e.send(m);
    expect(e.inboxOf("a@example.test")).toHaveLength(1);
  });
});

describe("FakeAiTextProvider", () => {
  const base = { promptVersion: "caption-v1", model: "fake-model", locale: "fr-CA" as const, instructions: "Rédige.", untrustedContext: { topic: "Ouverture", factIds: ["f1", 2] }, timeoutMs: 1000 };

  it("est déterministe et ne cite que les faits fournis", async () => {
    const ai = new FakeAiTextProvider();
    const a = await ai.generate(base);
    const b = await ai.generate(base);
    expect(a.outputText).toBe(b.outputText);
    const parsed = JSON.parse(a.outputText) as { usedFactIds: string[]; caption: string; requiresHumanReview: boolean };
    expect(parsed.usedFactIds).toEqual(["f1"]);
    expect(parsed.caption).toContain("SIMULATION");
    expect(parsed.requiresHumanReview).toBe(true);
  });

  it("simule délai, limitation et sorties invalides", async () => {
    const ai = new FakeAiTextProvider();
    ai.scenarios.next("timeout", "rate_limited", "invalid_json");
    await expect(ai.generate(base)).rejects.toMatchObject({ errorClass: "timeout" });
    await expect(ai.generate(base)).rejects.toBeInstanceOf(AiProviderError);
    expect((await ai.generate(base)).outputText).toBe("{ not json");
  });
});

describe("FakeOAuthConnector", () => {
  const verifier = "verifier-123";
  const challenge = sha256Hex(verifier);

  it("vérifie state et PKCE ; code à usage unique", async () => {
    const o = new FakeOAuthConnector("facebook_page");
    const url = new URL(o.authorize({ state: "s1", redirectUri: "http://localhost/cb", codeChallenge: challenge }).url);
    const code = url.searchParams.get("code")!;
    await expect(o.callback({ code, state: "evil", expectedState: "s1", codeVerifier: verifier })).rejects.toThrow("oauth_state_mismatch");
    await expect(o.callback({ code, state: "s1", expectedState: "s1", codeVerifier: "wrong" })).rejects.toThrow("oauth_pkce_mismatch");
    const ok = await o.callback({ code, state: "s1", expectedState: "s1", codeVerifier: verifier });
    expect(ok.tokens.secret).toMatch(/^fake-token-/);
    await expect(o.callback({ code, state: "s1", expectedState: "s1", codeVerifier: verifier })).rejects.toThrow("oauth_invalid_code");
  });

  it("refus d'accès simulé", async () => {
    const o = new FakeOAuthConnector("instagram_business");
    o.scenarios.next("access_denied");
    await expect(o.callback({ code: "c", state: "s", expectedState: "s", codeVerifier: verifier })).rejects.toThrow("oauth_access_denied");
  });
});

describe("createAdapters", () => {
  it("fournit des simulateurs en développement", () => {
    expect(createAdapters({ ADAPTER_MODE: "fake", APP_ENV: "development" }).mode).toBe("fake");
  });
  it("refuse les simulateurs en production même si la config était contournée", () => {
    expect(() => createAdapters({ ADAPTER_MODE: "fake", APP_ENV: "production" })).toThrow();
  });
  it("échoue explicitement en live tant qu'aucun adaptateur réel n'existe", () => {
    expect(() => createAdapters({ ADAPTER_MODE: "live", APP_ENV: "development" })).toThrow(LiveAdapterNotImplementedError);
  });
});
