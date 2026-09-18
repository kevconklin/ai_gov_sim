import { BankTabs, NoRuns, SelectionHeader } from "@/components/selection-header";
import { Chip, Empty, Panel, Stat, TableWrap } from "@/components/ui";
import type { SearchParams } from "@/lib/params";
import {
  awaitingAttestation,
  dissentsAwaiting,
  latestCandidates,
  recentAttestations,
  recentSyntheses,
} from "@/lib/queries/governance";
import { pickRun, resolveSelection } from "@/lib/queries/runs";
import { AttestForm, ConveneForm, RefreshCandidates, type Candidate } from "./forms";

function list(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function checks(raw: string): [string, string][] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as [string, string][]) : [];
  } catch {
    return [];
  }
}

/** The advisory question, which lives in the meeting's agenda rather than on the synthesis. */
function titleOf(agenda: string, itemId: string): string | null {
  try {
    const parsed = JSON.parse(agenda);
    if (!Array.isArray(parsed)) return null;
    const hit = parsed.find((i) => (i as { item_id?: string })?.item_id === itemId);
    const title = (hit as { title?: unknown })?.title;
    return typeof title === "string" ? title : null;
  } catch {
    return null;
  }
}

function candidatesFrom(result: unknown): Candidate[] {
  const list = (result as { candidates?: unknown })?.candidates;
  return Array.isArray(list) ? (list as Candidate[]) : [];
}

export default async function GovernancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sel = await resolveSelection(sp);
  const run = pickRun(sel, sp);
  if (!run) return <><SelectionHeader title="Governance" sel={sel} /><NoRuns /></>;

  const [awaiting, dissents, syntheses, attested, ranked] = await Promise.all([
    awaitingAttestation(run.run_id),
    dissentsAwaiting(run.run_id),
    recentSyntheses(run.run_id),
    recentAttestations(run.run_id),
    latestCandidates(run.run_id),
  ]);

  const candidates = candidatesFrom(ranked?.result);
  const overrides = attested.filter((a) => a.outcome !== a.recommended).length;

  return (
    <>
      <SelectionHeader
        title="Governance"
        subtitle="The committee recommends. Nothing takes effect until a person is on record for it."
        sel={sel}
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <BankTabs path="/governance" sp={sp} sel={sel} current={run} />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Awaiting attestation" value={awaiting.length} hint="Queue depth is the health signal" />
        <Stat label="Attested" value={attested.length} />
        <Stat
          label="Overridden"
          value={attested.length ? `${overrides} of ${attested.length}` : "—"}
          hint={attested.length && overrides === 0 ? "Zero overrides can mean rubber-stamping" : undefined}
        />
        <Stat label="Advisory items heard" value={syntheses.length} />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel
          title="Agenda candidates"
          actions={ranked ? <span className="muted text-xs">ranked {ranked.at}</span> : null}
        >
          <p className="muted mb-2 text-xs">
            Priority is computed by the worker from config/agenda_priority.yaml and is never shown to the committee,
            which would anchor their positions. Agents see the item, not the score.
          </p>
          {candidates.length === 0 ? (
            <Empty>No ranking yet. Re-rank to build one.</Empty>
          ) : (
            <TableWrap>
              <table>
                <thead>
                  <tr><th>Item</th><th>Kind</th><th>Priority</th><th>Why</th><th>Deferred</th></tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.ref_id}>
                      <td>{c.title}</td>
                      <td>{c.kind}</td>
                      <td>{c.escalated ? <Chip color="var(--c-sev-high)">{c.priority} escalated</Chip> : c.priority}</td>
                      <td className="muted">{c.reasons.join(", ")}</td>
                      <td>{c.deferrals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <div className="mt-2"><RefreshCandidates runId={run.run_id} /></div>
        </Panel>

        <Panel title="Call a meeting">
          <ConveneForm runId={run.run_id} candidates={candidates} />
        </Panel>
      </div>

      <div className="flex flex-col gap-3">
        <Panel title={`Awaiting attestation (${awaiting.length})`}>
          {awaiting.length === 0 ? (
            <Empty>Nothing is waiting on a person.</Empty>
          ) : (
            <div className="flex flex-col gap-4">
              {awaiting.map((row) => (
                <div key={row.decision_id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{row.item_id}</strong>
                    <span className="muted">{row.kind} · {row.sim_month}</span>
                    <Chip color={row.recommended === "approved" ? "var(--c-sev-low)" : "var(--c-sev-med)"}>
                      committee: {row.recommended}
                    </Chip>
                    <span className="muted">
                      {row.yes_votes} yes · {row.no_votes} no · {row.abstentions} abstaining
                    </span>
                    {row.risk_tier ? <Chip>risk {row.risk_tier}</Chip> : null}
                  </div>
                  <AttestForm
                    runId={run.run_id}
                    row={row}
                    dissents={dissents.filter((d) => d.decision_id === row.decision_id)}
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={`Advisory items (${syntheses.length})`}>
          {syntheses.length === 0 ? (
            <Empty>No advisory items have been heard.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {syntheses.map((s) => (
                <div key={s.synthesis_id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{titleOf(s.agenda, s.item_id) ?? s.item_id}</strong>
                    <span className="muted">{s.item_id} · {s.sim_month}</span>
                    {s.split ? <Chip color="var(--c-sev-med)">divided · spread {s.spread}</Chip> : <Chip>agreed</Chip>}
                  </div>
                  <p className="muted text-xs">
                    For: {list(s.for_seats).join(", ") || "none"} · Against: {list(s.against_seats).join(", ") || "none"}
                    {" "}· Undecided: {list(s.undecided_seats).join(", ") || "none"}
                  </p>
                  {s.narrative ? <p>{s.narrative}</p> : null}
                  <p className="muted mt-1 text-xs">What would change each mind:</p>
                  <ul className="list-disc pl-5">
                    {checks(s.checks).map(([seat, what]) => <li key={seat}><strong>{seat}</strong>: {what}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={`On record (${attested.length})`}>
          {attested.length === 0 ? (
            <Empty>No attestations yet.</Empty>
          ) : (
            <TableWrap>
              <table>
                <thead>
                  <tr><th>Item</th><th>Committee</th><th>Person</th><th>Who</th><th>Reasoning</th><th>When</th></tr>
                </thead>
                <tbody>
                  {attested.map((a) => (
                    <tr key={a.attestation_id}>
                      <td>{a.item_id}</td>
                      <td className="muted">{a.recommended}</td>
                      <td>
                        {a.outcome !== a.recommended
                          ? <Chip color="var(--c-sev-high)">{a.outcome} · override</Chip>
                          : a.outcome}
                      </td>
                      <td>{a.actor}</td>
                      <td>{a.rationale}</td>
                      <td className="muted">{a.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
      </div>
    </>
  );
}
