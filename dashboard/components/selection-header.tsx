import type { ReactNode } from "react";
import { href, type SearchParams } from "@/lib/params";
import type { RunRow, Selection } from "@/lib/queries/runs";
import { BANK_LABELS } from "@/lib/constants";
import { RunSelector } from "./run-selector";
import { Empty, PageHeader, TabLinks } from "./ui";

export function SelectionHeader({ title, subtitle, sel, children }: { title: string; subtitle?: ReactNode; sel: Selection; children?: ReactNode }) {
  return (
    <PageHeader title={title} subtitle={subtitle}>
      {children}
      <RunSelector experiments={sel.experiments} replicates={sel.replicates} experimentId={sel.experimentId} replicate={sel.replicate} />
    </PageHeader>
  );
}

export function BankTabs({ path, sp, sel, current, reset = [] }: { path: string; sp: SearchParams; sel: Selection; current: RunRow; reset?: string[] }) {
  const cleared = Object.fromEntries(reset.map((k) => [k, null]));
  return (
    <TabLinks
      items={sel.runs.map((r) => ({
        href: href(path, sp, { ...cleared, bank: r.bank_id }),
        label: `${BANK_LABELS[r.bank_id] ?? r.bank_id} (${r.condition})`,
        active: r.run_id === current.run_id,
      }))}
    />
  );
}

export function NoRuns() {
  return <Empty>No runs found. Seed dev data with `npm run seed:dev` or point DATABASE_URL at a database with runs.</Empty>;
}
