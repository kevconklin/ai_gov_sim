import { diffLines, diffWords } from "diff";

export function PolicyDiff({ before, after, mode }: { before: string; after: string; mode: "lines" | "words" }) {
  if (mode === "words") {
    const parts = diffWords(before, after);
    return (
      <pre className="code">
        {parts.map((p, i) => (
          <span key={i} style={p.added ? { background: "var(--diff-add)" } : p.removed ? { background: "var(--diff-del)", textDecoration: "line-through" } : undefined}>
            {p.value}
          </span>
        ))}
      </pre>
    );
  }
  const lines: { sign: string; text: string }[] = [];
  for (const part of diffLines(before, after)) {
    const sign = part.added ? "+" : part.removed ? "-" : " ";
    const body = part.value.endsWith("\n") ? part.value.slice(0, -1) : part.value;
    for (const line of body.split("\n")) lines.push({ sign, text: line });
  }
  return (
    <pre className="code" style={{ whiteSpace: "pre-wrap" }}>
      {lines.map((l, i) => (
        <div key={i} style={l.sign === "+" ? { background: "var(--diff-add)" } : l.sign === "-" ? { background: "var(--diff-del)" } : { opacity: 0.75 }}>
          <span className="muted select-none">{l.sign} </span>
          {l.text}
        </div>
      ))}
    </pre>
  );
}
