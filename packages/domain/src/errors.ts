/**
 * Erreur métier transportant un code stable, une clé de message i18n et un statut HTTP.
 * Les détails éventuels sont expurgés (jamais de secret, jamais d'existence d'objet d'un autre tenant).
 */
export const ERROR_STATUS = {
  validation_failed: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  session_invalid: 401,
  reauth_required: 401,
  mfa_required: 403,
  forbidden: 403,
  email_not_verified: 403,
  origin_rejected: 403,
  not_found: 404,
  conflict: 409,
  stale_version: 409,
  business_rule: 422,
  last_owner_protected: 422,
  invitation_invalid: 422,
  invitation_expired: 422,
  invitation_email_mismatch: 422,
  rate_limited: 429,
  not_implemented: 501,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;

export class ServiceError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, readonly details?: Record<string, unknown>) {
    super(code);
    this.name = "ServiceError";
    this.status = ERROR_STATUS[code];
  }
  get messageKey(): string {
    return `errors.codes.${this.code}`;
  }
}
