"use client";

export function AutoSubmitSelect({ name, defaultValue, options }: { name: string; defaultValue: string; options: { value: string; label: string }[] }) {
  return (
    <select className="field" name={name} defaultValue={defaultValue} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
