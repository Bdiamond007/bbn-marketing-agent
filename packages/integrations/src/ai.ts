import type { Locale } from "./email";

export interface AiTextRequest {
  promptVersion: string;
  model: string;
  locale: Locale;
  /** Instructions système (jamais mélangées aux données importées). */
  instructions: string;
  /** Données non fiables, transmises séparément des instructions (§12). */
  untrustedContext: Record<string, unknown>;
  timeoutMs: number;
}

export interface AiTextResult {
  outputText: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export type AiErrorClass = "timeout" | "rate_limited" | "provider_error";

export class AiProviderError extends Error {
  constructor(readonly errorClass: AiErrorClass, readonly retryAfterSeconds?: number) {
    super(`AI provider error: ${errorClass}`);
    this.name = "AiProviderError";
  }
}

export interface AiTextProvider {
  readonly providerId: string;
  generate(req: AiTextRequest): Promise<AiTextResult>;
}
