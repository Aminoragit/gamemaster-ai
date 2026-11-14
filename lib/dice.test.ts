import { describe, expect, it } from "vitest";
import { outcomeLabel, rollCheck, rollDie, rollTotal } from "./dice";

/** RNG that always returns a fixed face value. */
const fixed = (face: number) => () => face;

describe("rollDie", () => {
  it("returns the injected face", () => {
    expect(rollDie(20, fixed(7))).toBe(7);
  });
  it("rejects a 1-sided die", () => {
    expect(() => rollDie(1)).toThrow();
  });
});

describe("rollCheck", () => {
  it("succeeds when total meets the DC", () => {
    const r = rollCheck(3, 12, fixed(9)); // 9 + 3 = 12
    expect(r.total).toBe(12);
    expect(r.outcome).toBe("success");
  });
  it("fails when total is below the DC", () => {
    expect(rollCheck(0, 15, fixed(10)).outcome).toBe("failure");
  });
  it("natural 20 is a critical success even below DC", () => {
    expect(rollCheck(0, 25, fixed(20)).outcome).toBe("critical_success");
  });
  it("natural 1 is a critical failure even above DC", () => {
    expect(rollCheck(10, 5, fixed(1)).outcome).toBe("critical_failure");
  });
});

describe("rollTotal", () => {
  it("sums dice plus modifier", () => {
    const r = rollTotal(2, 6, 3, fixed(4));
    expect(r.rolls).toEqual([4, 4]);
    expect(r.total).toBe(11);
  });
});

describe("outcomeLabel", () => {
  it("labels every tier", () => {
    expect(outcomeLabel("critical_success")).toContain("Critical");
    expect(outcomeLabel("success")).toBe("Success");
  });
});
