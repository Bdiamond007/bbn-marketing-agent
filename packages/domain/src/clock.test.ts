import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";

describe("ManualClock", () => {
  it("avance de façon déterministe et refuse de reculer", () => {
    const c = new ManualClock("2026-01-01T00:00:00Z");
    c.advanceSeconds(90);
    expect(c.now().toISOString()).toBe("2026-01-01T00:01:30.000Z");
    expect(() => c.advanceMs(-1)).toThrow(RangeError);
  });
});
