/** Fournisseur d'identité (Cognito en live, simulateur en local). Aucun mot de passe social n'est jamais manipulé. */
export interface IdentityUser {
  subject: string;
  email: string;
  emailVerified: boolean;
}

export type IdentityErrorCode =
  | "email_taken"
  | "invalid_credentials"
  | "invalid_code"
  | "code_expired"
  | "weak_password";

export class IdentityError extends Error {
  constructor(readonly code: IdentityErrorCode) {
    super(`identity_error:${code}`);
    this.name = "IdentityError";
  }
}

export interface IdentityProvider {
  /** `verificationCode` n'est renvoyé que si l'envoi du code nous incombe (simulateur). */
  signUp(email: string, password: string): Promise<{ user: IdentityUser; verificationCode?: string }>;
  verifyEmail(email: string, code: string): Promise<IdentityUser>;
  signIn(email: string, password: string): Promise<IdentityUser>;
  /**
   * Toujours la même réponse visible que le compte existe ou non (pas d'énumération).
   * `deliveryCode` n'est renvoyé que si l'envoi du code nous incombe (simulateur) ; Cognito l'envoie lui-même.
   */
  startRecovery(email: string): Promise<{ deliveryCode?: string }>;
  completeRecovery(email: string, code: string, newPassword: string): Promise<{ subject: string }>;
  /** Vérifie un code MFA (TOTP) pour le sujet ; requis pour toute session privilégiée. */
  verifyMfa(subject: string, code: string): Promise<boolean>;
}
