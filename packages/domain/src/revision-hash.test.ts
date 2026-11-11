import { describe, expect, it } from "vitest";
import { computeRevisionHash, type RevisionContent } from "./revision-hash";

const base: RevisionContent = {
  caption: "Ouverture samedi",
  locale: "fr-CA",
  provider: "facebook_page",
  media: [{ mediaAssetId: "m1", sha256: "a".repeat(64) }],
};

describe("computeRevisionHash", () => {
  it("est stable et au format hex 64", () => {
    expect(computeRevisionHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeRevisionHash({ ...base })).toBe(computeRevisionHash(base));
  });

  it("change si le texte, la langue, le réseau ou un média change", () => {
    const h = computeRevisionHash(base);
    expect(computeRevisionHash({ ...base, caption: "Ouverture dimanche" })).not.toBe(h);
    expect(computeRevisionHash({ ...base, locale: "en-CA" })).not.toBe(h);
    expect(computeRevisionHash({ ...base, provider: "instagram_business" })).not.toBe(h);
    expect(computeRevisionHash({ ...base, media: [{ mediaAssetId: "m1", sha256: "b".repeat(64) }] })).not.toBe(h);
    expect(computeRevisionHash({ ...base, media: [] })).not.toBe(h);
  });

  it("est sensible à l'ordre des médias mais pas à la normalisation Unicode", () => {
    const two = { ...base, media: [{ mediaAssetId: "m1", sha256: "a".repeat(64) }, { mediaAssetId: "m2", sha256: "c".repeat(64) }] };
    expect(computeRevisionHash({ ...two, media: [...two.media].reverse() })).not.toBe(computeRevisionHash(two));
    expect(computeRevisionHash({ ...base, caption: "Café" })).toBe(computeRevisionHash({ ...base, caption: "Café" }));
  });
});
