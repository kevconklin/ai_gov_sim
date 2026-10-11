import type { ReviewVotes, SeatVoteRow } from "@/lib/queries/votes";

const WORD: Record<string, string> = { yes: "for", no: "against", abstain: "abstained", absent: "did not sit" };

function pct(support: number): number {
  // leaning 1 (firmly against) sits at the left edge, 3 in the middle, 5 (firmly for) at the right
  return 50 + (support - 3) * 25;
}

function Row({ s }: { s: SeatVoteRow }) {
  const len = s.strength == null ? 30 : s.strength * 10;            // half the track is strength 5
  const bar = s.vote === "yes" ? { left: "50%", width: `${len}%` } : s.vote === "no" ? { left: `${50 - len}%`, width: `${len}%` } : null;
  const label = s.vote === "absent" ? WORD.absent : s.vote === "abstain" ? WORD.abstain
    : `${WORD[s.vote]}${s.strength != null ? `, ${s.strength} of 5` : ""}`;
  const moved = s.support != null && s.vote !== "absent" && ((s.support >= 4 && s.vote === "no") || (s.support <= 2 && s.vote === "yes"));
  return (
    <div className="rv-vc-row" data-vote={s.vote} title={s.rationale ?? undefined}>
      <span className="rv-vc-seat">{s.title}</span>
      <span className="rv-vc-track">
        <span className="rv-vc-mid" />
        {bar ? <span className="rv-vc-bar" data-vote={s.vote} data-unscored={s.strength == null ? "" : undefined} style={bar} /> : null}
        {s.vote === "abstain" ? <span className="rv-vc-abstain" /> : null}
        {s.support != null ? <span className="rv-vc-lean" style={{ left: `${pct(s.support)}%` }} title={`Leaning before the debate: ${s.support} of 5`} /> : null}
      </span>
      <span className="rv-vc-label">{label}{moved ? <span className="rv-vc-moved">changed mind</span> : null}</span>
    </div>
  );
}

/** How the votes went on one matter: each seat's leaning before the debate (hollow mark) and its ballot after
 *  (bar, longer the more strongly held), for every review the matter has had. */
export function VoteChart({ reviews, compact }: { reviews: ReviewVotes[]; compact?: boolean }) {
  if (!reviews.length) return null;
  return (
    <div className="rv-vc" data-compact={compact ? "" : undefined}>
      <div className="rv-vc-axis"><span>Against</span><span>For</span></div>
      {reviews.map((r, i) => (
        <section key={r.meeting_id} className="rv-vc-review">
          <header className="rv-vc-h">
            <span>{reviews.length > 1 ? `Review ${i + 1}, ` : "Review of "}{r.meeting_date}{r.debate_skipped ? ", no debate needed" : ""}</span>
            <span className="rv-vc-tally"><b data-vote="yes">{r.yes} for</b> · <b data-vote="no">{r.no} against</b>{r.abstain ? ` · ${r.abstain} abstained` : ""} · recommended {r.recommended}{r.signed ? `, signed ${r.signed === "deferred" ? "sent back" : r.signed}` : ""}</span>
          </header>
          {r.seats.map((s) => <Row key={s.seat} s={s} />)}
        </section>
      ))}
      <p className="rv-vc-legend"><span className="rv-vc-lean rv-vc-lean-inline" /> leaning before the debate (1 to 5) · <span className="rv-vc-swatch" data-vote="yes" /> for · <span className="rv-vc-swatch" data-vote="no" /> against, longer the more strongly held</p>
    </div>
  );
}
