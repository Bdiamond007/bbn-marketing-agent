"use client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { ApiResult } from "./api-client";

/**
 * Gestion commune des formulaires : soumission, erreurs par champ et résumé d'erreur focalisé
 * (le focus est déplacé sur le résumé pour les lecteurs d'écran et le clavier).
 */
export function useForm() {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const summaryRef = useRef<HTMLDivElement>(null);

  function fail(message: string, fields: Record<string, string> = {}) {
    setError(message);
    setFieldErrors(fields);
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  async function run<T>(required: Record<string, string>, call: () => Promise<ApiResult<T>>): Promise<T | null> {
    const missing = Object.fromEntries(Object.entries(required).filter(([, v]) => v.trim() === "").map(([k]) => [k, t("auth.messages.required")]));
    if (Object.keys(missing).length > 0) {
      fail(t("auth.messages.errorSummary"), missing);
      return null;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const r = await call();
      if (r.ok) return r.data;
      const message = r.messageKey === "errors.generic" ? t("errors.generic", { requestId: r.requestId ?? "—" }) : t(r.messageKey as never);
      fail(message, Object.fromEntries(r.fields.map((f) => [f, t("errors.codes.validation_failed")])));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, fieldErrors, summaryRef, run, fail, t };
}
