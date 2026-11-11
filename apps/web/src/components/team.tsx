"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useLocale } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, usePathname, useRouter } from "../i18n/navigation";
import { api } from "../lib/api-client";
import { useForm } from "../lib/use-form";
import { Badge, Button, Notice, SelectField, TextField } from "./ui";

type Role = "owner" | "admin" | "editor" | "reviewer";
export interface Member {
  userId: string;
  email: string;
  role: Role;
}

function ConfirmDialog({ trigger, title, body, confirmLabel, onConfirm, danger, children }: { trigger: ReactNode; title: string; body: string; confirmLabel: string; onConfirm: () => Promise<boolean>; danger?: boolean; children?: ReactNode }) {
  const f = useForm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md bg-paper p-6 text-text shadow-lg">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-text">{body}</Dialog.Description>
          {children ? <div className="mt-4">{children}</div> : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary">{f.t("common.cancel")}</Button>
            </Dialog.Close>
            <Button
              variant={danger ? "danger" : "primary"}
              busy={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await onConfirm();
                setBusy(false);
                if (ok) setOpen(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function TeamPanel({ organizationId, members, myUserId, myRole }: { organizationId: string; members: Member[]; myUserId: string; myRole: Role }) {
  const f = useForm();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [notice, setNotice] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const canManage = myRole === "owner" || myRole === "admin";
  const assignable: Role[] = myRole === "owner" ? ["admin", "editor", "reviewer"] : myRole === "admin" ? ["editor", "reviewer"] : [];
  const manageable = (target: Role) => (myRole === "owner" ? target !== "owner" : myRole === "admin" ? target === "editor" || target === "reviewer" : false);
  const roleLabel = (r: Role) => f.t(`common.team.roles.${r}`);

  async function invite(e: FormEvent) {
    e.preventDefault();
    const r = await f.run({ email }, () => api(`/organizations/${organizationId}/invitations`, { body: { email, role: inviteRole } }));
    if (r) {
      setNotice(f.t("common.team.invited", { email }));
      setEmail("");
    }
  }
  async function act(call: () => ReturnType<typeof api>, message: string): Promise<boolean> {
    const r = await f.run({}, call);
    if (r !== null) {
      setNotice(message);
      router.refresh();
      return true;
    }
    return false;
  }

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Notice tone="success" title={notice} /> : null}
      {f.error ? <Notice tone="error" title={f.error} focusRef={f.summaryRef} /> : null}
      {!canManage ? <Notice tone="info" title={f.t("common.team.noManage")} /> : null}

      <section aria-labelledby="members-heading" className="rounded-md border border-line bg-paper p-4 sm:p-6">
        <h2 id="members-heading" className="mb-4 text-lg font-semibold text-text">{f.t("common.team.members")}</h2>
        <ul className="flex flex-col divide-y divide-line">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="break-all text-text">{m.email}</span>
                {m.userId === myUserId ? <span className="text-sm text-muted">({f.t("common.you")})</span> : null}
                <Badge>{roleLabel(m.role)}</Badge>
              </div>
              {m.userId !== myUserId && manageable(m.role) ? (
                <div className="flex flex-wrap items-end gap-2">
                  <SelectField
                    label={f.t("common.team.changeRoleFor", { email: m.email })}
                    hideLabel
                    value={m.role}
                    options={[m.role, ...assignable.filter((r) => r !== m.role)].map((r) => ({ value: r, label: roleLabel(r) }))}
                    onChange={(e) => act(() => api(`/organizations/${organizationId}/members/${m.userId}`, { method: "PATCH", body: { role: e.target.value } }), f.t("common.team.roleChanged"))}
                  />
                  <ConfirmDialog
                    trigger={<Button variant="secondary">{f.t("common.team.remove")}</Button>}
                    title={f.t("common.team.removeTitle")}
                    body={f.t("common.team.removeBody", { email: m.email })}
                    confirmLabel={f.t("common.team.remove")}
                    danger
                    onConfirm={() => act(() => api(`/organizations/${organizationId}/members/${m.userId}`, { method: "DELETE" }), f.t("common.team.removed"))}
                  />
                  {myRole === "owner" ? (
                    <ConfirmDialog
                      trigger={<Button variant="ghost">{f.t("common.team.transfer")}</Button>}
                      title={f.t("common.team.transferTitle")}
                      body={f.t("common.team.transferBody", { email: m.email })}
                      confirmLabel={f.t("common.team.transfer")}
                      onConfirm={async () => {
                        const re = await f.run({ password }, () => api("/auth/reauthenticate", { body: { password } }));
                        setPassword("");
                        if (re === null) return false;
                        return act(() => api(`/organizations/${organizationId}/transfer`, { body: { newOwnerUserId: m.userId } }), f.t("common.team.transferDone"));
                      }}
                    >
                      <p className="mb-2 text-sm text-muted">{f.t("auth.reauth.lead")}</p>
                      <TextField label={f.t("auth.fields.password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                    </ConfirmDialog>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {canManage ? (
        <section aria-labelledby="invite-heading" className="rounded-md border border-line bg-paper p-4 sm:p-6">
          <h2 id="invite-heading" className="mb-4 text-lg font-semibold text-text">{f.t("common.team.inviteTitle")}</h2>
          <form noValidate onSubmit={invite} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <TextField className="sm:flex-1" label={f.t("auth.fields.email")} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={f.fieldErrors.email} />
            <SelectField label={f.t("common.team.role")} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} options={assignable.map((r) => ({ value: r, label: roleLabel(r) }))} />
            <Button type="submit" busy={f.busy}>{f.t("common.team.invite")}</Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

export function CreateOrganizationForm() {
  const f = useForm();
  const locale = useLocale() as "fr-CA" | "en-CA";
  const router = useRouter();
  const [name, setName] = useState("");
  const [defaultLocale, setDefaultLocale] = useState(locale);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await f.run<{ id: string }>({ name }, () => api("/organizations", { body: { name, defaultLocale } }));
    if (r) {
      document.cookie = `bbn_org=${r.id}; Path=/; SameSite=Lax`;
      router.push("/app");
      router.refresh();
    }
  }
  return (
    <form noValidate onSubmit={submit} className="flex max-w-md flex-col gap-4 rounded-md border border-line bg-paper p-6">
      {f.error ? <Notice tone="error" title={f.error} focusRef={f.summaryRef} /> : null}
      <TextField label={f.t("onboarding.createOrg.name")} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} error={f.fieldErrors.name} />
      <SelectField
        label={f.t("onboarding.createOrg.defaultLocale")}
        value={defaultLocale}
        onChange={(e) => setDefaultLocale(e.target.value as "fr-CA" | "en-CA")}
        options={(["fr-CA", "en-CA"] as const).map((l) => ({ value: l, label: f.t(`onboarding.locales.${l}`) }))}
      />
      <Button type="submit" busy={f.busy}>{f.t("onboarding.createOrg.submit")}</Button>
    </form>
  );
}

/** Préférence non sensible (cookie lisible) ; l'appartenance est revérifiée côté serveur à chaque requête. */
export function OrganizationSwitcher({ organizations, currentId }: { organizations: { id: string; name: string }[]; currentId: string | null }) {
  const f = useForm();
  const router = useRouter();
  if (organizations.length < 2) return null;
  return (
    <SelectField
      label={f.t("common.shell.switchOrganization")}
      value={currentId ?? ""}
      options={organizations.map((o) => ({ value: o.id, label: o.name }))}
      onChange={(e) => {
        document.cookie = `bbn_org=${e.target.value}; Path=/; SameSite=Lax`;
        router.refresh();
      }}
    />
  );
}

/** Change la langue de l'interface en conservant la page courante ; ne traduit aucun contenu. */
export function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const f = useForm();
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === "fr-CA" ? "en-CA" : "fr-CA";
  return (
    <nav aria-label={f.t("common.languageSwitcher.label")}>
      <Link
        href={pathname}
        locale={other}
        hrefLang={other}
        lang={other}
        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border px-3 font-semibold underline-offset-4 hover:underline ${dark ? "border-gold text-paper" : "border-ink text-ink"}`}
      >
        {f.t(`common.languageSwitcher.${other === "fr-CA" ? "fr" : "en"}`)}
      </Link>
    </nav>
  );
}
