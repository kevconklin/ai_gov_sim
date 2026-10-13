/**
 * The stages of an approved use case and the moves a person may make. Mirrors config/lifecycle.yaml,
 * which the worker enforces; this copy only decides what the page offers.
 */
export const STAGES = ["approved", "building", "piloting", "live", "paused", "retired"] as const;
export type Stage = (typeof STAGES)[number];

export const TRANSITIONS: Record<Stage, Stage[]> = {
  approved: ["building", "piloting", "live", "retired"],
  building: ["piloting", "live", "paused", "retired"],
  piloting: ["live", "paused", "retired"],
  live: ["paused", "retired"],
  paused: ["building", "piloting", "live", "retired"],
  retired: [],
};

export const STAGE_WORDS: Record<Stage, string> = { approved: "Approved", building: "Building", piloting: "Piloting", live: "Live", paused: "Paused", retired: "Retired" };
export const STAGE_TONE: Record<Stage, string> = { approved: "ok", building: "ai", piloting: "ai", live: "ok", paused: "wait", retired: "plain" };
export const STAGE_HINT: Record<Stage, string> = {
  approved: "Signed, not started. Move it to Building or Piloting when work begins.",
  building: "Being built or configured. Nobody relies on it yet.",
  piloting: "In use by a few, watched closely.",
  live: "In use. It comes back for review on its due date.",
  paused: "Stopped for now, by a person or by a review that was not renewed.",
  retired: "Finished. Stays on the record; cannot be moved again.",
};

/** Where an intake status sits before a life begins. */
export const INTAKE_WORDS: Record<string, string> = {
  submitted: "Waiting for review", in_review: "With the committee", recommended: "Waiting for a decision", rejected: "Not approved", approved: "Approved",
};

export function isOverdue(reviewDue: string | null, today: string): boolean {
  return Boolean(reviewDue) && (reviewDue as string) <= today;
}

export function dueSoon(reviewDue: string | null, today: string, days = 30): boolean {
  if (!reviewDue || isOverdue(reviewDue, today)) return false;
  const gap = (new Date(reviewDue).getTime() - new Date(today).getTime()) / 86_400_000;
  return gap <= days;
}
