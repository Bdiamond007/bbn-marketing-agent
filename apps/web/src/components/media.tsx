"use client";
import { useState, type FormEvent } from "react";
import type { MediaItem } from "@bbn/media";
import { useRouter } from "../i18n/navigation";
import { api } from "../lib/api-client";
import { useForm } from "../lib/use-form";
import { Badge, Button, Card, Checkbox, Notice, SelectField } from "./ui";

const REASONS = ["empty", "too_large", "malware", "unsupported_type", "mime_mismatch", "too_many_pixels", "corrupt", "scanner_unavailable", "abandoned_upload"] as const;
const isReason = (r: string | null): r is (typeof REASONS)[number] => !!r && (REASONS as readonly string[]).includes(r);

export function MediaManager({ organizationId, brandId, items, urls, canUpload }: { organizationId: string; brandId: string | null; items: MediaItem[]; urls: Record<string, string>; canUpload: boolean }) {
  const f = useForm();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState<"declared_owned" | "declared_licensed">("declared_owned");
  const [usage, setUsage] = useState<"photo" | "logo">("photo");
  const [declared, setDeclared] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    if (!file) return f.fail(f.t("brand.media.upload.fileRequired"), { file: f.t("brand.media.upload.fileRequired") });
    if (!declared) return f.fail(f.t("brand.media.upload.declareRequired"));
    const created = await f.run<{ assetId: string; uploadUrl: string }>({}, () => api(`/organizations/${organizationId}/media/uploads`, { body: { contentType: file.type, bytes: file.size } }));
    if (!created) return;
    const put = await fetch(created.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file }).catch(() => null);
    if (!put || !put.ok) return f.fail(f.t("errors.reasons.upload_missing"));
    const done = await f.run<MediaItem>({}, () =>
      api(`/organizations/${organizationId}/media/${created.assetId}/complete`, { body: { rightsStatus: rights, ...(brandId ? { brandId, usageRole: usage } : {}) } }),
    );
    if (!done) return;
    setNotice(
      done.status === "ready"
        ? { tone: "success", text: f.t("brand.media.upload.done") }
        : { tone: "error", text: f.t("brand.media.upload.rejected", { reason: isReason(done.rejectedReason) ? f.t(`brand.media.reasons.${done.rejectedReason}`) : "—" }) },
    );
    setFile(null);
    setDeclared(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Notice tone={notice.tone} title={notice.text} /> : null}
      {f.error ? <Notice tone="error" title={f.error} focusRef={f.summaryRef} /> : null}
      {canUpload ? (
        <Card title={f.t("brand.media.upload.title")}>
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="media-file" className="font-semibold">{f.t("brand.media.upload.file")}</label>
              <p id="media-file-hint" className="text-sm text-muted">{f.t("brand.media.upload.fileHint")}</p>
              <input
                id="media-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-describedby="media-file-hint"
                aria-invalid={f.fieldErrors.file ? true : undefined}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="min-h-11 rounded-sm border border-muted bg-paper p-2"
              />
            </div>
            <SelectField label={f.t("brand.media.upload.rights")} value={rights} onChange={(e) => setRights(e.target.value as typeof rights)} options={[{ value: "declared_owned", label: f.t("brand.media.upload.rightsOwned") }, { value: "declared_licensed", label: f.t("brand.media.upload.rightsLicensed") }]} />
            {brandId ? <SelectField label={f.t("brand.media.upload.usage")} value={usage} onChange={(e) => setUsage(e.target.value as typeof usage)} options={[{ value: "photo", label: f.t("brand.media.upload.usagePhoto") }, { value: "logo", label: f.t("brand.media.upload.usageLogo") }]} /> : null}
            <Checkbox label={f.t("brand.media.upload.declare")} checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
            <Button type="submit" busy={f.busy}>{f.t("brand.media.upload.submit")}</Button>
          </form>
        </Card>
      ) : null}
      <section aria-labelledby="library-heading" className="flex flex-col gap-4">
        <h2 id="library-heading" className="text-lg font-semibold">{f.t("brand.media.list")}</h2>
        {items.length === 0 ? (
          <p className="text-muted">{f.t("brand.media.empty")}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((m, i) => (
              <li key={m.id} className="flex flex-col gap-2 rounded-md border border-line bg-paper p-3">
                {urls[m.id] ? (
                  <img src={urls[m.id]} alt={f.t("brand.media.imageAlt", { number: items.length - i })} className="aspect-square w-full rounded-sm object-cover" />
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={m.status === "ready" ? "success" : m.status === "rejected" ? "error" : "neutral"}>{f.t(`brand.media.status.${m.status}`)}</Badge>
                  {m.usageRoles.map((r) => <Badge key={r}>{r === "logo" ? f.t("brand.media.upload.usageLogo") : f.t("brand.media.upload.usagePhoto")}</Badge>)}
                </div>
                {m.width && m.height ? <p className="text-sm text-muted">{f.t("brand.media.dimensions", { width: m.width, height: m.height })}</p> : null}
                {m.status === "rejected" && isReason(m.rejectedReason) ? <p className="text-sm text-danger">{f.t(`brand.media.reasons.${m.rejectedReason}`)}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
