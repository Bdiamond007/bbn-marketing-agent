/**
 * Inspection et réencodage d'une image en quarantaine (MEDIA-01, §13).
 * - Type réel déterminé par décodage (pas par l'extension ni le type déclaré) ; seuls JPEG, PNG, WebP.
 * - Limites : 20 Mo, 40 mégapixels, 12 000 px par côté (protection contre les bombes de décompression).
 * - Réencodage systématique : orientation appliquée, métadonnées (EXIF, GPS, XMP, ICC non nécessaires) supprimées.
 */
import sharp from "sharp";
import type { MalwareScanner } from "@bbn/integrations";

export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const MAX_SIDE = 12_000;
export const ALLOWED_TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
export type AllowedMime = (typeof ALLOWED_TYPES)[keyof typeof ALLOWED_TYPES];
export const isAllowedMime = (m: string): m is AllowedMime => (Object.values(ALLOWED_TYPES) as string[]).includes(m);

export type RejectionReason = "empty" | "too_large" | "malware" | "unsupported_type" | "mime_mismatch" | "too_many_pixels" | "corrupt" | "scanner_unavailable";

export type InspectionResult =
  | { ok: true; mime: AllowedMime; ext: "jpg" | "png" | "webp"; width: number; height: number; output: Buffer }
  | { ok: false; reason: RejectionReason };

export async function inspectAndReencode(input: Uint8Array, declaredMime: string, scanner: MalwareScanner): Promise<InspectionResult> {
  if (input.byteLength === 0) return { ok: false, reason: "empty" };
  if (input.byteLength > MAX_BYTES) return { ok: false, reason: "too_large" };
  try {
    const scan = await scanner.scan(input);
    if (!scan.clean) return { ok: false, reason: "malware" };
  } catch {
    return { ok: false, reason: "scanner_unavailable" };
  }
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
  } catch (e) {
    return { ok: false, reason: /pixel limit/i.test(String((e as Error).message)) ? "too_many_pixels" : "corrupt" };
  }
  const format = meta.format as string | undefined;
  if (format !== "jpeg" && format !== "png" && format !== "webp") return { ok: false, reason: "unsupported_type" };
  const mime = ALLOWED_TYPES[format];
  if (mime !== declaredMime) return { ok: false, reason: "mime_mismatch" };
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return { ok: false, reason: "corrupt" };
  if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) return { ok: false, reason: "too_many_pixels" };
  try {
    const pipeline = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" }).rotate(); // sans withMetadata : métadonnées supprimées
    const out =
      format === "jpeg" ? await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true })
      : format === "png" ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await pipeline.webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    if (out.data.byteLength > MAX_BYTES) return { ok: false, reason: "too_large" };
    return { ok: true, mime, ext: format === "jpeg" ? "jpg" : format, width: out.info.width, height: out.info.height, output: out.data };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}
