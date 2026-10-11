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
/** A control's trailing "(Framework clause)" tag, if the text carries one, split from the requirement itself. */
export function splitClause(text: string): { text: string; clause: string | null } {
  const m = /^(.*?)\s*\(((?:NIST AI RMF|ISO\/IEC 42001|EU AI Act|SR 11-7) [^()]+)\)\s*$/s.exec(text);
  return m ? { text: m[1]!, clause: m[2]! } : { text, clause: null };
}

export function listControls(policy: string): Control[] {
  const out: Control[] = [];
  const re = /\b(AI-GOV-\d{3,})\b[:\s-]*([\s\S]*?)(?=\n\s*\n|\bAI-GOV-\d{3,}\b|$)/g;
  for (const m of policy.matchAll(re)) {
    const text = (m[2] ?? "").replace(/\s+/g, " ").trim();
    if (m[1] && text) out.push({ id: m[1], text });
  }
  return out;
}

/** One section's text out of the policy, by heading, or null. Mirrors govern/policy.read_section. */
export function readSection(policy: string, heading: string): string | null {
  const re = /^## +(.+?)\s*$/gm;
  const marks: { h: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(policy))) marks.push({ h: m[1]!, start: m.index, end: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) {
    if (marks[i]!.h.toLowerCase() === heading.trim().toLowerCase()) {
      const bodyEnd = i + 1 < marks.length ? marks[i + 1]!.start : policy.length;
      return policy.slice(marks[i]!.end, bodyEnd).trim();
    }
  }
  return null;
}
