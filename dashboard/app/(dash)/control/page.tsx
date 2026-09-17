import { PageHeader, Panel } from "@/components/ui";
import { BANK_LABELS } from "@/lib/constants";
import { checkpoints, pendingCommands, processedCommands, recentInterventions } from "@/lib/queries/control";
import { listAllRuns } from "@/lib/queries/runs";
import { CommandForm, InterventionForm } from "./command-form";
import { CheckpointsTable, CommandsTable, InterventionsTable, RunsTable } from "./tables";

export default async function ControlPage() {
  const [runs, pending, processed, interventions, ckpts] = await Promise.all([
    listAllRuns(),
    pendingCommands(),
    processedCommands(),
    recentInterventions(),
    checkpoints(),
  ]);
  const runOptions = runs.map((r) => ({
    run_id: r.run_id,
    label: `${r.run_id} · ${BANK_LABELS[r.bank_id] ?? r.bank_id} · rep ${r.replicate} · ${r.status}`,
  }));

  return (
    <>
      <PageHeader title="Control" subtitle="Actions queue a pending command for the worker and write an intervention record. Real timestamps are UTC." />
      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel title="Run command">
          {runOptions.length === 0 ? <p className="muted">No runs available.</p> : <CommandForm runs={runOptions} />}
        </Panel>
        <Panel title="Log an intervention (no command)">
          <InterventionForm runs={runOptions} />
        </Panel>
      </div>
      <div className="flex flex-col gap-3">
        <Panel title={`Runs (${runs.length})`}><RunsTable runs={runs} /></Panel>
        <Panel title={`Pending commands (${pending.length})`}><CommandsTable rows={pending} /></Panel>
        <Panel title={`Processed commands (${processed.length})`}><CommandsTable rows={processed} /></Panel>
        <Panel title={`Interventions (${interventions.length})`}><InterventionsTable rows={interventions} /></Panel>
        <Panel title={`Checkpoints (${ckpts.length})`}><CheckpointsTable rows={ckpts} /></Panel>
      </div>
    </>
  );
}
