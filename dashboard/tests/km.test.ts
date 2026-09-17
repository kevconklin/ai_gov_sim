import { describe, expect, it } from "vitest";
import { bootstrapBand, minMaxBand } from "@/lib/stats/bands";
import { kaplanMeier, medianSurvival, monthsElapsed } from "@/lib/stats/km";

describe("kaplanMeier", () => {
  it("matches a textbook example with censoring", () => {
    // times: 1(event) 2(censored) 3(event) 3(event) 4(censored) 5(event)
    const steps = kaplanMeier([
      { time: 1, event: true },
      { time: 2, event: false },
      { time: 3, event: true },
      { time: 3, event: true },
      { time: 4, event: false },
      { time: 5, event: true },
    ]);
    const s = Object.fromEntries(steps.map((x) => [x.time, x.survival]));
    expect(s[0]).toBe(1);
    expect(s[1]).toBeCloseTo(5 / 6);
    expect(s[2]).toBeCloseTo(5 / 6);
    expect(s[3]).toBeCloseTo((5 / 6) * (2 / 4));
    expect(s[4]).toBeCloseTo((5 / 6) * (2 / 4));
    expect(s[5]).toBeCloseTo(0);
    expect(steps.find((x) => x.time === 3)).toMatchObject({ atRisk: 4, events: 2, censored: 0 });
    expect(medianSurvival(steps)).toBe(3);
  });

  it("stays at 1 when everyone is censored", () => {
    const steps = kaplanMeier([{ time: 3, event: false }, { time: 3, event: false }]);
    expect(steps.every((x) => x.survival === 1)).toBe(true);
    expect(medianSurvival(steps)).toBeNull();
  });

  it("handles empty input", () => {
    expect(kaplanMeier([])).toEqual([{ time: 0, survival: 1, atRisk: 0, events: 0, censored: 0 }]);
  });

  it("counts months inclusively across years", () => {
    expect(monthsElapsed("2027-01", "2027-01")).toBe(1);
    expect(monthsElapsed("2027-11", "2028-02")).toBe(4);
  });
});

describe("bands", () => {
  it("computes min-max and a deterministic bootstrap band", () => {
    expect(minMaxBand([1, 3, 2])).toEqual({ n: 3, mean: 2, low: 1, high: 3 });
    const a = bootstrapBand([1, 2, 3, 4]);
    const b = bootstrapBand([1, 2, 3, 4]);
    expect(a).toEqual(b);
    expect(a!.low).toBeGreaterThanOrEqual(1);
    expect(a!.high).toBeLessThanOrEqual(4);
    expect(bootstrapBand([7])).toEqual({ n: 1, mean: 7, low: 7, high: 7 });
    expect(minMaxBand([])).toBeNull();
  });
});
