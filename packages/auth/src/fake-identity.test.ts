import { ManualClock } from "@bbn/domain";
import { describe, expect, it } from "vitest";
import { FakeIdentityProvider } from "./fake-identity";
import { IdentityError } from "./identity";

const pw = "correct horse battery";

describe("FakeIdentityProvider", () => {
  it("crée un compte non vérifié, puis le vérifie avec un code à usage unique", async () => {
    const idp = new FakeIdentityProvider(new ManualClock());
    const { user, verificationCode } = await idp.signUp("Owner@Example.test", pw);
    expect(user.emailVerified).toBe(false);
    expect((await idp.verifyEmail("owner@example.test", verificationCode)).emailVerified).toBe(true);
    await expect(idp.verifyEmail("owner@example.test", verificationCode)).rejects.toBeInstanceOf(IdentityError);
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
    await expect(idp.startRecovery("unknown@example.test")).resolves.toBeUndefined();
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
