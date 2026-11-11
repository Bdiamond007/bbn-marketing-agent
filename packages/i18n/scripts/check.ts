import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCatalogs } from "../src/check";
import { DEFAULT_LOCALE, LOCALES, NAMESPACES } from "../src/index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");
const catalogs: Record<string, Record<string, never>> = {};
const issues: string[] = [];

for (const locale of LOCALES) {
  catalogs[locale] = {};
  const files = readdirSync(join(root, locale)).filter((f) => f.endsWith(".json"));
  for (const ns of NAMESPACES) if (!files.includes(`${ns}.json`)) issues.push(`${locale}: namespace requis manquant ${ns}`);
  for (const f of files) {
    try {
      catalogs[locale][f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(root, locale, f), "utf8")) as never;
    } catch (e) {
      issues.push(`${locale}/${f}: JSON invalide (${(e as Error).message})`);
    }
  }
}
for (const i of checkCatalogs(catalogs, DEFAULT_LOCALE)) issues.push(`${i.namespace}:${i.key} — ${i.problem}`);

if (issues.length > 0) {
  console.error(`i18n:check ÉCHEC (${issues.length})\n${issues.map((s) => ` - ${s}`).join("\n")}`);
  process.exit(1);
}
const count = Object.values(catalogs[DEFAULT_LOCALE]!).length;
console.log(`i18n:check OK — ${LOCALES.join(", ")} ; ${count} namespaces en parité`);
