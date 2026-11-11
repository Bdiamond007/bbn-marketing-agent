import { describe, expect, it } from "vitest";
import { ERROR_STATUS } from "@bbn/domain";
import { catalogs } from "@bbn/i18n/messages";
import { LOCALES } from "@bbn/i18n";
import { renderEmail } from "./emails";

describe("courriels transactionnels", () => {
  it("rendus dans la langue demandée, avec variables", () => {
    expect(renderEmail("fr-CA", "verifyEmail", { code: "123456" }).text).toContain("123456");
    expect(renderEmail("en-CA", "invitation", { organization: "Org", link: "https://x" }).subject).toBe("Invitation to join Org");
  });
  it("variable manquante : erreur explicite", () => {
    expect(() => renderEmail("fr-CA", "verifyEmail", {})).toThrow("missing_email_variable");
  });
});

describe("codes d'erreur", () => {
  it("chaque code a un message dans chaque langue", () => {
    for (const loc of LOCALES) {
      const codes = (catalogs[loc].errors as { codes: Record<string, string> }).codes;
      for (const c of Object.keys(ERROR_STATUS)) expect(codes[c], `${loc}:${c}`).toBeTruthy();
    }
  });
});
