import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDbEnv } from "../../../packages/db/src/env";

export const E2E_DB = "bbn_test_e2e";
export const MAILBOX = process.env.E2E_MAILBOX ?? join(tmpdir(), `bbn-e2e-mailbox-${process.env.E2E_PORT ?? 3100}.jsonl`);
export const e2eDatabaseUrl = () => localDbEnv(process.env, E2E_DB).appUrl;

/** Dernier courriel simulé adressé à `to` (lecture de la boîte fichier du serveur). */
export function lastMail(to: string, template?: string): { subject: string; text: string; locale: string } {
  const lines = readFileSync(MAILBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string; locale: string; template: string });
  const m = lines.filter((l) => l.to === to.toLowerCase() && (template === undefined || l.template === template)).at(-1);
  if (!m) throw new Error(`aucun courriel simulé pour ${to}`);
  return m;
}
