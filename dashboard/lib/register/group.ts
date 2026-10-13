/** The approved-tools register, grouped the way staff ask about it: may I, may I not, is anyone looking at it. */

export interface RegisterEntry {
  item_id: string;
  kind: string;
  title: string;
  description: string;
  details: string | null;
  status: string;
  risk_tier: string | null;
  decided_on: string | null;
  actor: string | null;
  rationale: string | null;
  attestation_id: string | null;
}

export interface Grouped<T> {
  allowed: T[];
  notAllowed: T[];
  pending: T[];
}

export function groupRegister<T extends { status: string }>(rows: T[]): Grouped<T> {
  return {
    allowed: rows.filter((r) => r.status === "approved"),
    notAllowed: rows.filter((r) => r.status === "rejected"),
    pending: rows.filter((r) => r.status !== "approved" && r.status !== "rejected"),
  };
}

const DATA_KEYS = ["data_entered", "data_shared", "data_involved"];

/** What the submitter said it would see, from whichever detail key the kind uses. */
export function dataSeen(detailsJson: string | null): string[] {
  try {
    const d = JSON.parse(detailsJson ?? "{}") as Record<string, unknown>;
    for (const k of DATA_KEYS) {
      const v = d[k];
      if (Array.isArray(v) && v.length) return v.map(String);
    }
  } catch {
    /* no details */
  }
  return [];
}

/** A case-insensitive match on the name or the description, for the search box. */
export function matches<T extends { title: string; description: string }>(row: T, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || row.title.toLowerCase().includes(q) || row.description.toLowerCase().includes(q);
}
