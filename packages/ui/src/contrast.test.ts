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

describe("contrastes des états interactifs utilisés par l'application (normal, survol, désactivé, focus)", () => {
  const NON_TEXT = 3; // WCAG 1.4.11 : indicateurs de focus et bordures de contrôle
  it.each([
    ["bouton primaire survolé : noir sur or clair", colors.black, "#E2C35A", AA_NORMAL_TEXT],
    ["bouton désactivé : secondaire sur bordure", colors.textSecondary, colors.border, AA_NORMAL_TEXT],
    ["bouton danger survolé : blanc sur rouge foncé", colors.white, "#912018", AA_NORMAL_TEXT],
    ["bannière de simulation : noir sur or doux", colors.black, colors.goldSoft, AA_NORMAL_TEXT],
    ["focus sur fond clair : or sombre / blanc", colors.goldDark, colors.white, NON_TEXT],
    ["focus sur fond clair : or sombre / fond", colors.goldDark, colors.background, NON_TEXT],
    ["focus sur fond sombre : or / noir", colors.gold, colors.black, NON_TEXT],
    ["bordure de champ : secondaire / blanc", colors.textSecondary, colors.white, NON_TEXT],
    ["texte d'accueil sombre : gris clair / noir", "#E6E6EA", colors.black, AA_NORMAL_TEXT],
  ])("%s", (_l, fg, bg, min) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});
