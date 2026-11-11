"use client";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Link, useRouter } from "../i18n/navigation";
import { api } from "../lib/api-client";
import { useForm } from "../lib/use-form";
import { Button, Notice, TextField } from "./ui";

type Locale = "fr-CA" | "en-CA";

function FormShell({ title, children, onSubmit, footer }: { title: string; children: React.ReactNode; onSubmit: (e: FormEvent) => void; footer?: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="mb-6 text-2xl font-bold text-text">{title}</h1>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 rounded-md border border-line bg-paper p-6">
        {children}
      </form>
      {footer ? <div className="mt-4 flex flex-col gap-2 text-sm text-text">{footer}</div> : null}
    </div>
  );
}

function ErrorSummary({ f }: { f: ReturnType<typeof useForm> }) {
  return f.error ? <Notice tone="error" title={f.error} focusRef={f.summaryRef} /> : null;
}

export function SignUpForm() {
  const f = useForm();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await f.run({ email, password }, () => api("/auth/sign-up", { body: { email, password, uiLocale: locale } }));
    if (r) router.push({ pathname: "/verify-email", query: { email, created: "1" } });
  }
  return (
    <FormShell
      title={f.t("auth.signUp")}
      onSubmit={submit}
      footer={
        <p>
          {f.t("auth.links.haveAccount")} <Link href="/sign-in" className="font-semibold underline">{f.t("auth.links.backToSignIn")}</Link>
        </p>
      }
    >
      <ErrorSummary f={f} />
      <TextField label={f.t("auth.fields.email")} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={f.fieldErrors.email} />
      <TextField label={f.t("auth.fields.password")} hint={f.t("auth.fields.passwordHint")} type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} error={f.fieldErrors.password} />
      <Button type="submit" busy={f.busy}>{f.t("auth.actions.signUp")}</Button>
    </FormShell>
  );
}

export function VerifyEmailForm() {
  const f = useForm();
  const params = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await f.run({ email, code }, () => api("/auth/verify-email", { body: { email, code: code.trim() } }));
    if (r) router.push({ pathname: "/sign-in", query: { verified: "1", email } });
  }
  return (
    <FormShell title={f.t("auth.verifyEmail")} onSubmit={submit}>
      {params.get("created") ? <Notice tone="success" title={f.t("auth.messages.signUpDone")} /> : null}
      <ErrorSummary f={f} />
      <TextField label={f.t("auth.fields.email")} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={f.fieldErrors.email} />
      <TextField label={f.t("auth.fields.code")} hint={f.t("auth.fields.codeHint")} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} error={f.fieldErrors.code} />
      <Button type="submit" busy={f.busy}>{f.t("auth.actions.verify")}</Button>
    </FormShell>
  );
}

export function SignInForm() {
  const f = useForm();
  const params = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await f.run<{ mfaRequired: boolean }>({ email, password }, () => api("/auth/sign-in", { body: { email, password } }));
    if (r) {
      router.push(r.mfaRequired ? "/mfa" : "/app");
      router.refresh();
    }
  }
  return (
    <FormShell
      title={f.t("auth.signIn")}
      onSubmit={submit}
      footer={
        <>
          <p>
            {f.t("auth.links.noAccount")} <Link href="/sign-up" className="font-semibold underline">{f.t("auth.links.createAccount")}</Link>
          </p>
          <p>
            <Link href="/recovery" className="font-semibold underline">{f.t("auth.links.forgotPassword")}</Link>
          </p>
        </>
      }
    >
      {params.get("verified") ? <Notice tone="success" title={f.t("auth.messages.verified")} /> : null}
      {params.get("recovered") ? <Notice tone="success" title={f.t("auth.messages.recoveryDone")} /> : null}
      <ErrorSummary f={f} />
      <TextField label={f.t("auth.fields.email")} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={f.fieldErrors.email} />
      <TextField label={f.t("auth.fields.password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={f.fieldErrors.password} />
      <Button type="submit" busy={f.busy}>{f.t("auth.actions.signIn")}</Button>
    </FormShell>
  );
}

export function RecoveryForm() {
  const f = useForm();
  const locale = useLocale() as Locale;
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await f.run({ email }, () => api("/auth/recovery", { body: { email, uiLocale: locale } }));
    if (r) setSent(true);
  }
  return (
    <FormShell
      title={f.t("auth.recovery")}
      onSubmit={submit}
      footer={
        <p>
          <Link href={{ pathname: "/recovery/complete", query: email ? { email } : {} }} className="font-semibold underline">{f.t("auth.links.haveCode")}</Link>
        </p>
      }
    >
      {sent ? <Notice tone="success" title={f.t("auth.messages.recoverySent")} /> : null}
      <ErrorSummary f={f} />
      <TextField label={f.t("auth.fields.email")} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={f.fieldErrors.email} />
      <Button type="submit" busy={f.busy}>{f.t("auth.actions.sendCode")}</Button>
    </FormShell>
  );
}

export function RecoveryCompleteForm() {
  const f = useForm();
  const params = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await f.run({ email, code, newPassword }, () => api("/auth/recovery/complete", { body: { email, code: code.trim(), newPassword } }));
    if (r) router.push({ pathname: "/sign-in", query: { recovered: "1", email } });
  }
  return (
    <FormShell title={f.t("auth.recoveryComplete")} onSubmit={submit}>
      <ErrorSummary f={f} />
      <TextField label={f.t("auth.fields.email")} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={f.fieldErrors.email} />
      <TextField label={f.t("auth.fields.code")} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} error={f.fieldErrors.code} />
      <TextField label={f.t("auth.fields.newPassword")} hint={f.t("auth.fields.passwordHint")} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} error={f.fieldErrors.newPassword} />
      <Button type="submit" busy={f.busy}>{f.t("auth.actions.resetPassword")}</Button>
    </FormShell>
  );
}

export function MfaForm() {
  const f = useForm();
  const router = useRouter();
  const [code, setCode] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await f.run({ code }, () => api("/auth/mfa", { body: { code: code.trim() } }));
    if (r) {
      router.push("/app");
      router.refresh();
    }
  }
  return (
    <FormShell title={f.t("auth.mfa.title")} onSubmit={submit}>
      <p className="text-text">{f.t("auth.mfa.lead")}</p>
      <ErrorSummary f={f} />
      <TextField label={f.t("auth.fields.code")} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} error={f.fieldErrors.code} />
      <Button type="submit" busy={f.busy}>{f.t("auth.actions.verifyMfa")}</Button>
    </FormShell>
  );
}

export function SignOutButton() {
  const f = useForm();
  const router = useRouter();
  async function out() {
    await api("/auth/sign-out", { body: {} });
    router.push("/sign-in");
    router.refresh();
  }
  return (
    <Button variant="secondary" onClick={out} busy={f.busy}>
      {f.t("auth.actions.signOut")}
    </Button>
  );
}

export function AcceptInvitation({ token }: { token: string | null }) {
  const f = useForm();
  const router = useRouter();
  const [done, setDone] = useState(false);
  if (!token) return <Notice tone="error" title={f.t("auth.invitation.missingToken")} />;
  async function accept() {
    const r = await f.run<{ organizationId: string }>({}, () => api("/invitations/accept", { body: { token } }));
    if (r) {
      document.cookie = `bbn_org=${r.organizationId}; Path=/; SameSite=Lax`;
      setDone(true);
      router.refresh();
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <ErrorSummary f={f} />
      {done ? (
        <>
          <Notice tone="success" title={f.t("auth.invitation.accepted")} />
          <Link href="/app" className="font-semibold underline">{f.t("common.nav.home")}</Link>
        </>
      ) : (
        <Button onClick={accept} busy={f.busy}>{f.t("auth.invitation.accept")}</Button>
      )}
    </div>
  );
}
