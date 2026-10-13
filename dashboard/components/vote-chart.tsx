import type { ReviewVotes, SeatVoteRow } from "@/lib/queries/votes";

function leaning(support: number | null): { word: string; side: "yes" | "no" | "mid" | null } {
  if (support == null) return { word: "", side: null };
  if (support <= 2) return { word: support === 1 ? "leaned firmly against" : "leaned against", side: "no" };
  if (support >= 4) return { word: support === 5 ? "leaned firmly for" : "leaned for", side: "yes" };
  return { word: "undecided before the debate", side: "mid" };
}

function Strength({ n, vote }: { n: number | null; vote: "yes" | "no" }) {
  if (n == null) return null;
  return (
    <span className="rv-vt-strength" data-vote={vote} title={`${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} data-on={i <= n ? "" : undefined} />)}
      <b>{n}/5</b>
    </span>
  );
}

function Seat({ s }: { s: SeatVoteRow }) {
  const lean = leaning(s.support);
  const moved = lean.side && lean.side !== "mid" && (s.vote === "yes" || s.vote === "no") && lean.side !== s.vote;
  return (
    <li className="rv-vt-seat" title={s.rationale ?? undefined}>
      <span className="rv-vt-name">{s.title}</span>
      {s.vote === "yes" || s.vote === "no" ? <Strength n={s.strength} vote={s.vote} /> : null}
      {lean.word ? <span className="rv-vt-lean" data-moved={moved ? "" : undefined}>{lean.word}{moved ? " · changed mind" : ""}</span> : null}
    </li>
  );
}

function Column({ title, seats, vote }: { title: string; seats: SeatVoteRow[]; vote: "yes" | "no" | "abstain" }) {
  const sorted = [...seats].sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
  return (
    <div className="rv-vt-col" data-vote={vote}>
      <h4 className="rv-vt-colh"><span>{title}</span><b>{seats.length}</b></h4>
      {sorted.length ? <ul className="rv-vt-list">{sorted.map((s) => <Seat key={s.seat} s={s} />)}</ul> : <p className="rv-vt-none">Nobody</p>}
    </div>
  );
}

/** How the votes went on one matter, one block per review: the split as a bar, then who was on each
 *  side, how strongly (1 to 5), and whether they came in leaning the other way. */
export function VoteChart({ reviews }: { reviews: ReviewVotes[] }) {
  if (!reviews.length) return null;
  return (
    <div className="rv-vt">
      {reviews.map((r, i) => {
        const total = Math.max(1, r.yes + r.no + r.abstain);
        const yes = r.seats.filter((s) => s.vote === "yes"), no = r.seats.filter((s) => s.vote === "no"), abstain = r.seats.filter((s) => s.vote === "abstain");
        const result = r.recommended === "approved" ? "Recommended approve" : "Recommended reject";
        const signed = r.signed ? (r.signed === "deferred" ? "You sent it back" : `You signed ${r.signed}`) : null;
        const unscored = r.seats.every((s) => s.strength == null);   // a review held before ballots carried strength
        return (
          <section key={r.meeting_id} className="rv-vt-review">
            <header className="rv-vt-h">
              <span className="rv-vt-when">{reviews.length > 1 ? `Review ${i + 1} of ${reviews.length}` : "Review"}, {r.meeting_date}{r.debate_skipped ? " (seats agreed, no debate)" : ""}{unscored ? " · strengths not recorded in this review" : ""}</span>
              <span className="rv-vt-result" data-vote={r.recommended === "approved" ? "yes" : "no"}>{result}{signed ? <span className="rv-vt-signed"> · {signed}</span> : null}</span>
            </header>
            <div className="rv-vt-bar" role="img" aria-label={`${r.yes} for, ${r.no} against${r.abstain ? `, ${r.abstain} abstained` : ""}`}>
              {r.yes ? <span data-vote="yes" style={{ flexBasis: `${(r.yes / total) * 100}%` }}>{r.yes} for</span> : null}
              {r.abstain ? <span data-vote="abstain" style={{ flexBasis: `${(r.abstain / total) * 100}%` }}>{r.abstain} abstained</span> : null}
              {r.no ? <span data-vote="no" style={{ flexBasis: `${(r.no / total) * 100}%` }}>{r.no} against</span> : null}
            </div>
            <div className="rv-vt-cols">
              <Column title="For" seats={yes} vote="yes" />
              <Column title="Against" seats={no} vote="no" />
              {abstain.length ? <Column title="Abstained" seats={abstain} vote="abstain" /> : null}
            </div>
          </section>
        );
      })}
      <p className="rv-vt-legend">Strength is how firmly each seat holds its ballot, 1 to 5. “Leaned” is the seat's sealed view before the debate; “changed mind” means the debate moved it to the other side.</p>
    </div>
  );
}
