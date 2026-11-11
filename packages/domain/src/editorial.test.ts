import { describe, expect, it } from "vitest";
import { EDITORIAL_STATES, InvalidTransition, summarizeItem, transition, type EditorialEvent, type EditorialState } from "./editorial";

describe("machine à états éditoriale", () => {
  it("parcours nominal avec revue interne (plan accompagné)", () => {
    let s: EditorialState = "draft";
    s = transition(s, { type: "start_generation" });
    s = transition(s, { type: "generation_finished" });
    s = transition(s, { type: "submit", internalReview: true });
    expect(s).toBe("internal_review");
    s = transition(s, { type: "internal_approve" });
    s = transition(s, { type: "customer_approve" });
    expect(s).toBe("approved");
  });

  it("sans revue interne, soumission directe au client ; corrections puis nouvelle révision", () => {
    let s = transition("draft", { type: "submit", internalReview: false });
    expect(s).toBe("pending_customer_review");
    s = transition(s, { type: "request_changes" });
    s = transition(s, { type: "new_revision" });
    expect(s).toBe("draft");
  });

  it("une révision après approbation ramène au brouillon ; échec de génération sans perte", () => {
    expect(transition("approved", { type: "new_revision" })).toBe("draft");
    expect(transition("generating", { type: "generation_failed" })).toBe("draft");
  });

  it("refuse les transitions non prévues (dont l'approbation sans revue client)", () => {
    const forbidden: [EditorialState, EditorialEvent][] = [
      ["draft", { type: "customer_approve" }],
      ["internal_review", { type: "customer_approve" }],
      ["approved", { type: "submit", internalReview: false }],
      ["generating", { type: "new_revision" }],
      ["archived", { type: "new_revision" }],
      ["draft", { type: "restore" }],
    ];
    for (const [from, ev] of forbidden) expect(() => transition(from, ev), `${from}+${ev.type}`).toThrow(InvalidTransition);
  });

  it("tout état non archivé peut être archivé, et seul l'archivé se restaure", () => {
    for (const s of EDITORIAL_STATES.filter((x) => x !== "archived")) expect(transition(s, { type: "archive" })).toBe("archived");
    expect(transition("archived", { type: "restore" })).toBe("draft");
  });
});

describe("résumé de sujet", () => {
  it("approuvé seulement si toutes les variantes vivantes le sont ; l'état le moins avancé l'emporte", () => {
    expect(summarizeItem(["approved", "approved"])).toBe("approved");
    expect(summarizeItem(["approved", "pending_customer_review"])).toBe("pending_customer_review");
    expect(summarizeItem(["approved", "changes_requested"])).toBe("changes_requested");
    expect(summarizeItem(["approved", "archived"])).toBe("approved");
    expect(summarizeItem(["archived"])).toBe("archived");
    expect(summarizeItem([])).toBe("draft");
  });
});
