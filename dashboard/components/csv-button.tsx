"use client";

import { safeFilename, toCsv, type CsvRow } from "@/lib/csv";

export function CsvButton({ rows, filename, columns, label = "Download CSV" }: { rows: CsvRow[]; filename: string; columns?: string[]; label?: string }) {
  const download = () => {
    const blob = new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFilename(filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <button type="button" className="btn text-xs" onClick={download} disabled={rows.length === 0}>
      {label}
    </button>
  );
}
