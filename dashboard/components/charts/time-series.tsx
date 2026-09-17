"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
}

export interface Marker {
  x: string | number;
  label: string;
  color: string;
}

export type ChartRow = Record<string, string | number | null>;

export function TimeSeriesChart({
  data,
  xKey,
  series,
  markers = [],
  height = 220,
  referenceY,
  step = false,
  yDomain,
  xLabel,
}: {
  data: ChartRow[];
  xKey: string;
  series: SeriesDef[];
  markers?: Marker[];
  height?: number;
  referenceY?: { y: number; label: string; color?: string }[];
  step?: boolean;
  yDomain?: [number | "auto", number | "auto"];
  xLabel?: string;
}) {
  if (data.length === 0) return <p className="muted italic">No data.</p>;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: xLabel ? 14 : 0, left: 0 }}>
          <CartesianGrid stroke="var(--c-grid)" strokeDasharray="3 3" />
          <XAxis dataKey={xKey} stroke="var(--muted)" fontSize={11} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -8, fill: "var(--muted)", fontSize: 11 } : undefined} />
          <YAxis stroke="var(--muted)" fontSize={11} width={56} domain={yDomain ?? ["auto", "auto"]} />
          <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", fontSize: 12 }} labelStyle={{ color: "var(--text)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {markers.map((m, i) => (
            <ReferenceLine key={`m${i}`} x={m.x} stroke={m.color} strokeDasharray="2 3" label={{ value: m.label, position: "insideTopLeft", fill: m.color, fontSize: 10 }} />
          ))}
          {(referenceY ?? []).map((r, i) => (
            <ReferenceLine key={`r${i}`} y={r.y} stroke={r.color ?? "var(--muted)"} strokeDasharray="4 4" label={{ value: r.label, position: "insideTopRight", fill: r.color ?? "var(--muted)", fontSize: 10 }} />
          ))}
          {series.map((s) => (
            <Line
              key={s.key}
              type={step ? "stepAfter" : "linear"}
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              dot={{ r: 2.5 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
