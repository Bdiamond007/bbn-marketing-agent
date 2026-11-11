/** Expurgation des secrets avant journalisation ou envoi à Sentry (§13). */
const SENSITIVE_KEY = /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|signature|session|credential|code_verifier|refresh)/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const LONG_TOKEN = /\b(?:(?:sk|pk|rk|whsec)_[A-Za-z0-9_]{16,}|EAA[A-Za-z0-9]{20,})\b/g;

export const REDACTED = "[REDACTED]";

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return value.replace(BEARER, `$1 ${REDACTED}`).replace(LONG_TOKEN, REDACTED);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    return out;
  }
  return value;
}
