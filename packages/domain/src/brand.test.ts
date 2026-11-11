import { describe, expect, it } from "vitest";
import { brandDraftSchema, factProblems, isIanaTimeZone, localDate, missingRequiredFields, usableFacts, type BrandDraft, type Fact } from "./brand";

const complete: BrandDraft = {
  name: "Boulangerie Démo",
  sector: "restaurant",
  description: "Pains au levain",
  audience: "Familles du quartier",
  area: "Montréal",
  services: ["Pains", "Viennoiseries"],
  tone: { voice: "warm", avoid: ["superlatifs"] },
  defaultContentLocale: "fr-CA",
  timezone: "America/Toronto",
  facts: [],
  factsSourceConfirmed: true,
};

describe("profil de marque", () => {
  it("brouillon partiel accepté (reprise) ; profil complet sans champ manquant", () => {
    expect(brandDraftSchema.safeParse({ name: "X" }).success).toBe(true);
    expect(missingRequiredFields({ name: "X" })).toEqual(["sector", "description", "audience", "area", "services", "tone", "defaultContentLocale", "timezone", "factsSourceConfirmed"]);
    expect(missingRequiredFields(complete)).toEqual([]);
  });

  it("source de faits non confirmée : profil incomplet", () => {
    expect(missingRequiredFields({ ...complete, factsSourceConfirmed: false })).toEqual(["factsSourceConfirmed"]);
  });

  it("fuseau IANA validé ; valeurs hors liste et textes trop longs refusés", () => {
    expect(isIanaTimeZone("America/Vancouver")).toBe(true);
    expect(brandDraftSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(brandDraftSchema.safeParse({ sector: "casino" }).success).toBe(false);
    expect(brandDraftSchema.safeParse({ description: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("faits datés", () => {
  const f = (o: Partial<Fact>): Fact => ({ id: "f", kind: "service", value: "v", confirmed: true, validFrom: null, validUntil: null, ...o });

  it("horaires et prix exigent une date de début, promotion une date de fin", () => {
    expect(factProblems([f({ id: "h", kind: "hours" }), f({ id: "p", kind: "promotion", validFrom: "2026-11-01" }), f({ id: "s", kind: "service" })])).toEqual([
      { factId: "h", problem: "missing_validity" },
      { factId: "p", problem: "missing_validity" },
    ]);
  });

  it("promotion expirée exclue, future exclue, non confirmée exclue (date locale du fuseau)", () => {
    const now = new Date("2026-11-12T03:00:00Z"); // 11 nov. 22 h à Toronto
    expect(localDate(now, "America/Toronto")).toBe("2026-11-11");
    const r = usableFacts(
      [
        f({ id: "promo-ok", kind: "promotion", validUntil: "2026-11-11" }),
        f({ id: "promo-old", kind: "promotion", validUntil: "2026-11-10" }),
        f({ id: "price-future", kind: "price", validFrom: "2026-12-01" }),
        f({ id: "unconfirmed", confirmed: false }),
      ],
      now,
      "America/Toronto",
    );
    expect(r.usable.map((x) => x.id)).toEqual(["promo-ok"]);
    expect(r.expired.map((x) => x.id)).toEqual(["promo-old"]);
    expect(r.notYetValid.map((x) => x.id)).toEqual(["price-future"]);
    expect(r.unconfirmed.map((x) => x.id)).toEqual(["unconfirmed"]);
  });

  it("plage de validité incohérente refusée", () => {
    expect(brandDraftSchema.safeParse({ facts: [f({ validFrom: "2026-12-01", validUntil: "2026-11-01" })] }).success).toBe(false);
  });
});
