"use client";

import { useActionState } from "react";
import { ORG_ROLES, ROLE_HELP, ROLE_WORDS, type OrgRole } from "@/lib/auth/roles";
import { changeNameAction, changePasswordAction, inviteMemberAction, inviteOperatorAction, removeMemberAction, resetPasswordAction, setDisabledAction, type PeopleResult } from "./people-actions";

function Said({ state }: { state: PeopleResult | null }) {
  if (!state) return null;
  if (!state.success) return <p className="rv-said is-bad" role="alert">{state.error}</p>;
  return (
    <div className="rv-said is-ok" role="status">
      <p>{state.message}</p>
      {state.temporary_password ? (
        <p className="rv-secret"><span className="muted">Sign in as</span> <code>{state.email}</code> <span className="muted">with</span> <code>{state.temporary_password}</code></p>
      ) : null}
    </div>
  );
}

export function InviteForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(inviteMemberAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <div className="rv-grid2">
        <label><span className="rv-label">Name</span><input className="rv-field" name="name" required minLength={2} maxLength={200} placeholder="Lee Park" /></label>
        <label><span className="rv-label">Email</span><input className="rv-field" type="email" name="email" required maxLength={200} placeholder="lee@harbor.example" /></label>
      </div>
      <fieldset>
        <legend className="rv-label">What may they do?</legend>
        <div className="rv-choices is-stack" role="radiogroup">
          {ORG_ROLES.map((r: OrgRole) => (
            <label key={r} className="rv-choice is-card" data-tone="you">
              <input type="radio" name="role" value={r} defaultChecked={r === "asks"} />
              <span className="rv-choice-title">{ROLE_WORDS[r]}</span>
              <span className="rv-choice-text">{ROLE_HELP[r]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label><span className="rv-label">Why?</span><input className="rv-field" name="why" required minLength={10} placeholder="Heads member services from October" /></label>
      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending || Boolean(state?.success)}>{pending ? "Adding…" : "Add person"}</button></div>
      <Said state={state} />
      {!state ? <p className="rv-hint">A new email gets an account with a temporary password, shown to you once. Hand it over; they change it at first sign-in.</p> : null}
    </form>
  );
}

export function RemoveMemberForm({ runId, userId, name }: { runId: string; userId: string; name: string }) {
  const [state, action, pending] = useActionState(removeMemberAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="user_id" value={userId} />
      <label><span className="rv-label">Why remove {name}?</span><input className="rv-field" name="why" required minLength={10} placeholder="Left the organization" /></label>
      <div><button className="rv-btn" type="submit" disabled={pending || Boolean(state?.success)}>{pending ? "Removing…" : "Remove from this organization"}</button></div>
      <p className="rv-hint">Their account stays; anything they signed keeps their name. They lose access to this organization only.</p>
      <Said state={state} />
    </form>
  );
}

export function InviteOperatorForm() {
  const [state, action, pending] = useActionState(inviteOperatorAction, null);
  return (
    <form action={action} className="grid gap-3">
      <div className="rv-grid2">
        <label><span className="rv-label">Name</span><input className="rv-field" name="name" required minLength={2} maxLength={200} /></label>
        <label><span className="rv-label">Email</span><input className="rv-field" type="email" name="email" required maxLength={200} /></label>
      </div>
      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending || Boolean(state?.success)}>{pending ? "Adding…" : "Add operator"}</button></div>
      <p className="rv-hint">An operator runs the service: every organization, the setup wizard, the logs, and the research bench. Add one only for someone who runs governance for all of them.</p>
      <Said state={state} />
    </form>
  );
}

export function AccountForms({ name, first }: { name: string; first: boolean }) {
  const [pw, pwAction, pwPending] = useActionState(changePasswordAction, null);
  const [nm, nmAction, nmPending] = useActionState(changeNameAction, null);
  return (
    <div className="grid gap-4">
      <section className="rv-card" data-tone={first ? "you" : undefined}>
        <div className="rv-card-h">{first ? "Choose your own password" : "Change your password"}</div>
        {first ? <p className="rv-hint" style={{ marginTop: 0 }}>You signed in with a temporary password. Pick your own now.</p> : null}
        <form action={pwAction} className="grid gap-3">
          <label><span className="rv-label">Current password</span><input className="rv-field" type="password" name="current" autoComplete="current-password" required /></label>
          <div className="rv-grid2">
            <label><span className="rv-label">New password</span><input className="rv-field" type="password" name="password" autoComplete="new-password" required minLength={12} /></label>
            <label><span className="rv-label">Again</span><input className="rv-field" type="password" name="again" autoComplete="new-password" required minLength={12} /></label>
          </div>
          <div><button className="rv-btn rv-btn-you" type="submit" disabled={pwPending}>{pwPending ? "Saving…" : "Change password"}</button></div>
          <Said state={pw} />
        </form>
      </section>
      <section className="rv-card">
        <div className="rv-card-h">Your name</div>
        <form action={nmAction} className="grid gap-3">
          <label><span className="rv-label">As it appears on the record</span><input className="rv-field" name="name" defaultValue={name} required minLength={2} maxLength={200} /></label>
          <div><button className="rv-btn" type="submit" disabled={nmPending}>{nmPending ? "Saving…" : "Change name"}</button></div>
          <Said state={nm} />
        </form>
      </section>
    </div>
  );
}

export function AccountAdmin({ userId, name, disabled, isSelf }: { userId: string; name: string; disabled: boolean; isSelf: boolean }) {
  const [reset, resetAction, resetPending] = useActionState(resetPasswordAction, null);
  const [flip, flipAction, flipPending] = useActionState(setDisabledAction, null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={resetAction}><input type="hidden" name="user_id" value={userId} /><button className="rv-btn rv-btn-sm" type="submit" disabled={resetPending || Boolean(reset?.success)}>{resetPending ? "Resetting…" : "Reset password"}</button></form>
      {!isSelf ? <form action={flipAction}><input type="hidden" name="user_id" value={userId} /><input type="hidden" name="disabled" value={disabled ? "0" : "1"} /><button className="rv-btn rv-btn-sm" type="submit" disabled={flipPending}>{flipPending ? "…" : disabled ? "Restore" : "Disable"}</button></form> : null}
      {reset ? <div className="w-full"><Said state={reset} /></div> : null}
      {flip ? <div className="w-full"><Said state={flip} /></div> : null}
      <span className="sr-only">{name}</span>
    </div>
  );
}
