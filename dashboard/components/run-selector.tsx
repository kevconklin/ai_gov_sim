"use client";

export interface ExperimentOption {
  experiment_id: string;
  name: string;
}

/** GET form: changing a select reloads the page with the new experiment/replicate. */
export function RunSelector({
  experiments,
  replicates,
  experimentId,
  replicate,
  keep = {},
}: {
  experiments: ExperimentOption[];
  replicates: number[];
  experimentId: string | null;
  replicate: number | null;
  keep?: Record<string, string>;
}) {
  const submit = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const form = e.currentTarget.form;
    if (!form) return;
    if (e.currentTarget.name === "exp") {
      const rep = form.elements.namedItem("rep");
      if (rep instanceof HTMLSelectElement) rep.disabled = true;
    }
    form.requestSubmit();
  };
  return (
    <form method="get" className="flex items-center gap-2">
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="flex items-center gap-1">
        <span className="muted">Experiment</span>
        <select className="field" name="exp" defaultValue={experimentId ?? ""} onChange={submit}>
          {experiments.map((e) => (
            <option key={e.experiment_id} value={e.experiment_id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="muted">Replicate</span>
        <select className="field" name="rep" defaultValue={replicate ?? ""} onChange={submit}>
          {replicates.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <noscript>
        <button className="btn" type="submit">Go</button>
      </noscript>
    </form>
  );
}
