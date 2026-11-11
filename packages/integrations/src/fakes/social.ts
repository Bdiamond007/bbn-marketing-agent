import type {
  CapabilityManifest,
  MediaDescriptor,
  MediaValidation,
  OAuthCallbackResult,
  OAuthConnector,
  OAuthTokens,
  PublishOutcome,
  PublishRequest,
  ReconcileOutcome,
  ReconcileRequest,
  SocialProvider,
  SocialPublisher,
} from "../social";
import { ScenarioScript } from "../scenario";
import { sha256Hex } from "./util";

export type PublishScenario =
  | "confirmed"
  | "processing"
  | "rejected_permission"
  | "rejected_token_expired"
  | "rejected_media"
  | "rate_limited"
  | "provider_error"
  /** Le fournisseur a créé le post mais la réponse est perdue : unknown. */
  | "timeout_after_send"
  /** Délai dépassé avant toute émission : aucun post créé, mais l'appelant ne peut pas le savoir → unknown. */
  | "timeout_before_send";

/** Manifeste de capacités du simulateur — ne reflète AUCUNE capacité réelle de fournisseur. */
export function fakeManifest(provider: SocialProvider): CapabilityManifest {
  return {
    provider,
    manifestVersion: "fake-1",
    source: "simulator",
    verifiedAt: null,
    supportsText: true,
    supportsSingleImage: true,
    imageMimeTypes: ["image/jpeg", "image/png"],
    maxImageBytes: 8 * 1024 * 1024,
    maxCaptionLength: 2000,
    requiresPublicMediaUrl: provider === "instagram_business",
    supportsReconcile: true,
    supportsRevoke: true,
  };
}

interface FakePost {
  externalId: string;
  accountId: string;
  requestKey: string;
  caption: string;
  state: "processing" | "published";
}

/**
 * Réseau social simulé. Volontairement NON idempotent : republier la même requestKey crée un doublon,
 * afin que les tests détectent tout renvoi aveugle après un résultat unknown.
 */
export class FakeSocialPublisher implements SocialPublisher {
  readonly scenarios = new ScenarioScript<PublishScenario>("confirmed");
  readonly posts: FakePost[] = [];
  readonly disconnected = new Set<string>();
  private seq = 0;

  constructor(readonly provider: SocialProvider) {}

  getCapabilities(): CapabilityManifest {
    return fakeManifest(this.provider);
  }

  validateMedia(media: MediaDescriptor): MediaValidation {
    const m = this.getCapabilities();
    if (!m.imageMimeTypes.includes(media.mime)) return { ok: false, safeCode: "media_type_unsupported" };
    if (m.maxImageBytes !== null && media.bytes > m.maxImageBytes) return { ok: false, safeCode: "media_too_large" };
    if (media.width < 320 || media.height < 320) return { ok: false, safeCode: "media_too_small" };
    return { ok: true };
  }

  async publish(req: PublishRequest): Promise<PublishOutcome> {
    if (this.disconnected.has(req.connectionRef.externalAccountId)) {
      return { kind: "rejected", rejection: "permission", safeCode: "connection_revoked", retryAfterSeconds: null };
    }
    const m = this.getCapabilities();
    if (m.maxCaptionLength !== null && req.caption.length > m.maxCaptionLength) {
      return { kind: "rejected", rejection: "invalid_request", safeCode: "caption_too_long", retryAfterSeconds: null };
    }
    for (const media of req.media) {
      const v = this.validateMedia(media.descriptor);
      if (!v.ok) return { kind: "rejected", rejection: "media", safeCode: v.safeCode, retryAfterSeconds: null };
    }
    const s = this.scenarios.take();
    switch (s) {
      case "confirmed": {
        const p = this.create(req, "published");
        return { kind: "confirmed", externalId: p.externalId, externalUrl: `https://social.fake.invalid/${this.provider}/${p.externalId}` };
      }
      case "processing":
        return { kind: "processing", externalRef: this.create(req, "processing").externalId };
      case "rejected_permission":
        return { kind: "rejected", rejection: "permission", safeCode: "permission_denied", retryAfterSeconds: null };
      case "rejected_token_expired":
        return { kind: "rejected", rejection: "token_expired", safeCode: "token_expired", retryAfterSeconds: null };
      case "rejected_media":
        return { kind: "rejected", rejection: "media", safeCode: "media_rejected", retryAfterSeconds: null };
      case "rate_limited":
        return { kind: "rejected", rejection: "rate_limited", safeCode: "rate_limited", retryAfterSeconds: 60 };
      case "provider_error":
        return { kind: "rejected", rejection: "provider_error", safeCode: "provider_unavailable", retryAfterSeconds: null };
      case "timeout_after_send":
        this.create(req, "published");
        return { kind: "unknown", reason: "timeout_after_send" };
      case "timeout_before_send":
        return { kind: "unknown", reason: "timeout_after_send" };
    }
  }

  async reconcile(req: ReconcileRequest): Promise<ReconcileOutcome> {
    const matches = this.posts.filter((p) => p.accountId === req.connectionRef.externalAccountId && (p.requestKey === req.requestKey || p.externalId === req.externalRef));
    const p = matches[0];
    if (!p) return { kind: "not_found" };
    if (p.state === "processing") return { kind: "processing", externalRef: p.externalId };
    return { kind: "confirmed", externalId: p.externalId, externalUrl: `https://social.fake.invalid/${this.provider}/${p.externalId}` };
  }

  async disconnect(connectionRef: PublishRequest["connectionRef"]): Promise<void> {
    this.disconnected.add(connectionRef.externalAccountId);
  }

  /** Termine un post en traitement (simule la fin du traitement asynchrone côté réseau). */
  completeProcessing(externalId: string): void {
    const p = this.posts.find((x) => x.externalId === externalId);
    if (p) p.state = "published";
  }

  postsFor(accountId: string, requestKey?: string): FakePost[] {
    return this.posts.filter((p) => p.accountId === accountId && (requestKey === undefined || p.requestKey === requestKey));
  }

  private create(req: PublishRequest, state: FakePost["state"]): FakePost {
    this.seq += 1;
    const p: FakePost = {
      externalId: `fake_${this.provider}_${sha256Hex(`${req.requestKey}:${this.seq}`).slice(0, 12)}`,
      accountId: req.connectionRef.externalAccountId,
      requestKey: req.requestKey,
      caption: req.caption,
      state,
    };
    this.posts.push(p);
    return p;
  }
}

export type OAuthScenario = "success" | "access_denied" | "invalid_code";

/** OAuth simulé : vérifie state et PKCE, ne manipule jamais de mot de passe. */
export class FakeOAuthConnector implements OAuthConnector {
  readonly scenarios = new ScenarioScript<OAuthScenario>("success");
  private readonly issued = new Map<string, { challenge: string; used: boolean }>();
  private readonly revoked = new Set<string>();

  constructor(readonly provider: SocialProvider, private readonly accountId = `acct_${provider}_demo`) {}

  authorize(req: { state: string; redirectUri: string; codeChallenge: string }): { url: string } {
    const code = `code_${sha256Hex(req.state).slice(0, 16)}`;
    this.issued.set(code, { challenge: req.codeChallenge, used: false });
    const q = new URLSearchParams({ state: req.state, redirect_uri: req.redirectUri, code });
    return { url: `https://oauth.fake.invalid/${this.provider}/authorize?${q.toString()}` };
  }

  async callback(req: { code: string; state: string; expectedState: string; codeVerifier: string }): Promise<OAuthCallbackResult> {
    if (req.state !== req.expectedState) throw new Error("oauth_state_mismatch");
    const s = this.scenarios.take();
    if (s === "access_denied") throw new Error("oauth_access_denied");
    const entry = this.issued.get(req.code);
    if (s === "invalid_code" || !entry || entry.used) throw new Error("oauth_invalid_code");
    if (sha256Hex(req.codeVerifier) !== entry.challenge) throw new Error("oauth_pkce_mismatch");
    entry.used = true;
    return {
      externalAccountId: this.accountId,
      displayName: `Compte simulé ${this.provider}`,
      tokens: { secret: `fake-token-${sha256Hex(req.code).slice(0, 24)}`, expiresAt: null, scopes: ["fake.publish"] },
    };
  }

  async refreshIfSupported(secret: string): Promise<OAuthTokens | null> {
    if (this.revoked.has(secret)) return null;
    return { secret, expiresAt: null, scopes: ["fake.publish"] };
  }

  async revokeIfSupported(secret: string): Promise<boolean> {
    this.revoked.add(secret);
    return true;
  }
}
