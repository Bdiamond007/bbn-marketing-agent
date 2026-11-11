/** Horloge injectable : aucune logique métier ne lit Date.now() directement. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Horloge contrôlable pour tests et simulateurs déterministes. */
export class ManualClock implements Clock {
  private current: number;
  constructor(start: Date | string = "2026-11-01T12:00:00.000Z") {
    this.current = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.current);
  }
  advanceMs(ms: number): void {
    if (ms < 0) throw new RangeError("ManualClock ne recule pas");
    this.current += ms;
  }
  advanceSeconds(s: number): void {
    this.advanceMs(s * 1000);
  }
  set(date: Date | string): void {
    this.current = new Date(date).getTime();
  }
}
