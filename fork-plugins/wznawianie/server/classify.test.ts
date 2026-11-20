import { describe, expect, it } from "vitest";
import { classifyFailure, parseReset } from "./classify";

describe("classifyFailure", () => {
  it("rozpoznaje rodzaje błędów", () => {
    expect(classifyFailure("Please run /login · API Error: 401")).toBe("AUTH");
    expect(classifyFailure("You've hit your weekly limit · resets Nov 21, 3pm")).toBe("WEEKLY");
    expect(classifyFailure("You've hit your limit · resets 3pm (Europe/Warsaw)")).toBe("RESUME");
    expect(classifyFailure("API Error: 529 Overloaded")).toBe("RESUME");
  });
});

describe("parseReset", () => {
  const after = Date.UTC(2026, 10, 19, 12, 0); // 13:00 w Warszawie
  it("czyta godzinę ze strefą", () => {
    expect(parseReset("You've hit your limit · resets 3pm (Europe/Warsaw)", after)).toBe(
      Date.UTC(2026, 10, 19, 14, 0),
    );
  });
  it("godzina, która już minęła, to jutro", () => {
    expect(parseReset("resets 9am (UTC)", after)).toBe(Date.UTC(2026, 10, 20, 9, 0));
  });
  it("czyta datę i epokę", () => {
    expect(parseReset("weekly limit · resets Nov 21, 3pm (UTC)", after)).toBe(
      Date.UTC(2026, 10, 21, 15, 0),
    );
    expect(parseReset("Claude AI usage limit reached|1795140000", after)).toBe(1795140000 * 1000);
  });
  it("bez godziny zwraca null", () => {
    expect(parseReset("API Error: 529 Overloaded", after)).toBeNull();
  });
});
