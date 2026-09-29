"use server";

import { revalidatePath } from "next/cache";
import { atLeast, isOperator, orgRole } from "@/lib/auth/access";
import { temporaryPassword, verifyPassword } from "@/lib/auth/password";
import { currentOperator, currentUser } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { getAuthConfig } from "@/lib/auth/config";
import { encodeUser } from "@/lib/auth/account-token";
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/lib/auth/token";
import { createUser, resetPassword, setDisabled, setName, setPassword, userByEmail, userById, ORG_ROLES, type OrgRole } from "@/lib/auth/users";
import { bindActor } from "@/lib/control/bind";
import { submitCommand } from "@/lib/control/submit";

export type PeopleResult =
  | { success: true; message: string; temporary_password?: string; email?: string }
  | { success: false; error: string };

function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v.slice(0, 2000);
  return out;
}

/** Add a person to an organization. A new email gets an account with a temporary password, said once to the inviter. */
export async function inviteMemberAction(_prev: PeopleResult | null, formData: FormData): Promise<PeopleResult> {
  const me = await currentUser();
  const actor = await currentOperator();
  if (!me || !actor) return { success: false, error: "Your session has expired. Sign in again." };
  const f = fields(formData);
  const runId = f.run_id ?? "";
  if (!atLeast(await orgRole(runId), "runs")) return { success: false, error: "Only someone who runs this organization can add people." };
  const role = (ORG_ROLES as string[]).includes(f.role ?? "") ? (f.role as OrgRole) : null;
  if (!role) return { success: false, error: "Choose what they may do." };
  if ((f.why ?? "").trim().length < 10) return { success: false, error: "Say why, in at least 10 characters." };

  let user = await userByEmail(f.email ?? "");
  let temporary: string | undefined;
  if (!user) {
    temporary = temporaryPassword();
    const made = await createUser({ email: f.email ?? "", name: f.name ?? "", password: temporary, role: "member", createdBy: actor, mustChange: true });
    if (!made.ok) return { success: false, error: made.error };
    user = await userById(made.user_id);
  }
  if (!user) return { success: false, error: "The account could not be found after it was made." };
  const queued = await submitCommand(bindActor({
    kind: "set_member", run_id: runId, reason: `${actor}: ${f.why}`, payload: { user_id: user.user_id, role, why: f.why },
  }, actor));
  if (!queued.success) return { success: false, error: queued.error };
  revalidatePath("/reviews");
  return {
    success: true, email: user.email, temporary_password: temporary,
    message: temporary ? `Account made for ${user.email}. Their temporary password is below; it is shown once. They change it at first sign-in.`
      : `${user.email} already had an account; they now ${role === "runs" ? "run" : role === "decides" ? "decide for" : "ask and submit in"} this organization.`,
  };
}

export async function removeMemberAction(_prev: PeopleResult | null, formData: FormData): Promise<PeopleResult> {
  const me = await currentUser();
  const actor = await currentOperator();
  if (!me || !actor) return { success: false, error: "Your session has expired. Sign in again." };
  const f = fields(formData);
  const runId = f.run_id ?? "";
  if (!atLeast(await orgRole(runId), "runs")) return { success: false, error: "Only someone who runs this organization can remove people." };
  if (f.user_id === me.user_id) return { success: false, error: "You cannot remove yourself. Ask another person who runs it." };
  if ((f.why ?? "").trim().length < 10) return { success: false, error: "Say why, in at least 10 characters." };
  const queued = await submitCommand(bindActor({
    kind: "remove_member", run_id: runId, reason: `${actor}: ${f.why}`, payload: { user_id: f.user_id ?? "", why: f.why },
  }, actor));
  if (!queued.success) return { success: false, error: queued.error };
  revalidatePath("/reviews");
  return { success: true, message: "Removed. It is on the record." };
}

/** Make another operator. Operators run the service and see every organization, so only an operator can. */
export async function inviteOperatorAction(_prev: PeopleResult | null, formData: FormData): Promise<PeopleResult> {
  const actor = await currentOperator();
  if (!actor) return { success: false, error: "Your session has expired. Sign in again." };
  if (!(await isOperator())) return { success: false, error: "Only an operator can add an operator." };
  const f = fields(formData);
  const temporary = temporaryPassword();
  const made = await createUser({ email: f.email ?? "", name: f.name ?? "", password: temporary, role: "operator", createdBy: actor, mustChange: true });
  if (!made.ok) return { success: false, error: made.error };
  revalidatePath("/organizations");
  return { success: true, email: (f.email ?? "").trim().toLowerCase(), temporary_password: temporary, message: "Operator account made. The temporary password is below; it is shown once." };
}

export async function changePasswordAction(_prev: PeopleResult | null, formData: FormData): Promise<PeopleResult> {
  const me = await currentUser();
  if (!me) return { success: false, error: "Your session has expired. Sign in again." };
  const f = fields(formData);
  const user = await userById(me.user_id);
  if (!user || !verifyPassword(f.current ?? "", user.password_hash)) return { success: false, error: "Your current password is not right." };
  if ((f.password ?? "") !== (f.again ?? "")) return { success: false, error: "The new passwords do not match." };
  const set = await setPassword(me.user_id, f.password ?? "");
  if (!set.ok) return { success: false, error: set.error };
  // the change ended every session of this account, including this one; issue a fresh cookie for it
  const fresh = await userById(me.user_id);
  const cfg = getAuthConfig();
  if (fresh && cfg.ok) {
    (await cookies()).set(SESSION_COOKIE, await signSession(cfg.secret, encodeUser({ user_id: fresh.user_id, email: fresh.email, name: fresh.name, role: fresh.role, version: Number(fresh.session_version ?? 0) })),
      { httpOnly: true, sameSite: "lax", path: "/", maxAge: Math.floor(SESSION_TTL_MS / 1000) });
  }
  return { success: true, message: "Password changed. Any other session of yours has been signed out." };
}

export async function changeNameAction(_prev: PeopleResult | null, formData: FormData): Promise<PeopleResult> {
  const me = await currentUser();
  if (!me) return { success: false, error: "Your session has expired. Sign in again." };
  const f = fields(formData);
  if ((f.name ?? "").trim().length < 2) return { success: false, error: "Enter your name." };
  await setName(me.user_id, f.name ?? "");
  return { success: true, message: "Name changed. It applies to your next sign-in; anything already on the record keeps the name it was signed with." };
}

/** An operator gives someone a new temporary password. Every session they had ends. */
export async function resetPasswordAction(_prev: PeopleResult | null, formData: FormData): Promise<PeopleResult> {
  const actor = await currentOperator();
  if (!actor) return { success: false, error: "Your session has expired. Sign in again." };
  if (!(await isOperator())) return { success: false, error: "Only an operator can reset a password." };
  const f = fields(formData);
  const user = await userById(f.user_id ?? "");
  if (!user) return { success: false, error: "No such account." };
  const temporary = temporaryPassword();
  const done = await resetPassword(user.user_id, temporary);
  if (!done.ok) return { success: false, error: done.error };
  revalidatePath("/organizations");
  return { success: true, email: user.email, temporary_password: temporary, message: `Reset. ${user.name} has been signed out everywhere; the temporary password is below, shown once. They change it at sign-in.` };
}

/** An operator disables or restores an account. Disabling ends every session at once. */
export async function setDisabledAction(_prev: PeopleResult | null, formData: FormData): Promise<PeopleResult> {
  const me = await currentUser();
  if (!me) return { success: false, error: "Your session has expired. Sign in again." };
  if (!(await isOperator())) return { success: false, error: "Only an operator can disable an account." };
  const f = fields(formData);
  if (f.user_id === me.user_id) return { success: false, error: "You cannot disable your own account." };
  const user = await userById(f.user_id ?? "");
  if (!user) return { success: false, error: "No such account." };
  await setDisabled(user.user_id, f.disabled === "1");
  revalidatePath("/organizations");
  return { success: true, message: f.disabled === "1" ? `${user.name} is disabled and signed out everywhere. Their memberships and anything they signed stay on the record.` : `${user.name} can sign in again.` };
}
