import { describe, expect, it } from "vitest";
import { checkCatalogs, placeholders } from "./check";

describe("placeholders", () => {
  it("extrait les arguments simples et pluriels de premier niveau", () => {
    expect(placeholders("Bonjour {name}")).toEqual(["name"]);
    expect(placeholders("{count, plural, one {# contenu} other {# contenus}} pour {brand}")).toEqual(["brand", "count"]);
    expect(placeholders("Aucun argument")).toEqual([]);
  });
});

describe("checkCatalogs", () => {
  it("signale clé manquante, valeur vide, namespace absent et placeholders divergents", () => {
    const issues = checkCatalogs(
      {
        "fr-CA": { common: { a: "A {x}", b: "B", nested: { c: "C" } }, auth: { t: "T" } },
        "en-CA": { common: { a: "A {y}", b: " " } },
      },
      "fr-CA",
    );
    const problems = issues.map((i) => `${i.namespace}:${i.key}:${i.problem}`);
    expect(problems).toContain("common:nested.c:clé absente pour en-CA");
    expect(problems).toContain("common:b:valeur vide pour en-CA");
    expect(problems).toContain("auth:*:namespace absent pour en-CA");
    expect(problems.some((p) => p.startsWith("common:a:placeholders différents"))).toBe(true);
  });

  it("ne signale rien pour des catalogues alignés", () => {
    expect(checkCatalogs({ "fr-CA": { c: { k: "{n} jours" } }, "en-CA": { c: { k: "{n} days" } } }, "fr-CA")).toEqual([]);
  });
});
