/**
 * Post-traitement du schéma introspecté : on retire foreignKey/pgPolicy/check.
 * Raison : drizzle-kit 0.31 réordonne mal les colonnes des FK composites et crée un cycle de types
 * (content_variants ↔ revisions). Ces contraintes vivent dans le SQL versionné et sont testées en base
 * réelle (packages/db/src/*.db.test.ts) ; le schéma Drizzle ne sert qu'au typage des requêtes.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: postprocess-schema <in> <out>");
const src = readFileSync(input, "utf8");

function stripCalls(text: string, fn: string): string {
  let out = "";
  let i = 0;
  const needle = `${fn}(`;
  while (i < text.length) {
    const j = text.indexOf(needle, i);
    if (j < 0) {
      out += text.slice(i);
      break;
    }
    // début de ligne de l'appel
    const lineStart = text.lastIndexOf("\n", j) + 1;
    if (text.slice(lineStart, j).trim() !== "") {
      out += text.slice(i, j + needle.length);
      i = j + needle.length;
      continue;
    }
    out += text.slice(i, lineStart);
    let depth = 0;
    let k = j + fn.length;
    let inStr: string | null = null;
    for (; k < text.length; k++) {
      const c = text[k];
      if (inStr) {
        if (c === "\\") k++;
        else if (c === inStr) inStr = null;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") inStr = c;
      else if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    // consommer les chaînages éventuels (.onDelete("cascade")) puis la virgule et la fin de ligne
    let rest = k + 1;
    const chain = /^(\.[a-zA-Z]+\([^)]*\))*,?[ \t]*\r?\n?/.exec(text.slice(rest));
    rest += chain ? chain[0].length : 0;
    i = rest;
  }
  return out;
}

let s = src;
for (const fn of ["foreignKey", "pgPolicy", "check"]) s = stripCalls(s, fn);
s = s.replace(/import \{([^}]*)\} from "drizzle-orm\/pg-core"/, (_m, names: string) => {
  const keep = names
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n && !["foreignKey", "pgPolicy", "check", "type AnyPgColumn"].includes(n) && new RegExp(`\\b${n.replace("type ", "")}\\(`).test(s));
  return `import { ${keep.join(", ")} } from "drizzle-orm/pg-core"`;
});
if (!/\bsql`/.test(s.replace(/^import .*$/gm, ""))) s = s.replace(/^import \{ sql \} from "drizzle-orm"\n/m, "");
s = s.replace(/\(table\) => \[\s*\]\)/g, ")");
// Littéral 2^63-1 non représentable en JS ; c'est de toute façon la valeur par défaut.
s = s.replace(/, maxValue: 9223372036854775807/g, "");
writeFileSync(output, `// GÉNÉRÉ par scripts/introspect.sh (drizzle-kit pull + postprocess-schema) — ne pas éditer à la main.\n${s}`);
