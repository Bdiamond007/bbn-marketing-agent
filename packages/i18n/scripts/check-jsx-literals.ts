/**
 * Refuse toute chaîne visible codée en dur dans les composants (SPECIFICATION §7) :
 * texte JSX contenant une lettre, ou attribut textuel visible/accessible (aria-label, title, alt, placeholder…) littéral.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOTS = ["apps/web/src"];
const TEXT_ATTRS = new Set(["aria-label", "aria-description", "title", "alt", "placeholder", "label"]);
const LETTER = /\p{L}/u;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

export function findLiterals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && LETTER.test(n.text)) out.push(`${at(n)} texte « ${n.text.trim().slice(0, 40)} »`);
    if (ts.isJsxAttribute(n) && TEXT_ATTRS.has(n.name.getText(sf)) && n.initializer && ts.isStringLiteral(n.initializer) && LETTER.test(n.initializer.text)) {
      out.push(`${at(n)} attribut ${n.name.getText(sf)}="${n.initializer.text.slice(0, 40)}"`);
    }
    if (ts.isJsxExpression(n) && n.expression && ts.isStringLiteral(n.expression) && LETTER.test(n.expression.text) && ts.isJsxElement(n.parent)) {
      out.push(`${at(n)} expression « ${n.expression.text.slice(0, 40)} »`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

if (process.argv[1]?.endsWith("check-jsx-literals.ts")) {
  const problems = ROOTS.flatMap((r) => walk(r)).flatMap((f) => findLiterals(relative(process.cwd(), f), readFileSync(f, "utf8")));
  if (problems.length > 0) {
    console.error(`jsx-literals ÉCHEC (${problems.length})\n${problems.map((p) => ` - ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`jsx-literals OK — aucune chaîne visible codée en dur dans ${ROOTS.join(", ")}`);
}
