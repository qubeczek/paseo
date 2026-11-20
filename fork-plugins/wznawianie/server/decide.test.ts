import { describe, expect, it } from "vitest";
import { decide, MAX_ATTEMPTS, type PendingFailure } from "./decide";

const MIN = 60_000;
const base: PendingFailure = {
  agentId: "a",
  title: null,
  kind: "RESUME",
  message: "",
  failedAt: 0,
  resetAt: null,
  attempts: 0,
  lastAttemptAt: null,
  credentialsVersion: "konto-1",
};

describe("decide", () => {
  it("RESUME: po 3 min postoju, potem co 15 min, do limitu prób", () => {
    expect(decide(base, 2 * MIN, "konto-1").send).toBe(false);
    expect(decide(base, 3 * MIN, "konto-1").send).toBe(true);
    const tried = { ...base, attempts: 1, lastAttemptAt: 3 * MIN };
    expect(decide(tried, 10 * MIN, "konto-1").send).toBe(false);
    expect(decide(tried, 18 * MIN, "konto-1").send).toBe(true);
    expect(decide({ ...tried, attempts: MAX_ATTEMPTS }, 99 * MIN, "konto-1").send).toBe(false);
  });

  it("czeka do godziny resetu i wysyła zaraz po niej", () => {
    const limited = { ...base, resetAt: 60 * MIN };
    expect(decide(limited, 30 * MIN, "konto-1").send).toBe(false);
    expect(decide(limited, 61 * MIN, "konto-1")).toEqual({ send: true, why: "po godzinie resetu" });
  });

  it("zmiana konta wznawia każdy rodzaj, także AUTH i przed resetem", () => {
    const auth = { ...base, kind: "AUTH" as const, resetAt: 600 * MIN };
    expect(decide(auth, 10 * MIN, "konto-1").send).toBe(false);
    expect(decide(auth, 10 * MIN, "konto-2")).toEqual({ send: true, why: "zmiana konta" });
  });
});
