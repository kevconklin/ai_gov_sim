/** Kaplan-Meier survival estimate. */
export interface Subject {
  /** Time to event or censoring (e.g. sim months since start). */
  time: number;
  /** true = event observed, false = right-censored. */
  event: boolean;
}

export interface KmStep {
  time: number;
  survival: number;
  atRisk: number;
  events: number;
  censored: number;
}

export function kaplanMeier(subjects: readonly Subject[]): KmStep[] {
  const valid = subjects.filter((s) => Number.isFinite(s.time) && s.time >= 0);
  const steps: KmStep[] = [{ time: 0, survival: 1, atRisk: valid.length, events: 0, censored: 0 }];
  const times = [...new Set(valid.map((s) => s.time))].sort((a, b) => a - b);
  let survival = 1;
  for (const t of times) {
    const atRisk = valid.filter((s) => s.time >= t).length;
    const events = valid.filter((s) => s.time === t && s.event).length;
    const censored = valid.filter((s) => s.time === t && !s.event).length;
    if (atRisk > 0 && events > 0) survival *= 1 - events / atRisk;
    if (t === 0) {
      steps[0] = { time: 0, survival, atRisk, events, censored };
    } else {
      steps.push({ time: t, survival, atRisk, events, censored });
    }
  }
  return steps;
}

/** Smallest time at which survival drops to 0.5 or below; null if never. */
export function medianSurvival(steps: readonly KmStep[]): number | null {
  return steps.find((s) => s.survival <= 0.5)?.time ?? null;
}

/** Months elapsed from start (inclusive): same month = 1. Months are 'YYYY-MM'. */
export function monthsElapsed(startMonth: string, month: string): number {
  return monthIndex(month) - monthIndex(startMonth) + 1;
}

export function monthIndex(month: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return Number.NaN;
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}
