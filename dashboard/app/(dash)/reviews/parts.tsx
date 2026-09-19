import Link from "next/link";
import type { ReactNode } from "react";
import { initials, KIND_LABELS, seatCode, seatColor, type BenchSeat } from "@/lib/reviews/model";

const PATHS: Record<string, ReactNode> = {
  inbox: <><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M5.5 5h13l2.5 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M2.8 19c.6-3.3 3.1-5 6.2-5s5.6 1.7 6.2 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.2c2.4.2 4.1 1.7 4.7 4.3" /></>,
  pen: <><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" /><path d="M14.5 6.5l3 3" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16.5 9.5" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  x: <><path d="M6 6l12 12M18 6L6 18" /></>,
  chevron: <><path d="M9 6l6 6-6 6" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></>,
};

export function Icon({ name, className, style }: { name: keyof typeof PATHS | string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden className={className} style={style} width="18" height="18">
      {PATHS[name]}
    </svg>
  );
}

export function Chip({ tone, children, plain, solid, dot }: { tone?: string; children: ReactNode; plain?: boolean; solid?: boolean; dot?: boolean }) {
  return <span className={`rv-chip${plain ? " is-plain" : ""}${solid ? " is-solid" : ""}${dot ? " has-dot" : ""}`} data-tone={tone}>{children}</span>;
}

export function RiskChip({ tier }: { tier: string | null }) {
  if (!tier) return <Chip plain>Not rated</Chip>;
  return <Chip tone={tier} dot>{tier[0]!.toUpperCase() + tier.slice(1)} risk</Chip>;
}

export function KindChip({ kind }: { kind: string }) {
  return <Chip plain>{KIND_LABELS[kind] ?? kind.replace(/_/g, " ")}</Chip>;
}

/** The ballot in one line: green for, red against, grey abstained. */
export function VoteBar({ yes, no, abstain = 0 }: { yes: number; no: number; abstain?: number }) {
  const total = Math.max(1, yes + no + abstain);
  return (
    <span className="rv-votes" title={`${yes} for, ${no} against${abstain ? `, ${abstain} abstained` : ""}`}>
      <span className="rv-votes-track">
        <span className="rv-votes-yes" style={{ width: `${(yes / total) * 100}%` }} />
        <span className="rv-votes-no" style={{ width: `${(no / total) * 100}%` }} />
        <span className="rv-votes-abstain" style={{ width: `${(abstain / total) * 100}%` }} />
      </span>
      {yes}–{no}
    </span>
  );
}

export function Avatar({ name, seat, index, vote, large, you }: { name: string; seat?: string; index?: number; vote?: string; large?: boolean; you?: boolean }) {
  const code = seat ? seatCode(seat) : initials(name);
  return (
    <span className={`rv-avatar${large ? " is-lg" : ""}${you ? " is-you" : ""}${code.length > 2 ? " is-tight" : ""}`} data-vote={vote} title={name}
      style={index === undefined ? undefined : ({ "--seat": seatColor(index) } as React.CSSProperties)}>
      {code}
    </span>
  );
}

/** Every seat, in speaking order, ringed by how it voted. Hover or focus a seat for its name. */
export function SeatVotes({ bench }: { bench: BenchSeat[] }) {
  const words: Record<string, string> = { yes: "for", no: "against", abstain: "abstained", absent: "did not sit" };
  return (
    <div className="rv-seatvotes">
      {bench.map((seat, i) => (
        <span key={seat.seat} className="grid justify-items-center gap-1">
          <Avatar name={seat.title} seat={seat.seat} index={i} vote={seat.vote} />
          <span className="muted text-center" style={{ fontSize: 10.5, lineHeight: 1.2 }}>{words[seat.vote]}</span>
        </span>
      ))}
    </div>
  );
}

/** A small "?" that opens an explanation, so the explanation is not on the page until asked for. */
export function Help({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <details className="rv-pop inline-block align-middle">
      <summary aria-label="What is this?"><span className="rv-help">?</span></summary>
      <div className={`rv-pop-card${right ? " is-right" : ""}`}>{children}</div>
    </details>
  );
}

export function Fold({ title, tone, open, children, lead, aside }: { title: ReactNode; tone?: string; open?: boolean; children: ReactNode; lead?: ReactNode; aside?: ReactNode }) {
  return (
    <details className="rv-fold" data-tone={tone} open={open}>
      <summary className="rv-fold-head">{lead}<span className="min-w-0 flex-1 truncate">{title}</span>{aside}<Icon name="chevron" className="rv-chev" style={{ marginLeft: 0 }} /></summary>
      <div className="rv-fold-body">{children}</div>
    </details>
  );
}

export function Drawer({ closeHref, chips, title, children, wide }: { closeHref: string; chips?: ReactNode; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <>
      <div className="rv-scrim"><Link href={closeHref} scroll={false} aria-label="Close" tabIndex={-1} /></div>
      <aside className={`rv-drawer${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="rv-drawer-head">
          <div className="min-w-0">
            {chips ? <div className="flex flex-wrap items-center gap-1.5">{chips}</div> : null}
            <h2 className="rv-drawer-title">{title}</h2>
          </div>
          <Link href={closeHref} scroll={false} className="rv-close" aria-label="Close"><Icon name="x" /></Link>
        </header>
        <div className="rv-drawer-body">{children}</div>
      </aside>
    </>
  );
}
