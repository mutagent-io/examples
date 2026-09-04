import { describe, expect, test } from "bun:test";
import {
  comb,
  compareToBaseline,
  computeMetrics,
  isSuccessful,
  type RunResult,
} from "../src/baseline.ts";

/** 3 trials x 3 tasks: task 0 passes 3/3, task 1 passes 2/3, task 2 passes 0/3. */
function sample(): RunResult[] {
  const rewards: Record<number, number[]> = { 0: [1, 1, 1], 1: [1, 1, 0], 2: [0, 0, 0] };
  const out: RunResult[] = [];
  for (const [taskIndex, trials] of Object.entries(rewards)) {
    trials.forEach((reward, trial) => {
      out.push({ task_index: Number(taskIndex), task_id: `base_${taskIndex}`, reward, trial });
    });
  }
  return out;
}

describe("Pass^k comparator (reproduces run.py::display_metrics)", () => {
  test("comb matches math.comb, including k > n", () => {
    expect(comb(3, 3)).toBe(1);
    expect(comb(3, 1)).toBe(3);
    expect(comb(2, 3)).toBe(0);
    expect(comb(0, 1)).toBe(0);
  });

  test("the harness's 1e-6 success window is honored", () => {
    expect(isSuccessful(1)).toBe(true);
    expect(isSuccessful(0.9999999)).toBe(true);
    expect(isSuccessful(0.99)).toBe(false);
  });

  test("Pass^3 and Pass@3 match hand-computed values", () => {
    const metrics = computeMetrics(sample());

    expect(metrics.tasks).toBe(3);
    expect(metrics.trials).toBe(3);

    // Pass^3 = mean over tasks of comb(c,3)/comb(3,3) = (1 + 0 + 0)/3
    expect(metrics.passHatK[3]).toBeCloseTo(1 / 3, 10);
    // Pass^1 = mean of c/3 = (3/3 + 2/3 + 0)/3
    expect(metrics.passHatK[1]).toBeCloseTo((1 + 2 / 3 + 0) / 3, 10);
    // Pass@3 = mean of 1 - comb(3-c,3)/comb(3,3) = (1 + 1 + 0)/3
    expect(metrics.passAtK[3]).toBeCloseTo(2 / 3, 10);

    expect(metrics.averageReward).toBeCloseTo(5 / 9, 10);
  });

  test("Pass^k <= Pass@k for every k (a consistency invariant of the two metrics)", () => {
    const metrics = computeMetrics(sample());
    for (const k of [1, 2, 3]) {
      const hat = metrics.passHatK[k] ?? 0;
      const at = metrics.passAtK[k] ?? 0;
      expect(hat).toBeLessThanOrEqual(at + 1e-12);
    }
  });

  test("empty results do not divide by zero", () => {
    expect(computeMetrics([])).toEqual({
      tasks: 0,
      trials: 0,
      averageReward: 0,
      passHatK: {},
      passAtK: {},
    });
  });

  test("beats-flash-baseline requires STRICTLY above baseline", () => {
    const harnessed = computeMetrics(sample());
    const worse = computeMetrics(
      sample().map((r) => (r.task_index === 0 && r.trial === 0 ? { ...r, reward: 0 } : r)),
    );

    expect(compareToBaseline(harnessed, worse).beatsBaseline).toBe(true);
    expect(compareToBaseline(harnessed, harnessed).beatsBaseline).toBe(false); // a tie is not a win
    expect(compareToBaseline(worse, harnessed).beatsBaseline).toBe(false);
    expect(compareToBaseline(harnessed, worse).delta).toBeGreaterThan(0);
  });
});
