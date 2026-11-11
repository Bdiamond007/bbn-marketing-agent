/**
 * Machine à états éditoriale (SPECIFICATION §5) — module pur. Les statuts ne sont jamais modifiés librement :
 * toute transition passe par `transition()`, qui refuse les passages non prévus.
 * Approbations indépendantes par variante ; l'état du sujet n'est qu'un résumé.
 */
export const EDITORIAL_STATES = ["draft", "generating", "internal_review", "pending_customer_review", "changes_requested", "approved", "archived"] as const;
export type EditorialState = (typeof EDITORIAL_STATES)[number];

export type EditorialEvent =
  | { type: "start_generation" }
  | { type: "generation_finished" }
  | { type: "generation_failed" }
  | { type: "new_revision" }
  | { type: "submit"; internalReview: boolean }
  | { type: "internal_approve" }
  | { type: "request_changes" }
  | { type: "customer_approve" }
  | { type: "archive" }
  | { type: "restore" };

export class InvalidTransition extends Error {
  constructor(readonly from: EditorialState, readonly event: EditorialEvent["type"]) {
    super(`invalid_transition:${from}:${event}`);
    this.name = "InvalidTransition";
  }
}

export function transition(from: EditorialState, event: EditorialEvent): EditorialState {
  const fail = (): never => {
    throw new InvalidTransition(from, event.type);
  };
  switch (event.type) {
    case "start_generation":
      return from === "draft" || from === "changes_requested" ? "generating" : fail();
    case "generation_finished":
    case "generation_failed":
      // Un échec ne supprime aucune révision : on revient simplement au brouillon.
      return from === "generating" ? "draft" : fail();
    case "new_revision":
      // Toute modification du texte ou des médias ramène au brouillon (l'approbation éventuelle est invalidée ailleurs).
      return from === "archived" || from === "generating" ? fail() : "draft";
    case "submit":
      return from === "draft" || from === "changes_requested" ? (event.internalReview ? "internal_review" : "pending_customer_review") : fail();
    case "internal_approve":
      return from === "internal_review" ? "pending_customer_review" : fail();
    case "request_changes":
      return from === "internal_review" || from === "pending_customer_review" ? "changes_requested" : fail();
    case "customer_approve":
      return from === "pending_customer_review" ? "approved" : fail();
    case "archive":
      return from === "archived" ? fail() : "archived";
    case "restore":
      return from === "archived" ? "draft" : fail();
  }
}

/** Résumé de l'état d'un sujet à partir de ses variantes (aucune approbation globale). */
export function summarizeItem(variants: readonly EditorialState[]): EditorialState {
  const live = variants.filter((s) => s !== "archived");
  if (variants.length === 0) return "draft";
  if (live.length === 0) return "archived";
  for (const s of ["generating", "changes_requested", "draft", "internal_review", "pending_customer_review"] as const) if (live.includes(s)) return s;
  return "approved";
}
