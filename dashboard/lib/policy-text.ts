export const CONTROL_ID_RE = /\bAI-GOV-\d{3,}\b/g;

export interface TextPart {
  text: string;
  control: boolean;
}

/** Split text into plain and control-id parts for highlighting. */
export function splitControls(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(CONTROL_ID_RE)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start), control: false });
    parts.push({ text: m[0], control: true });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), control: false });
  return parts;
}

export function controlDelta(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return { added: after.filter((c) => !b.has(c)), removed: before.filter((c) => !a.has(c)) };
}

export interface Control { id: string; text: string }

/**
 * One row per numbered control, in the order they appear: the id and the requirement that
 * follows it, up to the next control or blank line. Headings and prose are left out.
 */
export function listControls(policy: string): Control[] {
  const out: Control[] = [];
  const re = /\b(AI-GOV-\d{3,})\b[:\s-]*([\s\S]*?)(?=\n\s*\n|\bAI-GOV-\d{3,}\b|$)/g;
  for (const m of policy.matchAll(re)) {
    const text = (m[2] ?? "").replace(/\s+/g, " ").trim();
    if (m[1] && text) out.push({ id: m[1], text });
  }
  return out;
}
