import { describe, expect, it } from "vitest";
import { findLiterals } from "./check-jsx-literals";

describe("détection des chaînes codées en dur", () => {
  it("signale texte JSX, attributs accessibles et expressions littérales", () => {
    const src = `export const A = () => <div aria-label="Menu"><p>Bonjour</p>{"Salut"}<img alt="" /><b>{t("ok")}</b> — </div>;`;
    const r = findLiterals("a.tsx", src);
    expect(r).toHaveLength(3);
  });
  it("accepte les textes traduits et la ponctuation seule", () => {
    expect(findLiterals("b.tsx", `export const B = () => <p>{t("x")} · ({t("y")})</p>;`)).toEqual([]);
  });
});
