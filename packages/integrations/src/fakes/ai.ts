import type { Clock } from "@bbn/domain";
import { AiProviderError, type AiTextProvider, type AiTextRequest, type AiTextResult } from "../ai";
import { ScenarioScript } from "../scenario";
import { sha256Hex } from "./util";

export type AiScenario = "success" | "invalid_json" | "schema_violation" | "timeout" | "rate_limited" | "provider_error" | "scripted";

/**
 * IA simulée, déterministe : la sortie dépend uniquement de la requête.
 * Elle n'invente aucun fait : elle ne cite que les identifiants de faits fournis.
 * La validation du schéma de sortie reste du ressort du module IA (E13), indépendamment du prompt.
 */
export class FakeAiTextProvider implements AiTextProvider {
  readonly providerId = "fake";
  readonly scenarios = new ScenarioScript<AiScenario>("success");
  readonly calls: AiTextRequest[] = [];
  private readonly scripted: string[] = [];

  /** Programme une sortie brute exacte (corpus d'évaluation : simule un modèle qui se trompe ou obéit à une injection). */
  respondWith(...outputs: (string | Record<string, unknown>)[]): this {
    for (const o of outputs) {
      this.scripted.push(typeof o === "string" ? o : JSON.stringify(o));
      this.scenarios.next("scripted");
    }
    return this;
  }

  constructor(readonly clock?: Clock) {}

  async generate(req: AiTextRequest): Promise<AiTextResult> {
    this.calls.push(structuredClone(req));
    const s = this.scenarios.take();
    if (s === "timeout") throw new AiProviderError("timeout");
    if (s === "rate_limited") throw new AiProviderError("rate_limited", 30);
    if (s === "provider_error") throw new AiProviderError("provider_error");

    const digest = sha256Hex(JSON.stringify([req.promptVersion, req.locale, req.instructions, req.untrustedContext])).slice(0, 8);
    const factIds = Array.isArray(req.untrustedContext.factIds) ? (req.untrustedContext.factIds as unknown[]).filter((x) => typeof x === "string") : [];
    const topic = typeof req.untrustedContext.topic === "string" ? req.untrustedContext.topic : "";
    const fr = req.locale === "fr-CA";
    let outputText: string;
    if (s === "scripted") outputText = this.scripted.shift() ?? "{}";
    else if (s === "invalid_json") outputText = "{ not json";
    else if (s === "schema_violation") outputText = JSON.stringify({ caption: 42 });
    else
      outputText = JSON.stringify({
        topic,
        locale: req.locale,
        caption: fr ? `[SIMULATION ${digest}] Proposition de texte sur : ${topic}` : `[SIMULATION ${digest}] Draft caption about: ${topic}`,
        callToAction: fr ? "Contactez-nous" : "Contact us",
        visualBrief: fr ? "Photo de la marque, texte court" : "Brand photo, short text",
        usedFactIds: factIds,
        warnings: [],
        requiresHumanReview: true,
      });
    return {
      outputText,
      model: req.model,
      usage: { inputTokens: Math.ceil(JSON.stringify(req).length / 4), outputTokens: Math.ceil(outputText.length / 4) },
      latencyMs: 0,
    };
  }
}
