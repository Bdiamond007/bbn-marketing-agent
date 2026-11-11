import { ManualClock } from "@bbn/domain";
import { describe, expect, it } from "vitest";
import { FakeIdentityProvider } from "./fake-identity";
import { IdentityError } from "./identity";
import { CognitoNotImplementedError, createIdentityProvider } from "./factory";

const pw = "correct horse battery";

describe("FakeIdentityProvider", () => {
  it("crée un compte non vérifié, puis le vérifie avec un code à usage unique", async () => {
    const idp = new FakeIdentityProvider(new ManualClock());
    const { user, verificationCode } = await idp.signUp("Owner@Example.test", pw);
    expect(user.emailVerified).toBe(false);
    expect((await idp.verifyEmail("owner@example.test", verificationCode!)).emailVerified).toBe(true);
    await expect(idp.verifyEmail("owner@example.test", verificationCode!)).rejects.toBeInstanceOf(IdentityError);
  });

  it("refuse mauvais mot de passe et doublon d'email", async () => {
    const idp = new FakeIdentityProvider(new ManualClock());
    await idp.signUp("a@example.test", pw);
    await expect(idp.signIn("a@example.test", "nope nope nope")).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(idp.signUp("A@example.test", pw)).rejects.toMatchObject({ code: "email_taken" });
  });

  it("récupération à usage unique et expirante, sans énumération", async () => {
    const clock = new ManualClock();
    const idp = new FakeIdentityProvider(clock);
    await idp.signUp("a@example.test", pw);
    await expect(idp.startRecovery("unknown@example.test")).resolves.toEqual({});
    await idp.startRecovery("a@example.test");
    const code = idp.outbox.filter((o) => o.kind === "recovery").at(-1)!.code;
    await idp.completeRecovery("a@example.test", code, "a brand new passphrase");
    await expect(idp.completeRecovery("a@example.test", code, "another passphrase!")).rejects.toMatchObject({ code: "invalid_code" });
    await expect(idp.signIn("a@example.test", "a brand new passphrase")).resolves.toBeTruthy();

    await idp.startRecovery("a@example.test");
    const code2 = idp.outbox.filter((o) => o.kind === "recovery").at(-1)!.code;
    clock.advanceSeconds(15 * 60);
    await expect(idp.completeRecovery("a@example.test", code2, "late passphrase!!")).rejects.toMatchObject({ code: "code_expired" });
  });
});

describe("createIdentityProvider", () => {
  it("fake autorisé en développement et test seulement", () => {
    expect(createIdentityProvider({ AUTH_MODE: "fake", APP_ENV: "test" }, new ManualClock())).toBeInstanceOf(FakeIdentityProvider);
    expect(() => createIdentityProvider({ AUTH_MODE: "fake", APP_ENV: "production" }, new ManualClock())).toThrow();
    expect(() => createIdentityProvider({ AUTH_MODE: "fake", APP_ENV: "staging" }, new ManualClock())).toThrow();
  });
  it("Cognito : échec explicite tant que l'adaptateur n'est pas implémenté et prouvé", () => {
    expect(() => createIdentityProvider({ AUTH_MODE: "cognito", APP_ENV: "production" }, new ManualClock())).toThrow(CognitoNotImplementedError);
  });
  it("sujets uniques entre instances", async () => {
    const a = await new FakeIdentityProvider(new ManualClock()).signUp("x@example.test", pw);
    const b = await new FakeIdentityProvider(new ManualClock()).signUp("x@example.test", pw);
    expect(a.user.subject).not.toBe(b.user.subject);
  });
});
