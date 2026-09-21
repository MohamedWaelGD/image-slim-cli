import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../../src/core/scheduler";

describe("bounded scheduler", () => {
  it("does not exceed configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (value) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return value * 2;
      },
    );

    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });

  it("preserves successful results by input order", async () => {
    const result = await mapWithConcurrency([30, 10, 20], 3, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value / 10));
      return value;
    });
    expect(result).toEqual([30, 10, 20]);
  });
});
