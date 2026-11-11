import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { lastMail } from "./env";

const PW = "correct horse battery staple";
const uniqEmail = (p: string) => `${p}.${randomUUID().slice(0, 8)}@example.test`;

/** Chaque test a sa propre « adresse IP » pour ne pas épuiser les limites de débit partagées. */
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}-${randomUUID().slice(0, 4)}` });
});

async function expectNoA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${page.url()} ${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} — ${n.failureSummary?.split("\n")[1] ?? ""}`).join(" | ")}`)).toEqual([]);
}

async function signUpAndVerify(page: Page, email: string, seg: "fr" | "en" = "fr") {
  await page.goto(`/${seg}/sign-up`);
  await page.getByLabel(seg === "fr" ? "Adresse courriel" : "Email address").fill(email);
  await page.getByLabel(seg === "fr" ? "Mot de passe" : "Password", { exact: true }).fill(PW);
  await page.getByRole("button", { name: seg === "fr" ? "Créer mon compte" : "Create my account" }).click();
  await expect(page).toHaveURL(new RegExp(`/${seg}/verify-email`));
  const code = lastMail(email).text.match(/\b(\d{6})\b/)![1]!;
  await page.getByLabel(seg === "fr" ? "Code à 6 chiffres" : "6-digit code").fill(code);
  await page.getByRole("button", { name: seg === "fr" ? "Vérifier" : "Verify" }).click();
  await expect(page).toHaveURL(new RegExp(`/${seg}/sign-in`));
}

async function signIn(page: Page, email: string, seg: "fr" | "en" = "fr") {
  await page.goto(`/${seg}/sign-in`);
  await page.getByLabel(seg === "fr" ? "Adresse courriel" : "Email address").fill(email);
  await page.getByLabel(seg === "fr" ? "Mot de passe" : "Password", { exact: true }).fill(PW);
  await page.getByRole("button", { name: seg === "fr" ? "Se connecter" : "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/${seg}/app$`));
}

test("pages publiques et d'authentification : aucune violation WCAG 2.2 AA détectée par axe", async ({ page }) => {
  for (const path of ["/fr", "/en", "/fr/sign-in", "/en/sign-up", "/fr/recovery", "/en/verify-email"]) {
    await page.goto(path);
    await expectNoA11yViolations(page);
  }
});

test("le tableau de bord exige une session et n'est pas indexable", async ({ page }) => {
  await page.goto("/fr/app");
  await expect(page).toHaveURL(/\/fr\/sign-in$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("formulaire invalide : résumé d'erreur annoncé et focalisé, champs signalés", async ({ page }) => {
  await page.goto("/fr/sign-in");
  await page.getByRole("button", { name: "Se connecter" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Le formulaire contient des erreurs" });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(page.getByLabel("Adresse courriel")).toHaveAttribute("aria-invalid", "true");
});

test("clavier : lien d'évitement puis soumission à la touche Entrée", async ({ page }) => {
  await page.goto("/en/sign-in");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByLabel("Email address").fill(uniqEmail("kbd"));
  await page.getByLabel("Password", { exact: true }).fill("wrong password!!");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect email or password" })).toBeVisible();
});

test("parcours complet FR : inscription, vérification, organisation, invitation acceptée par un second compte", async ({ page, browser }) => {
  const owner = uniqEmail("owner");
  await signUpAndVerify(page, owner);
  await signIn(page, owner);
  await expect(page.getByRole("heading", { name: "Aucune organisation" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole("link", { name: "Créer une organisation" }).click();
  await page.getByLabel("Nom de l'organisation").fill("Atelier Démo E2E (fictif)");
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page).toHaveURL(/\/fr\/app$/);
  await expect(page.getByText("Atelier Démo E2E (fictif)")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quotas du cycle" })).toBeVisible();
  await expect(page.getByText("Aucun cycle de droits en cours. Choisissez un plan dans Facturation.")).toBeVisible();

  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Équipe" }).click();
  await expect(page.getByRole("heading", { name: "Équipe", level: 1 })).toBeVisible();
  await expectNoA11yViolations(page);
  const invitee = uniqEmail("invitee");
  await page.getByRole("textbox", { name: "Adresse courriel" }).fill(invitee);
  await page.getByLabel("Rôle", { exact: true }).selectOption("reviewer");
  await page.getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation envoyée" })).toBeVisible();

  // Second compte, dans un contexte de navigation séparé.
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${randomUUID().slice(0, 4)}` } });
  const p2 = await ctx.newPage();
  await signUpAndVerify(p2, invitee);
  await signIn(p2, invitee);
  const link = lastMail(invitee, "team.invitation").text.match(/https?:\/\/\S+/)![0]!;
  await p2.goto(new URL(link).pathname + new URL(link).search);
  await p2.getByRole("button", { name: "Accepter l'invitation" }).click();
  await expect(p2.getByRole("status").filter({ hasText: "Invitation acceptée" })).toBeVisible();
  await p2.goto("/fr/app/team");
  await expect(p2.getByText("Votre rôle permet de consulter l'équipe, pas de la modifier.")).toBeVisible();
  await ctx.close();

  await page.reload();
  const row = page.getByRole("listitem").filter({ hasText: invitee });
  await expect(row.getByLabel(`Rôle de ${invitee}`)).toHaveValue("reviewer");
  await row.getByRole("button", { name: "Retirer" }).click();
  const dialog = page.getByRole("dialog", { name: "Retirer ce membre ?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Retirer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Membre retiré." })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: invitee })).toHaveCount(0);
});

test("changer de langue conserve la page et ne traduit pas le nom de l'organisation", async ({ page }) => {
  const email = uniqEmail("lang");
  await signUpAndVerify(page, email, "en");
  await signIn(page, email, "en");
  await page.goto("/en/app/organizations/new");
  await page.getByLabel("Organization name").fill("Studio Nord (fictif)");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/en\/app$/);
  await page.goto("/en/app/team");
  await page.getByRole("link", { name: "Français" }).click();
  await expect(page).toHaveURL(/\/fr\/app\/team$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");
  await page.goto("/fr/app");
  await expect(page.getByText("Studio Nord (fictif)")).toBeVisible();
});

test("sections non livrées : état vide honnête, sans donnée inventée", async ({ page }) => {
  const email = uniqEmail("empty");
  await signUpAndVerify(page, email);
  await signIn(page, email);
  for (const s of ["calendar", "content", "reports"]) {
    await page.goto(`/fr/app/${s}`);
    await expect(page.getByRole("heading", { name: "Section pas encore disponible" })).toBeVisible();
  }
  await page.goto("/fr/app/unknown-section");
  await expect(page.locator("body")).toContainText(/404|introuvable|not be found/i);
});

test("375 px : aucun défilement horizontal sur les écrans principaux", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const email = uniqEmail("mobile");
  await signUpAndVerify(page, email);
  for (const path of ["/fr", "/fr/sign-in", "/fr/sign-up"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), path).toBe(false);
  }
  await signIn(page, email);
  for (const path of ["/fr/app", "/fr/app/team", "/fr/app/organizations/new"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), path).toBe(false);
  }
});

test("facturation : page de succès sans effet, paiement simulé, abonnement actif et droits réels", async ({ page }) => {
  const email = uniqEmail("billing");
  await signUpAndVerify(page, email);
  await signIn(page, email);
  await page.goto("/fr/app/organizations/new");
  await page.getByLabel("Nom de l'organisation").fill("Boutique Facturation (fictive)");
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page).toHaveURL(/\/fr\/app$/);

  // La page de retour Checkout n'accorde rien.
  await page.goto("/fr/app/billing/success");
  await expect(page.getByText("Cette page ne vaut pas confirmation.")).toBeVisible();
  await page.goto("/fr/app/billing");
  await expect(page.getByRole("heading", { name: "Aucun abonnement actif." })).toBeVisible();
  await expect(page.getByText("Aucun cycle de droits en cours.")).toBeVisible();
  await expectNoA11yViolations(page);

  const essentiel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Essentiel", level: 3 }) }).last();
  await expect(essentiel.getByText(/^99,00\s\$ par mois$/)).toBeVisible();
  await essentiel.getByRole("button", { name: "Choisir ce plan" }).click();
  await expect(page).toHaveURL(/\/fr\/app\/billing\/simulated-checkout\?session=/);
  await expect(page.getByText("Aucun paiement réel n'est effectué.")).toBeVisible();
  await page.getByRole("button", { name: "Simuler un paiement réussi" }).click();
  await expect(page).toHaveURL(/\/fr\/app\/billing$/);
  await expect(page.getByRole("heading", { name: "Plan actuel : Essentiel" })).toBeVisible();
  await expect(page.getByText("Actif", { exact: true })).toBeVisible();
  const rights = page.locator("section").filter({ has: page.getByRole("heading", { name: "Droits du cycle en cours" }) });
  await expect(rights.getByText("15 contenus sources")).toBeVisible();
  await expect(rights.getByText("45 publications")).toBeVisible();
  await page.goto("/fr/app");
  await expect(page.getByText("Contenus sources : 0 utilisés sur 15 (15 restants)")).toBeVisible();
  await expect(page.getByText("Publications : 0 réservées ou envoyées sur 45 (45 restantes)")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("marque : brouillon repris après rechargement, champs manquants, faits datés, publication et checklist", async ({ page }) => {
  const email = uniqEmail("brand");
  await signUpAndVerify(page, email);
  await signIn(page, email);
  await page.goto("/fr/app/organizations/new");
  await page.getByLabel("Nom de l'organisation").fill("Salon Démo (fictif)");
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page).toHaveURL(/\/fr\/app$/);

  await page.goto("/fr/app/brand");
  await page.getByLabel("Nom de la marque").fill("Salon Lumière (fictif)");
  await page.getByLabel("Langue des contenus").selectOption("en-CA");
  await page.getByLabel("Fuseau horaire").selectOption("America/Halifax");
  await page.getByRole("button", { name: "Créer la marque" }).click();
  await expect(page.getByText("Profil non publié")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByLabel("Secteur").selectOption("salon");
  await page.getByLabel("Description").fill("Coiffure et soins (fictif)");
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Brouillon enregistré" })).toBeVisible();

  // Reprise : le brouillon vient du serveur, pas du navigateur.
  await page.reload();
  await expect(page.getByLabel("Description")).toHaveValue("Coiffure et soins (fictif)");
  await expect(page.getByLabel("Langue des contenus")).toHaveValue("en-CA");
  const missing = page.getByRole("status").filter({ hasText: "À compléter avant publication" });
  await expect(missing).toContainText("Clientèle cible");
  await expect(missing).not.toContainText("Description");

  await page.getByLabel("Clientèle cible").fill("Résidents du quartier");
  await page.getByLabel("Zone desservie").fill("Halifax");
  await page.getByLabel("Services", { exact: true }).fill("Coupe\nColoration");
  await page.getByLabel("Ton", { exact: true }).selectOption("warm");
  await page.getByRole("button", { name: "Ajouter un fait" }).click();
  await page.getByLabel("Type").selectOption("promotion");
  await page.getByLabel("Information", { exact: true }).fill("Soin offert");
  await page.getByLabel("Information confirmée").check();
  await page.getByLabel("Je confirme que ces informations sont exactes").check();
  await page.getByRole("button", { name: "Publier le profil" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Un fait daté n'a pas de date de validité" })).toBeVisible(); // promotion sans date de fin
  await page.getByLabel("Valide jusqu'au").fill("2030-12-31");
  await page.getByRole("button", { name: "Publier le profil" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profil publié (version 1)." })).toBeVisible();
  await expect(page.getByText("Version publiée : 1")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/fr/app");
  const step = page.getByRole("listitem").filter({ hasText: "Publier le profil de marque" });
  await expect(step.getByText("Fait")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Connecter un compte social" }).getByText("Bientôt disponible")).toBeVisible();
});

const SMALL_PNG = Buffer.from("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", "base64");

test("médias : image réelle vérifiée et affichée par URL signée ; faux type refusé ; droits obligatoires", async ({ page }) => {
  const email = uniqEmail("media");
  await signUpAndVerify(page, email);
  await signIn(page, email);
  await page.goto("/fr/app/organizations/new");
  await page.getByLabel("Nom de l'organisation").fill("Atelier Médias (fictif)");
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page).toHaveURL(/\/fr\/app$/);
  await page.goto("/fr/app/media");
  await expect(page.getByText("Aucun média pour l'instant.")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByLabel("Fichier image").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: SMALL_PNG });
  await page.getByRole("button", { name: "Téléverser" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "La déclaration de droits est obligatoire." })).toBeVisible();
  await page.getByLabel("Je déclare détenir les droits nécessaires").check();
  await page.getByRole("button", { name: "Téléverser" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Image vérifiée et prête." })).toBeVisible();
  const img = page.getByRole("img", { name: "Média 1" });
  await expect(img).toBeVisible();
  expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(480);
  await expect(page.getByText("480 × 320 px")).toBeVisible();

  // Faux type : contenu texte annoncé comme JPEG.
  await page.getByLabel("Fichier image").setInputFiles({ name: "faux.jpg", mimeType: "image/jpeg", buffer: Buffer.from("ceci n'est pas une image") });
  await page.getByLabel("Je déclare détenir les droits nécessaires").check();
  await page.getByRole("button", { name: "Téléverser" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Image refusée : fichier illisible" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/fr/app");
  await expect(page.getByRole("listitem").filter({ hasText: "Ajouter des médias" }).getByText("Fait")).toBeVisible();
});
