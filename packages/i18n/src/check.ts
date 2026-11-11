/** Vérification de parité des catalogues (clés, placeholders ICU, valeurs vides). */
export interface CatalogIssue {
  namespace: string;
  key: string;
  problem: string;
}

type Tree = { [k: string]: string | Tree };

export function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else if (v && typeof v === "object") for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
    else out.set(key, "");
  }
  return out;
}

/** Noms d'arguments ICU de premier niveau : {name}, {count, plural, ...}. */
export function placeholders(message: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    const c = message[i];
    if (c === "{") {
      if (depth === 0) {
        const m = /^\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(,|\})/.exec(message.slice(i));
        if (m) names.add(m[1]!);
      }
      depth++;
    } else if (c === "}") depth = Math.max(0, depth - 1);
  }
  return [...names].sort();
}

export function checkCatalogs(catalogs: Record<string, Record<string, Tree>>, reference: string): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const ref = catalogs[reference];
  if (!ref) return [{ namespace: "*", key: "*", problem: `locale de référence absente : ${reference}` }];
  const namespaces = new Set(Object.values(catalogs).flatMap((c) => Object.keys(c)));
  for (const ns of namespaces) {
    const flat = Object.fromEntries(Object.entries(catalogs).map(([loc, c]) => [loc, c[ns] ? flatten(c[ns]) : null]));
    const allKeys = new Set(Object.values(flat).flatMap((m) => (m ? [...m.keys()] : [])));
    for (const [loc, m] of Object.entries(flat)) {
      if (!m) {
        issues.push({ namespace: ns, key: "*", problem: `namespace absent pour ${loc}` });
        continue;
      }
      for (const key of allKeys) {
        const v = m.get(key);
        if (v === undefined) issues.push({ namespace: ns, key, problem: `clé absente pour ${loc}` });
        else if (v.trim() === "") issues.push({ namespace: ns, key, problem: `valeur vide pour ${loc}` });
      }
    }
    const refFlat = flat[reference];
    if (!refFlat) continue;
    for (const [key, refValue] of refFlat) {
      const expected = placeholders(refValue).join(",");
      for (const [loc, m] of Object.entries(flat)) {
        const v = m?.get(key);
        if (loc === reference || v === undefined) continue;
        const got = placeholders(v).join(",");
        if (got !== expected) issues.push({ namespace: ns, key, problem: `placeholders différents pour ${loc} : [${got}] ≠ [${expected}]` });
      }
    }
  }
  return issues;
}
