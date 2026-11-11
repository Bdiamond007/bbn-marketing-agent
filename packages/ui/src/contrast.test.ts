import { describe, expect, it } from "vitest";
import { AA_NORMAL_TEXT, contrastRatio } from "./contrast";
import { colors } from "./tokens";

describe("contrastes des paires prévues par le design system", () => {
  it.each([
    ["texte sur blanc", colors.text, colors.white],
    ["texte secondaire sur fond", colors.textSecondary, colors.background],
    ["noir sur bouton or", colors.black, colors.gold],
    ["or sombre sur blanc", colors.goldDark, colors.white],
    ["erreur sur blanc", colors.error, colors.white],
    ["succès sur blanc", colors.success, colors.white],
    ["info sur blanc", colors.info, colors.white],
    ["blanc sur noir", colors.white, colors.black],
  ])("%s atteint AA texte normal", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("l'or principal sur blanc échoue pour le petit texte (interdit par §8)", () => {
    expect(contrastRatio(colors.gold, colors.white)).toBeLessThan(AA_NORMAL_TEXT);
  });
});
