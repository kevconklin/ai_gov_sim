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
