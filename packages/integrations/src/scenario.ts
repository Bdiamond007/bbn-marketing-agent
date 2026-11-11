/**
 * Script de scénarios déterministe pour les simulateurs.
 * Chaque appel consomme le prochain scénario programmé ; à défaut, `fallback`.
 * Aucun aléa : un même script produit toujours les mêmes résultats.
 */
export class ScenarioScript<S extends string> {
  private readonly queue: S[] = [];
  constructor(private readonly fallback: S) {}
  /** Programme les prochains résultats, dans l'ordre. */
  next(...scenarios: S[]): this {
    this.queue.push(...scenarios);
    return this;
  }
  take(): S {
    return this.queue.shift() ?? this.fallback;
  }
  get pending(): number {
    return this.queue.length;
  }
}

/** Erreur simulée de délai dépassé côté réseau. */
export class SimulatedTimeoutError extends Error {
  constructor(operation: string) {
    super(`Simulated timeout: ${operation}`);
    this.name = "SimulatedTimeoutError";
  }
}

/** Erreur simulée de fournisseur (5xx, indisponible). */
export class SimulatedProviderError extends Error {
  constructor(operation: string, readonly safeCode: string = "provider_unavailable") {
    super(`Simulated provider error: ${operation}`);
    this.name = "SimulatedProviderError";
  }
}
