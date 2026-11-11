"use client";
import { useLocale } from "next-intl";
import { useState, type FormEvent } from "react";
import type { BrandView } from "@bbn/brands";
import type { BrandDraft, Fact } from "@bbn/domain";
import { useRouter } from "../i18n/navigation";
import { api } from "../lib/api-client";
import { useForm } from "../lib/use-form";
import { Badge, Button, Card, Checkbox, Notice, SelectField, TextArea, TextField } from "./ui";

const SECTORS = ["local_retail", "salon", "restaurant", "home_services", "b2b_consulting", "studio", "creative_services", "other"] as const;
const VOICES = ["warm", "professional", "playful", "expert", "minimal"] as const;
const FACT_KINDS = ["hours", "price", "promotion", "service", "address", "contact", "other"] as const;
/** Fuseaux canadiens proposés ; le serveur accepte tout fuseau IANA valide. */
const CANADA_ZONES = ["America/St_Johns", "America/Halifax", "America/Moncton", "America/Toronto", "America/Winnipeg", "America/Regina", "America/Edmonton", "America/Vancouver", "America/Whitehorse", "America/Yellowknife", "America/Iqaluit"];

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function CreateBrandForm({ organizationId }: { organizationId: string }) {
  const f = useForm();
  const locale = useLocale() as "fr-CA" | "en-CA";
  const router = useRouter();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("America/Toronto");
  const [contentLocale, setContentLocale] = useState(locale);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await f.run({ name }, () => api(`/organizations/${organizationId}/brands`, { body: { name, timezone, defaultContentLocale: contentLocale } }));
    if (r) router.refresh();
  }
  return (
    <form noValidate onSubmit={submit} className="flex max-w-md flex-col gap-4 rounded-md border border-line bg-paper p-6">
      {f.error ? <Notice tone="error" title={f.error} focusRef={f.summaryRef} /> : null}
      <TextField label={f.t("brand.fields.name")} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} error={f.fieldErrors.name} />
      <SelectField label={f.t("brand.fields.contentLocale")} value={contentLocale} onChange={(e) => setContentLocale(e.target.value as "fr-CA" | "en-CA")} options={(["fr-CA", "en-CA"] as const).map((l) => ({ value: l, label: f.t(`onboarding.locales.${l}`) }))} />
      <SelectField label={f.t("brand.fields.timezone")} value={timezone} onChange={(e) => setTimezone(e.target.value)} options={CANADA_ZONES.map((z) => ({ value: z, label: z }))} />
      <Button type="submit" busy={f.busy}>{f.t("brand.create.submit")}</Button>
    </form>
  );
}

export function BrandEditor({ organizationId, brand, canEdit }: { organizationId: string; brand: BrandView; canEdit: boolean }) {
  const f = useForm();
  const router = useRouter();
  const [d, setD] = useState<BrandDraft>(brand.draft);
  const [version, setVersion] = useState(brand.draftVersion);
  const [services, setServices] = useState((brand.draft.services ?? []).join("\n"));
  const [avoid, setAvoid] = useState((brand.draft.tone?.avoid ?? []).join("\n"));
  const [notice, setNotice] = useState<string | null>(null);
  const set = <K extends keyof BrandDraft>(k: K, v: BrandDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const facts = d.facts ?? [];
  const setFact = (i: number, patch: Partial<Fact>) => set("facts", facts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const zones = CANADA_ZONES.includes(d.timezone ?? "") || !d.timezone ? CANADA_ZONES : [d.timezone, ...CANADA_ZONES];

  const payload = (): BrandDraft => {
    const out: BrandDraft = { ...d, services: lines(services), tone: { ...d.tone, avoid: lines(avoid) } };
    for (const k of ["name", "description", "audience", "area"] as const) if (out[k] === "") delete out[k];
    return out;
  };
  async function save(): Promise<number | null> {
    const r = await f.run<{ draftVersion: number }>({}, () => api(`/organizations/${organizationId}/brands/${brand.id}/draft`, { method: "PATCH", body: { draft: payload(), expectedVersion: version } }));
    if (!r) return null;
    setVersion(r.draftVersion);
    return r.draftVersion;
  }
  async function onSave(e: FormEvent) {
    e.preventDefault();
    if ((await save()) !== null) {
      setNotice(f.t("brand.draftSaved"));
      router.refresh();
    }
  }
  async function onPublish() {
    const v = await save();
    if (v === null) return;
    const r = await f.run<{ profileVersion: number }>({}, () => api(`/organizations/${organizationId}/brands/${brand.id}/publish`, { body: { expectedVersion: v } }));
    if (r) {
      setNotice(f.t("brand.published", { version: r.profileVersion }));
      router.refresh();
    }
  }

  return (
    <form noValidate onSubmit={onSave} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={brand.status === "active" ? "success" : "neutral"}>{brand.status === "active" ? f.t("brand.statusActive") : f.t("brand.statusDraft")}</Badge>
        <span className="text-muted">{brand.published ? f.t("brand.publishedVersion", { version: brand.published.version }) : f.t("brand.notPublished")}</span>
      </div>
      {notice ? <Notice tone="success" title={notice} /> : null}
      {f.error ? <Notice tone="error" title={f.error} focusRef={f.summaryRef} /> : null}
      {brand.missing.length > 0 ? (
        <Notice tone="info" title={f.t("brand.missingTitle")}>
          <ul className="list-disc pl-5">{brand.missing.map((m) => <li key={m}>{f.t(`brand.missing.${m}`)}</li>)}</ul>
        </Notice>
      ) : null}
      {brand.factProblems.length > 0 ? <Notice tone="error" title={f.t("brand.factMissingValidity", { facts: brand.factProblems.map((p) => p.factId).join(", ") })} /> : null}

      <fieldset disabled={!canEdit} className="flex flex-col gap-6">
        <Card title={f.t("brand.sections.identity")}>
          <div className="flex flex-col gap-4">
            <TextField label={f.t("brand.fields.name")} value={d.name ?? ""} maxLength={200} onChange={(e) => set("name", e.target.value)} />
            <SelectField label={f.t("brand.fields.sector")} value={d.sector ?? ""} onChange={(e) => set("sector", e.target.value as BrandDraft["sector"])} options={[{ value: "", label: "—" }, ...SECTORS.map((s) => ({ value: s, label: f.t(`brand.sectors.${s}`) }))]} />
            <TextArea label={f.t("brand.fields.description")} hint={f.t("brand.fields.descriptionHint")} maxLength={1000} value={d.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </div>
        </Card>
        <Card title={f.t("brand.sections.audience")}>
          <div className="flex flex-col gap-4">
            <TextArea label={f.t("brand.fields.audience")} maxLength={500} value={d.audience ?? ""} onChange={(e) => set("audience", e.target.value)} />
            <TextField label={f.t("brand.fields.area")} maxLength={300} value={d.area ?? ""} onChange={(e) => set("area", e.target.value)} />
          </div>
        </Card>
        <Card title={f.t("brand.sections.offer")}>
          <TextArea label={f.t("brand.fields.services")} hint={f.t("brand.fields.servicesHint")} value={services} onChange={(e) => setServices(e.target.value)} />
        </Card>
        <Card title={f.t("brand.sections.tone")}>
          <div className="flex flex-col gap-4">
            <SelectField label={f.t("brand.fields.voice")} value={d.tone?.voice ?? ""} onChange={(e) => set("tone", { ...d.tone, voice: (e.target.value || undefined) as NonNullable<BrandDraft["tone"]>["voice"] })} options={[{ value: "", label: "—" }, ...VOICES.map((v) => ({ value: v, label: f.t(`brand.voices.${v}`) }))]} />
            <TextArea label={f.t("brand.fields.avoid")} hint={f.t("brand.fields.avoidHint")} value={avoid} onChange={(e) => setAvoid(e.target.value)} />
          </div>
        </Card>
        <Card title={f.t("brand.sections.settings")}>
          <div className="flex flex-col gap-4">
            <SelectField label={f.t("brand.fields.contentLocale")} value={d.defaultContentLocale ?? ""} onChange={(e) => set("defaultContentLocale", e.target.value as BrandDraft["defaultContentLocale"])} options={(["fr-CA", "en-CA"] as const).map((l) => ({ value: l, label: f.t(`onboarding.locales.${l}`) }))} />
            <p className="-mt-3 text-sm text-muted">{f.t("brand.fields.contentLocaleHint")}</p>
            <SelectField label={f.t("brand.fields.timezone")} value={d.timezone ?? ""} onChange={(e) => set("timezone", e.target.value)} options={zones.map((z) => ({ value: z, label: z }))} />
            <p className="-mt-3 text-sm text-muted">{f.t("brand.fields.timezoneHint")}</p>
          </div>
        </Card>
        <Card title={f.t("brand.facts.title")}>
          <p className="mb-4 text-sm text-muted">{f.t("brand.facts.hint")}</p>
          <ul className="flex flex-col gap-4">
            {facts.map((fact, i) => (
              <li key={fact.id} className="flex flex-col gap-3 rounded-sm border border-line p-3">
                <SelectField label={f.t("brand.facts.kind")} value={fact.kind} onChange={(e) => setFact(i, { kind: e.target.value as Fact["kind"] })} options={FACT_KINDS.map((k) => ({ value: k, label: f.t(`brand.facts.kinds.${k}`) }))} />
                <TextField label={f.t("brand.facts.value")} value={fact.value} maxLength={500} onChange={(e) => setFact(i, { value: e.target.value })} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField label={f.t("brand.facts.validFrom")} type="date" value={fact.validFrom ?? ""} onChange={(e) => setFact(i, { validFrom: e.target.value || null })} />
                  <TextField label={f.t("brand.facts.validUntil")} type="date" value={fact.validUntil ?? ""} onChange={(e) => setFact(i, { validUntil: e.target.value || null })} />
                </div>
                <Checkbox label={f.t("brand.facts.confirmed")} checked={fact.confirmed} onChange={(e) => setFact(i, { confirmed: e.target.checked })} />
                <Button type="button" variant="ghost" onClick={() => set("facts", facts.filter((_, j) => j !== i))}>{f.t("brand.facts.remove")}</Button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="secondary" className="mt-4" onClick={() => set("facts", [...facts, { id: `f-${Date.now().toString(36)}`, kind: "service", value: "", confirmed: false, validFrom: null, validUntil: null }])}>
            {f.t("brand.facts.add")}
          </Button>
        </Card>
        <Card title={f.t("brand.sections.confirmation")}>
          <Checkbox label={f.t("brand.fields.sourceConfirmed")} checked={d.factsSourceConfirmed === true} onChange={(e) => set("factsSourceConfirmed", e.target.checked)} />
        </Card>
      </fieldset>
      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="secondary" busy={f.busy}>{f.t("brand.saveDraft")}</Button>
          <Button type="button" busy={f.busy} onClick={onPublish}>{f.t("brand.publish")}</Button>
        </div>
      ) : null}
    </form>
  );
}
