/**
 * Pass^k / Pass@k comparator — the instrument for criterion `beats-flash-baseline`.
 *
 * The success bar is defined against a number that does not exist yet: the RAW gemini-3.5-flash
 * Pass^3 per split (spec.intent.unknowns[0]; decisions "MEASURE FIRST"). This module reproduces the
 * harness's own formula so scaffolded-vs-baseline is computed identically:
 *
 *   car-bench/run.py::display_metrics
 *     c_per_task_index[task] = number of successful trials for that task
 *     pass_hat_k[k] = mean over tasks of  comb(c, k) / comb(num_trials, k)
 *
 * EXECUTING a benchmark run is an EVALUATE-stage activity (live Vertex, hours). Only the comparator
 * is built and tested at BUILD.
 */

export interface RunResult {
  task_id?: string;
  task_index: number;
  reward: number;
  trial: number;
}

export interface PassMetrics {
  tasks: number;
  trials: number;
  averageReward: number;
  /** Pass^k — every one of k trials passed. The headline consistency metric. */
  passHatK: Record<number, number>;
  /** Pass@k — at least one of k trials passed. Latent capability. */
  passAtK: Record<number, number>;
}

/** Binomial coefficient; 0 when k > n (matching Python's math.comb). */
export function comb(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) return 0;
  let result = 1;
  const upper = Math.min(k, n - k);
  for (let i = 0; i < upper; i += 1) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

/** The harness treats a reward within 1e-6 of 1.0 as a pass (run.py::is_successful). */
export function isSuccessful(reward: number): boolean {
  return reward >= 1 - 1e-6 && reward <= 1 + 1e-6;
}

export function computeMetrics(results: readonly RunResult[]): PassMetrics {
  if (results.length === 0) {
    return { tasks: 0, trials: 0, averageReward: 0, passHatK: {}, passAtK: {} };
  }

  const trials = new Set(results.map((r) => r.trial)).size;
  const successesByTask = new Map<number, number>();
  for (const result of results) {
    const current = successesByTask.get(result.task_index) ?? 0;
    successesByTask.set(result.task_index, current + (isSuccessful(result.reward) ? 1 : 0));
  }

  const counts = [...successesByTask.values()];
  const passHatK: Record<number, number> = {};
  const passAtK: Record<number, number> = {};

  for (let k = 1; k <= trials; k += 1) {
    const denominator = comb(trials, k);
    passHatK[k] =
      counts.reduce((sum, c) => sum + (denominator === 0 ? 0 : comb(c, k) / denominator), 0) /
      counts.length;
    passAtK[k] =
      counts.reduce(
        (sum, c) => sum + (denominator === 0 ? 0 : 1 - comb(trials - c, k) / denominator),
        0,
      ) / counts.length;
  }

  return {
    tasks: counts.length,
    trials,
    averageReward: results.reduce((sum, r) => sum + r.reward, 0) / results.length,
    passHatK,
    passAtK,
  };
}

export interface Comparison {
  k: number;
  baseline: number;
  harnessed: number;
  delta: number;
  beatsBaseline: boolean;
}

/** Strictly-above is the bar (`beats-flash-baseline`: "Strictly above baseline"). */
export function compareToBaseline(
  harnessed: PassMetrics,
  baseline: PassMetrics,
  k = 3,
): Comparison {
  const h = harnessed.passHatK[k] ?? 0;
  const b = baseline.passHatK[k] ?? 0;
  return { k, baseline: b, harnessed: h, delta: h - b, beatsBaseline: h > b };
}
