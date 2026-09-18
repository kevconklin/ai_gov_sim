import { tally, type BenchSeat } from "@/lib/reviews/model";

/**
 * The committee as it sat on one decision: one mark per seat, in speaking order.
 * Shape says how the seat voted; plum says it voted against the way the matter carried.
 * A dashed ring is a seat that did not sit on this panel.
 */
function Seat({ seat }: { seat: BenchSeat }) {
  const words = { yes: "voted for", no: "voted against", abstain: "abstained", absent: "did not sit on this panel" }[seat.vote];
  const fill = seat.dissent ? "rv-seat-dissent" : "rv-seat-with";
  return (
    <svg viewBox="0 0 18 18" role="img" aria-label={`${seat.title} ${words}`}>
      <title>{`${seat.title} ${words}`}</title>
      {seat.vote === "absent" ? <circle cx="9" cy="9" r="6.5" className="rv-seat-absent" /> : null}
      {seat.vote === "abstain" ? <circle cx="9" cy="9" r="6.5" className="rv-seat-ring" /> : null}
      {seat.vote === "yes" ? <circle cx="9" cy="9" r="7.5" className={fill} /> : null}
      {seat.vote === "no" ? (
        <>
          <circle cx="9" cy="9" r="7.5" className={fill} />
          <line x1="5.5" y1="9" x2="12.5" y2="9" className="rv-seat-mark" />
        </>
      ) : null}
    </svg>
  );
}

export function Bench({ bench }: { bench: BenchSeat[] }) {
  const t = tally(bench);
  const parts = [`${t.yes} for`, `${t.no} against`];
  if (t.abstain) parts.push(`${t.abstain} abstained`);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="rv-bench">{bench.map((seat) => <Seat key={seat.seat} seat={seat} />)}</span>
      <span className="rv-tally">
        {parts.join(", ")}
        {t.sat < t.of ? `. ${t.sat} of ${t.of} seats sat.` : "."}
      </span>
    </span>
  );
}
