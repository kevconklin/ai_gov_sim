import type { ReactNode } from "react";
import type { CsvRow } from "@/lib/csv";
import { CsvButton } from "./csv-button";
import { Panel } from "./ui";

/** Every chart goes through this wrapper so it always has a CSV download. */
export function ChartPanel({ title, csvRows, csvName, children, className }: { title: ReactNode; csvRows: CsvRow[]; csvName: string; children: ReactNode; className?: string }) {
  return (
    <Panel title={title} actions={<CsvButton rows={csvRows} filename={csvName} />} className={className}>
      {children}
    </Panel>
  );
}
