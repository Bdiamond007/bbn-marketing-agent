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
  signUp(email: string, password: string): Promise<{ user: IdentityUser; verificationCode: string }>;
  verifyEmail(email: string, code: string): Promise<IdentityUser>;
  signIn(email: string, password: string): Promise<IdentityUser>;
  /** Toujours la même réponse que le compte existe ou non (pas d'énumération). */
  startRecovery(email: string): Promise<void>;
  completeRecovery(email: string, code: string, newPassword: string): Promise<void>;
}
