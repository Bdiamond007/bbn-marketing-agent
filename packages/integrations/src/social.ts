export type SocialProvider = "facebook_page" | "instagram_business" | "linkedin_page";

export interface CapabilityManifest {
  provider: SocialProvider;
  manifestVersion: string;
  /** Source officielle et date de relevé (E03). "simulator" pour les fakes. */
  source: string;
  verifiedAt: string | null;
  supportsText: boolean;
  supportsSingleImage: boolean;
  imageMimeTypes: readonly string[];
  maxImageBytes: number | null;
  maxCaptionLength: number | null;
  requiresPublicMediaUrl: boolean;
  supportsReconcile: boolean;
  supportsRevoke: boolean;
}

export interface MediaDescriptor {
  mime: string;
  bytes: number;
  width: number;
  height: number;
}

export type MediaValidation = { ok: true } | { ok: false; safeCode: string };

export interface PublishRequest {
  connectionRef: { externalAccountId: string; secretRef: string };
  /** Clé unique par tentative logique, persistée avant l'appel (PublishingAttempt.request_key). */
  requestKey: string;
  caption: string;
  media: readonly { signedUrl: string; descriptor: MediaDescriptor }[];
}

export type RejectionClass = "permission" | "token_expired" | "media" | "rate_limited" | "invalid_request" | "provider_error";

export type PublishOutcome =
  | { kind: "confirmed"; externalId: string; externalUrl: string | null }
  | { kind: "processing"; externalRef: string }
  | { kind: "rejected"; rejection: RejectionClass; safeCode: string; retryAfterSeconds: number | null }
  /** Émission possible mais résultat inconnu : réservation conservée, réconciliation, pas de renvoi aveugle. */
  | { kind: "unknown"; reason: "timeout_after_send" | "ambiguous_response" };

export interface ReconcileRequest {
  connectionRef: PublishRequest["connectionRef"];
  requestKey: string;
  externalRef: string | null;
}

export type ReconcileOutcome =
  | { kind: "confirmed"; externalId: string; externalUrl: string | null }
  | { kind: "processing"; externalRef: string }
  | { kind: "not_found" }
  | { kind: "unknown" };

export interface SocialPublisher {
  readonly provider: SocialProvider;
  getCapabilities(): CapabilityManifest;
  validateMedia(media: MediaDescriptor): MediaValidation;
  publish(req: PublishRequest): Promise<PublishOutcome>;
  reconcile(req: ReconcileRequest): Promise<ReconcileOutcome>;
  disconnect(connectionRef: PublishRequest["connectionRef"]): Promise<void>;
}

export interface OAuthTokens {
  /** Secret opaque, destiné au chiffrement KMS ; jamais renvoyé au navigateur ni journalisé. */
  secret: string;
  expiresAt: string | null;
  scopes: readonly string[];
}

export interface OAuthCallbackResult {
  externalAccountId: string;
  displayName: string;
  tokens: OAuthTokens;
}

export interface OAuthConnector {
  readonly provider: SocialProvider;
  authorize(req: { state: string; redirectUri: string; codeChallenge: string }): { url: string };
  callback(req: { code: string; state: string; expectedState: string; codeVerifier: string }): Promise<OAuthCallbackResult>;
  refreshIfSupported(secret: string): Promise<OAuthTokens | null>;
  revokeIfSupported(secret: string): Promise<boolean>;
}
