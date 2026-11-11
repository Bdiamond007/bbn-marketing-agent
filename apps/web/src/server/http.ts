/**
 * Utilitaires HTTP de l'API /api/v1, indépendants de Next.js (testables directement).
 * Format d'erreur (§11) : { error: { code, messageKey, requestId, details? } }.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ServiceError } from "@bbn/domain";

export interface RequestContext {
  requestId: string;
  ip: string;
}

export function requestContext(req: Request): RequestContext {
  // Derrière l'équilibreur de charge, la première adresse de X-Forwarded-For est celle du client (à configurer en E23).
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { requestId: randomUUID(), ip: xff || "local" };
}

export function json(body: unknown, status: number, ctx: RequestContext, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": ctx.requestId, ...headers },
  });
}

export function errorResponse(e: unknown, ctx: RequestContext): Response {
  if (e instanceof ServiceError) {
    const error: Record<string, unknown> = { code: e.code, messageKey: e.messageKey, requestId: ctx.requestId };
    if (e.details) error.details = e.details;
    return json({ error }, e.status, ctx);
  }
  // Erreur inattendue : aucun détail interne exposé ; journalisée côté serveur avec le requestId.
  console.error(JSON.stringify({ level: "error", msg: "unhandled_api_error", requestId: ctx.requestId, error: e instanceof Error ? e.name : "unknown" }));
  return json({ error: { code: "internal_error", messageKey: "errors.generic", requestId: ctx.requestId } }, 500, ctx);
}

/** Protection CSRF des mutations : origine identique exigée et corps JSON uniquement. */
export function assertSameOrigin(req: Request, appBaseUrl: string): void {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(appBaseUrl).origin) throw new ServiceError("origin_rejected");
  const ct = req.headers.get("content-type") ?? "";
  if (req.method !== "DELETE" && !ct.toLowerCase().startsWith("application/json")) throw new ServiceError("origin_rejected");
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 64 * 1024) throw new Error("too_large");
    raw = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new ServiceError("validation_failed", { reason: "invalid_json" });
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ServiceError("validation_failed", { fields: [...new Set(r.error.issues.map((i) => i.path.join(".")))] });
  return r.data;
}

export function cookieName(appBaseUrl: string): string {
  return appBaseUrl.startsWith("https://") ? "__Host-bbn_session" : "bbn_session";
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(appBaseUrl: string, token: string, expiresAt: Date, now: Date): string {
  const secure = appBaseUrl.startsWith("https://");
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return [`${cookieName(appBaseUrl)}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`, secure ? "Secure" : ""].filter(Boolean).join("; ");
}

export function clearSessionCookie(appBaseUrl: string): string {
  const secure = appBaseUrl.startsWith("https://");
  return [`${cookieName(appBaseUrl)}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", secure ? "Secure" : ""].filter(Boolean).join("; ");
}

export const uuid = z.string().uuid();
export const locale = z.enum(["fr-CA", "en-CA"]);
export const memberRole = z.enum(["owner", "admin", "editor", "reviewer"]);
