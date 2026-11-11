import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";
import { REDACTED, redact } from "./redact";

describe("redact", () => {
  it("masque les clés sensibles, les en-têtes Bearer et les jetons longs", () => {
    const out = redact({
      accessToken: "abc",
      nested: { Authorization: "Bearer xyz", note: "header Bearer eyJhbGciOi.payload.sig here" },
      msg: "key sk_live_ABCDEFGHIJKLMNOPQRST leaked",
      safe: 42,
    }) as Record<string, unknown>;
    expect(out.accessToken).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).Authorization).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).note).toBe(`header Bearer ${REDACTED} here`);
    expect(out.msg).toBe(`key ${REDACTED} leaked`);
    expect(out.safe).toBe(42);
  });

  it("le logger n'émet jamais un secret", () => {
    const lines: string[] = [];
    createLogger({ requestId: "r1" }, (l) => lines.push(l)).child({ organizationId: "o1" }).error("oauth failed", { refreshToken: "zzz", detail: "ok" });
    expect(lines[0]).not.toContain("zzz");
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "error", requestId: "r1", organizationId: "o1", detail: "ok" });
  });
});
