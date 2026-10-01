import { currentUser } from "@/lib/auth/session";
import { membershipsFor, userById } from "@/lib/auth/users";
import { ROLE_WORDS } from "@/lib/auth/roles";
import { first, type SearchParams } from "@/lib/params";
import { readDb } from "@/lib/db";
import { Chip } from "../reviews/parts";
import { AccountForms } from "../reviews/people-forms";

export default async function AccountPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const me = await currentUser();
  if (!me) return null;
  const user = await userById(me.user_id);
  const memberships = await membershipsFor(me.user_id);
  const db = await readDb();
  const names = memberships.length
    ? await db.all<{ run_id: string; name: string }>(`SELECT run_id, name FROM org_profiles WHERE run_id IN (${memberships.map(() => "?").join(", ")})`, memberships.map((m) => m.run_id))
    : [];
  const nameOf = new Map(names.map((n) => [n.run_id, n.name]));
  return (
    <div className="rv">
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="rv-org">Your account</h1><Chip plain>{me.email}</Chip>{me.role === "operator" ? <Chip tone="ai">Operator</Chip> : null}</div>
      </header>
      <section className="rv-card">
        <div className="rv-card-h">Where you may act</div>
        {me.role === "operator" ? <p className="rv-prose">You run the service: every organization, setup, the logs, and the research bench.</p>
          : memberships.length ? (
            <ul className="rv-list">{memberships.map((m) => <li key={m.run_id}><strong>{nameOf.get(m.run_id) ?? m.run_id}</strong>: {ROLE_WORDS[m.role]}</li>)}</ul>
          ) : <p className="rv-prose muted">No organization yet. Ask the person who runs governance to add you.</p>}
      </section>
      <AccountForms name={user?.name ?? me.name} first={first(sp, "first") === "1" || Boolean(user?.must_change)} />
    </div>
  );
}
