import { METRICS } from "@/lib/metrics-catalog";

const GROUPS = ["decisions", "policy", "outcomes", "behavior", "operations"] as const;

export function MetricPicker({ selected, band, dim, experimentId, replicate }: { selected: string[]; band: string; dim: string; experimentId: string; replicate: number | null }) {
  const allDims = [...new Set(METRICS.flatMap((m) => m.dims))];
  return (
    <details className="panel p-3" open={false}>
      <summary className="cursor-pointer font-semibold">Metrics ({selected.length} selected) and band options</summary>
      <form method="get" className="mt-2 flex flex-col gap-3">
        <input type="hidden" name="exp" value={experimentId} />
        {replicate !== null ? <input type="hidden" name="rep" value={replicate} /> : null}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {GROUPS.map((g) => (
            <fieldset key={g}>
              <legend className="muted mb-1 capitalize">{g}</legend>
              {METRICS.filter((m) => m.group === g).map((m) => (
                <label key={m.name} className="flex items-center gap-1">
                  <input type="checkbox" name="m" value={m.name} defaultChecked={selected.includes(m.name)} />
                  <span>{m.label}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1">
            <span className="muted">Band</span>
            <select className="field" name="band" defaultValue={band}>
              <option value="minmax">Min-max across replicates</option>
              <option value="boot">95% bootstrap CI</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="muted">Dimension</span>
            <select className="field" name="dim" defaultValue={dim}>
              <option value="">Default (collapse per metric rule)</option>
              {allDims.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" type="submit">Apply</button>
        </div>
      </form>
    </details>
  );
}
