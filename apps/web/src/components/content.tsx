"use client";
import * as Tabs from "@radix-ui/react-tabs";
import { useFormatter } from "next-intl";
import { useState, type FormEvent } from "react";
import type { ItemView, RevisionView, VariantView } from "@bbn/content";
import { Link, useRouter } from "../i18n/navigation";
import { api } from "../lib/api-client";
import { useForm } from "../lib/use-form";
import { Badge, Button, Card, Checkbox, Notice, SelectField, TextArea, TextField } from "./ui";

type State = VariantView["status"];
const PROVIDERS = ["facebook_page", "instagram_business", "linkedin_page"] as const;
const LOCALES = ["fr-CA", "en-CA"] as const;

export interface ReadyMedia {
  id: string;
  url: string;
}
export interface CommentView {
  id: string;
  body: string;
  authorEmail: string | null;
  revisionId: string | null;
  createdAt: string;
}

export function StateBadge({ state }: { state: State }) {
  const f = useForm();
  return <Badge tone={state === "approved" ? "success" : state === "changes_requested" ? "error" : "neutral"}>{f.t(`content.states.${state}`)}</Badge>;
}

export function NewContentForm({ organizationId, brandId }: { organizationId: string; brandId: string }) {
  const f = useForm();
  const router = useRouter();
  const [topic, setTopic] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await f.run<{ itemId: string }>({ topic }, () => api(`/organizations/${organizationId}/brands/${brandId}/content-items`, { body: { topic } }));
    if (r) router.push(`/app/content/${r.itemId}`);
  }
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
      {f.error ? <Notice tone="error" title={f.error} focusRef={f.summaryRef} /> : null}
      <TextField className="sm:flex-1" label={f.t("content.new.topic")} hint={f.t("content.new.topicHint")} maxLength={500} value={topic} onChange={(e) => setTopic(e.target.value)} error={f.fieldErrors.topic} />
      <Button type="submit" busy={f.busy}>{f.t("content.new.submit")}</Button>
    </form>
  );
}

function VariantEditor({ organizationId, itemId, variant, media, history, canEdit }: { organizationId: string; itemId: string; variant: VariantView; media: ReadyMedia[]; history: RevisionView[]; canEdit: boolean }) {
  const f = useForm();
  const format = useFormatter();
  const router = useRouter();
  const [caption, setCaption] = useState(variant.current?.caption ?? "");
  const [selected, setSelected] = useState<string[]>(variant.current?.media.map((m) => m.mediaAssetId) ?? []);
  const [notice, setNotice] = useState<string | null>(null);
  const providerLabel = f.t(`content.providers.${variant.provider}`);
  const localeLabel = f.t(`content.locales.${variant.locale}`);
  const mediaById = new Map(media.map((m) => [m.id, m]));

  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await f.run<{ number: number }>({ caption }, () => api(`/organizations/${organizationId}/variants/${variant.id}/revisions`, { body: { caption, mediaAssetIds: selected, expectedVersion: variant.version } }));
    if (r) {
      setNotice(f.t("content.editor.saved", { number: r.number }));
      router.refresh();
    }
  }
  async function event(ev: "submit" | "archive" | "restore") {
    const r = await f.run({}, () => api(`/organizations/${organizationId}/variants/${variant.id}/events`, { body: { event: ev, expectedVersion: variant.version } }));
    if (r) {
      setNotice(f.t("content.editor.submitted"));
      router.refresh();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={variant.status} />
          <span className="text-sm text-muted">{variant.current ? f.t("content.editor.current", { number: variant.current.number }) : f.t("content.editor.noRevision")}</span>
        </div>
        <p className="text-sm text-muted">{f.t("content.editor.destination", { provider: providerLabel, locale: localeLabel })}</p>
        {notice ? <Notice tone="success" title={notice} /> : null}
        {f.error ? <Notice tone="error" title={f.error} focusRef={f.summaryRef} /> : null}
        <form noValidate onSubmit={save} className="flex flex-col gap-4">
          <fieldset disabled={!canEdit || variant.status === "archived" || variant.status === "generating"} className="flex flex-col gap-4">
            <TextArea label={f.t("content.editor.caption")} hint={f.t("content.editor.captionCount", { count: caption.length })} rows={8} maxLength={5000} lang={variant.locale} value={caption} onChange={(e) => setCaption(e.target.value)} error={f.fieldErrors.caption} />
            <fieldset className="flex flex-col gap-2">
              <legend className="font-semibold">{f.t("content.editor.media")}</legend>
              {media.length === 0 ? <p className="text-sm text-muted">{f.t("content.editor.noMedia")}</p> : null}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((m, i) => (
                  <div key={m.id} className="flex flex-col gap-1 rounded-sm border border-line p-2">
                    <img src={m.url} alt={f.t("content.editor.mediaAlt", { number: i + 1 })} className="aspect-square w-full rounded-sm object-cover" />
                    <Checkbox label={f.t("content.editor.mediaAlt", { number: i + 1 })} checked={selected.includes(m.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, m.id] : s.filter((x) => x !== m.id)))} />
                  </div>
                ))}
              </div>
            </fieldset>
          </fieldset>
          {canEdit ? (
            <div className="flex flex-wrap gap-3">
              {variant.status !== "archived" ? <Button type="submit" busy={f.busy}>{f.t("content.editor.save")}</Button> : null}
              {variant.status === "draft" || variant.status === "changes_requested" ? <Button type="button" variant="secondary" busy={f.busy} onClick={() => event("submit")}>{f.t("content.editor.submit")}</Button> : null}
              {variant.status === "archived" ? <Button type="button" variant="secondary" onClick={() => event("restore")}>{f.t("content.editor.restore")}</Button> : <Button type="button" variant="ghost" onClick={() => event("archive")}>{f.t("content.editor.archive")}</Button>}
            </div>
          ) : null}
        </form>
        <section aria-labelledby={`history-${variant.id}`} className="flex flex-col gap-2">
          <h3 id={`history-${variant.id}`} className="font-semibold">{f.t("content.history.title")}</h3>
          <ol className="flex flex-col gap-2">
            {history.map((r) => (
              <li key={r.id} className="rounded-sm border border-line p-3 text-sm">
                <p className="font-semibold">
                  {f.t("content.history.entry", { number: r.number })} · {f.t(`content.history.origin.${r.origin}`)} · <time dateTime={r.createdAt}>{format.dateTime(new Date(r.createdAt), { dateStyle: "medium", timeStyle: "short" })}</time>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words" lang={variant.locale}>{r.caption}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <aside aria-labelledby={`preview-${variant.id}`} className="flex flex-col gap-2">
        <h3 id={`preview-${variant.id}`} className="font-semibold">{f.t("content.editor.previewTitle")}</h3>
        <div className="rounded-md border border-line bg-paper p-4">
          <p className="mb-2 text-sm font-semibold text-muted">{providerLabel}</p>
          {selected[0] && mediaById.get(selected[0]) ? <img src={mediaById.get(selected[0])!.url} alt={f.t("content.editor.mediaAlt", { number: 1 })} className="mb-3 w-full rounded-sm" /> : null}
          <p className="whitespace-pre-wrap break-words" lang={variant.locale}>{caption}</p>
        </div>
        <p className="text-sm text-muted">{f.t("content.editor.previewNote")}</p>
      </aside>
    </div>
  );
}

export function ContentEditor({ organizationId, item, media, histories, comments, canEdit, canComment }: { organizationId: string; item: ItemView; media: ReadyMedia[]; histories: Record<string, RevisionView[]>; comments: CommentView[]; canEdit: boolean; canComment: boolean }) {
  const f = useForm();
  const router = useRouter();
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>("facebook_page");
  const [locale, setLocale] = useState<(typeof LOCALES)[number]>("fr-CA");
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const tabLabel = (v: VariantView) => f.t("content.variantTab", { provider: f.t(`content.providers.${v.provider}`), locale: f.t(`content.locales.${v.locale}`) });

  async function addVariant(e: FormEvent) {
    e.preventDefault();
    const r = await f.run({}, () => api(`/organizations/${organizationId}/content-items/${item.id}/variants`, { body: { provider, locale } }));
    if (r) router.refresh();
  }
  async function addComment(e: FormEvent) {
    e.preventDefault();
    const r = await f.run({ body: comment }, () => api(`/organizations/${organizationId}/content-items/${item.id}/comments`, { body: { body: comment } }));
    if (r) {
      setComment("");
      setNotice(f.t("content.comments.added"));
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold break-words">{item.topic}</h1>
        <StateBadge state={item.summaryStatus} />
      </div>
      {notice ? <Notice tone="success" title={notice} /> : null}
      {f.error ? <Notice tone="error" title={f.error} focusRef={f.summaryRef} /> : null}
      {item.variants.length > 0 ? (
        <Tabs.Root defaultValue={item.variants[0]!.id} className="flex flex-col gap-4">
          <Tabs.List aria-label={f.t("content.variantsLabel")} className="flex flex-wrap gap-2 border-b border-line">
            {item.variants.map((v) => (
              <Tabs.Trigger key={v.id} value={v.id} className="min-h-11 rounded-t-sm px-3 text-ink data-[state=active]:border-b-4 data-[state=active]:border-gold-dark data-[state=active]:font-semibold">
                {tabLabel(v)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {item.variants.map((v) => (
            <Tabs.Content key={v.id} value={v.id}>
              <VariantEditor organizationId={organizationId} itemId={item.id} variant={v} media={media} history={histories[v.id] ?? []} canEdit={canEdit} />
            </Tabs.Content>
          ))}
        </Tabs.Root>
      ) : null}
      {canEdit ? (
        <Card title={f.t("content.addVariant.title")}>
          <form noValidate onSubmit={addVariant} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <SelectField label={f.t("content.addVariant.provider")} value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} options={PROVIDERS.map((p) => ({ value: p, label: f.t(`content.providers.${p}`) }))} />
            <SelectField label={f.t("content.addVariant.locale")} value={locale} onChange={(e) => setLocale(e.target.value as typeof locale)} options={LOCALES.map((l) => ({ value: l, label: f.t(`content.locales.${l}`) }))} />
            <Button type="submit" variant="secondary" busy={f.busy}>{f.t("content.addVariant.submit")}</Button>
          </form>
        </Card>
      ) : null}
      <Card title={f.t("content.comments.title")}>
        {comments.length === 0 ? <p className="text-muted">{f.t("content.comments.empty")}</p> : null}
        <ul className="mb-4 flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-sm border border-line p-3 text-sm">
              <p className="font-semibold">{c.authorEmail ?? f.t("content.comments.unknownAuthor")}</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
        </ul>
        {canComment ? (
          <form noValidate onSubmit={addComment} className="flex flex-col gap-3">
            <TextArea label={f.t("content.comments.body")} maxLength={5000} value={comment} onChange={(e) => setComment(e.target.value)} error={f.fieldErrors.body} />
            <Button type="submit" variant="secondary" busy={f.busy}>{f.t("content.comments.submit")}</Button>
          </form>
        ) : null}
      </Card>
      <Link href="/app/content" className="font-semibold underline">{f.t("content.title")}</Link>
    </div>
  );
}
