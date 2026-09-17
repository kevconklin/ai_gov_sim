/** Summaries across replicates: mean, min-max, and seeded percentile bootstrap CI. */
export interface Band {
  n: number;
  mean: number;
  low: number;
  high: number;
}

export function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function minMaxBand(values: readonly number[]): Band | null {
  if (values.length === 0) return null;
  return { n: values.length, mean: mean(values), low: Math.min(...values), high: Math.max(...values) };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

export function bootstrapBand(values: readonly number[], resamples = 2000, seed = 20270101): Band | null {
  if (values.length === 0) return null;
  const m = mean(values);
  if (values.length === 1) return { n: 1, mean: m, low: m, high: m };
  const rand = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(rand() * values.length)]!;
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return { n: values.length, mean: m, low: quantile(means, 0.025), high: quantile(means, 0.975) };
}
