"use client";

import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface BandSeries {
  /** Row keys: `${key}_mean` (number) and `${key}_band` ([low, high]). */
  key: string;
  label: string;
  color: string;
}

export function BandChart({ data, xKey, series, height = 240 }: { data: Record<string, unknown>[]; xKey: string; series: BandSeries[]; height?: number }) {
  if (data.length === 0) return <p className="muted italic">No data.</p>;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--c-grid)" strokeDasharray="3 3" />
          <XAxis dataKey={xKey} stroke="var(--muted)" fontSize={11} />
          <YAxis stroke="var(--muted)" fontSize={11} width={56} />
          <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", fontSize: 12 }} labelStyle={{ color: "var(--text)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {series.map((s) => (
            <Area key={`${s.key}_band`} dataKey={`${s.key}_band`} name={`${s.label} band`} stroke="none" fill={s.color} fillOpacity={0.18} isAnimationActive={false} connectNulls />
          ))}
          {series.map((s) => (
            <Line key={`${s.key}_mean`} dataKey={`${s.key}_mean`} name={`${s.label} mean`} stroke={s.color} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} connectNulls />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
