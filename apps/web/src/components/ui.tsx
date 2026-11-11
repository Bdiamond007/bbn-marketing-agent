/**
 * Composants accessibles du design system. Aucun texte en dur : tout libellé vient des appelants (traduits).
 * Statuts jamais communiqués par la seule couleur : un libellé textuel est toujours présent.
 */
import clsx from "clsx";
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }>(function Button(
  { variant = "primary", busy = false, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx(
        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-sm px-4 py-2 font-semibold transition-colors disabled:cursor-not-allowed",
        variant === "primary" && "bg-gold text-ink hover:bg-[#e2c35a] disabled:bg-line disabled:text-muted",
        variant === "secondary" && "border border-ink bg-paper text-ink hover:bg-canvas disabled:border-line disabled:text-muted",
        variant === "danger" && "bg-danger text-paper hover:bg-[#912018] disabled:bg-line disabled:text-muted",
        variant === "ghost" && "text-ink underline-offset-4 hover:underline disabled:text-muted",
        className,
      )}
    >
      {children}
    </button>
  );
});

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, id, className, ...rest }: FieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <label htmlFor={fieldId} className="font-semibold text-text">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <input
        id={fieldId}
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={clsx("min-h-11 rounded-sm border bg-paper px-3 py-2 text-text", error ? "border-danger" : "border-muted")}
      />
      {error ? (
        <p id={errorId} className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: readonly { value: string; label: string }[];
  hideLabel?: boolean;
}

export function SelectField({ label, options, id, hideLabel, className, ...rest }: SelectProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <label htmlFor={fieldId} className={clsx("font-semibold text-text", hideLabel && "sr-only")}>
        {label}
      </label>
      <select id={fieldId} {...rest} className="min-h-11 rounded-sm border border-muted bg-paper px-3 py-2 text-text">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type Tone = "error" | "success" | "info" | "neutral";

/** Message de statut : role=alert pour les erreurs (annoncé immédiatement), role=status sinon. */
export function Notice({ tone, title, children, id, focusRef }: { tone: Tone; title: string; children?: ReactNode; id?: string; focusRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      id={id}
      ref={focusRef}
      tabIndex={focusRef ? -1 : undefined}
      role={tone === "error" ? "alert" : "status"}
      className={clsx(
        "rounded-md border-l-4 bg-paper p-4 text-text",
        tone === "error" && "border-danger",
        tone === "success" && "border-ok",
        tone === "info" && "border-info",
        tone === "neutral" && "border-line",
      )}
    >
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1 text-sm">{children}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-semibold",
        tone === "error" && "border-danger text-danger",
        tone === "success" && "border-ok text-ok",
        tone === "info" && "border-info text-info",
        tone === "neutral" && "border-muted text-text",
      )}
    >
      {children}
    </span>
  );
}

/** États d'écran normalisés (§7) : loading, empty, error, forbidden, readonly, success. */
export function ScreenState({ kind, title, description, action }: { kind: "loading" | "empty" | "error" | "forbidden" | "readonly" | "success"; title: string; description?: string; action?: ReactNode }) {
  return (
    <section
      aria-live={kind === "loading" ? "polite" : undefined}
      aria-busy={kind === "loading" || undefined}
      data-state={kind}
      className="flex flex-col items-start gap-3 rounded-md border border-line bg-paper p-6"
    >
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {description ? <p className="text-muted">{description}</p> : null}
      {action}
    </section>
  );
}

export function Card({ title, children, headingLevel = 2 }: { title?: string; children: ReactNode; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="rounded-md border border-line bg-paper p-4 sm:p-6">
      {title ? <H className="mb-4 text-lg font-semibold text-text">{title}</H> : null}
      {children}
    </section>
  );
}
