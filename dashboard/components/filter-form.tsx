import type { ReactNode } from "react";
import { AutoSubmitSelect } from "./auto-submit-select";

export interface FilterField {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}

/** Server-rendered GET form; selects auto-submit, hidden inputs keep other params. */
export function FilterForm({ fields, keep, children }: { fields: FilterField[]; keep: Record<string, string | undefined>; children?: ReactNode }) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {fields.map((f) => (
        <label key={f.name} className="flex items-center gap-1">
          <span className="muted">{f.label}</span>
          <AutoSubmitSelect name={f.name} defaultValue={f.value} options={f.options} />
        </label>
      ))}
      {children}
      <noscript>
        <button className="btn" type="submit">Apply</button>
      </noscript>
    </form>
  );
}
