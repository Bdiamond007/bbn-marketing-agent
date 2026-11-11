import type { Clock } from "@bbn/domain";

/**
 * Limiteur à fenêtre fixe, en mémoire du processus.
 * Limite connue : non partagé entre instances ; un magasin partagé est requis avant la mise à l'échelle (E22/E23).
 */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();
  constructor(private readonly clock: Clock, private readonly limit: number, private readonly windowMs: number) {}

  /** Renvoie true si la requête est autorisée, et l'enregistre. */
  take(key: string): boolean {
    const now = this.clock.now().getTime();
    const e = this.hits.get(key);
    if (!e || now - e.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: now, count: 1 });
      if (this.hits.size > 50_000) this.prune(now);
      return true;
    }
    if (e.count >= this.limit) return false;
    e.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [k, v] of this.hits) if (now - v.windowStart >= this.windowMs) this.hits.delete(k);
  }
}
