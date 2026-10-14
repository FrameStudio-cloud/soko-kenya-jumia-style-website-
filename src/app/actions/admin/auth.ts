"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import {
  clearAdminSession,
  clearFailures,
  createAdminSession,
  isLockedOut,
  passwordMatches,
  recordFailure,
} from "@/lib/admin";
import { recordAdminAction } from "@/lib/admin-audit";

/*
  Admin sign-in and sign-out.

  The error message is identical whether the password was wrong or the account
  is locked out. Distinguishing them tells an attacker they got the password
  right and only the timing was unlucky.
*/

export type LoginResult = { ok: boolean; message: string };

const GENERIC_FAILURE = "That password is not right.";

/**
 * Best-effort client identity for the lockout counter.
 *
 * x-forwarded-for is trivially forged, so this is an obstacle rather than a
 * control — the real limit is the password itself.
 */
async function clientKey(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function loginAction(
  _previous: LoginResult | null,
  formData: FormData,
): Promise<LoginResult> {
  const key = await clientKey();

  if (isLockedOut(key)) {
    return { ok: false, message: "Too many attempts. Try again in a few minutes." };
  }

  const password = String(formData.get("password") ?? "");

  if (!passwordMatches(password)) {
    recordFailure(key);
    return { ok: false, message: GENERIC_FAILURE };
  }

  clearFailures(key);
  await createAdminSession();

  /*
    Record the sign-in.

    Successful ones only, and that is a deliberate limit. Logging failures too
    would let an unauthenticated attacker write an unbounded number of rows:
    x-forwarded-for is attacker-supplied, so the in-memory lockout's per-IP cap
    is bypassable by simply lying about the address. A log an outsider can grow
    at will is a liability, not an audit trail.

    The IP goes in `note`, not `target` — target is for the object acted on
    (an order reference, a product slug), and a sign-in acts on nothing.
    It is bound as a parameter, so a forged header cannot become an injection.
  */
  await recordAdminAction({
    actor: "admin",
    action: "login",
    target: null,
    note: `Signed in from ${key}`,
  });

  // `redirect()` throws NEXT_REDIRECT rather than returning. It is called last,
  // after the audit write, so the throw cannot skip it — and nothing above
  // catches it, because swallowing a redirect leaves the operator staring at a
  // form that says nothing happened.
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await clearAdminSession();
  redirect("/admin/login");
}