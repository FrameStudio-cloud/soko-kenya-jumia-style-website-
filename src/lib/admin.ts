import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/*
  Admin session.

  The app has no accounts — shoppers are identified by cookie (`soko_cart`,
  `soko_rater`) — so the admin console needs its own, deliberately dull,
  single-operator sign-in: one shared password exchanged for a signed token.

  What is different from every other cookie in this app, and why:

    httpOnly   script cannot read or forge it.
    SIGNED     the cart and rater cookies are bare random UUIDs, documented as
               not tamper-evident. That is acceptable when losing one costs you
               a cart. Forging a forged admin cookie would hand over stock
               control and every customer's name, phone and street address, so
               the signature is the whole security property here.
    timing     password and signature comparisons use timingSafeEqual. A plain
               === leaks the answer through response time, character by
               character.

  No middleware. The guard lives in the (protected) layout for pages and is
  called again inside every action, because a guard on the page protects
  nothing: the actions are the attack surface.
*/

const COOKIE = "soko_admin";
const MAX_AGE_SECONDS = 60 * 60 * 8; // a working day; re-enter the password tomorrow.

/*
  Fails CLOSED. A missing secret must never mean "no admin" — that would look
  identical to a locked-out operator and quietly disable the console, and the
  alternative mistake (defaulting to something guessable) is far worse.
*/
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `${name} is not set. The admin console cannot authenticate without it.`,
    );
  }
  return value;
}

/** base64url without padding — safe in a cookie value unencoded. */
function encode(value: Buffer): string {
  return value.toString("base64url");
}

export type AdminSession = { expiresAt: number };

/**
 * Sign a payload with an explicit secret.
 *
 * Exported, and takes the secret as an argument rather than reading the
 * environment, so scripts/test-admin-auth.ts can exercise tampering and expiry
 * directly instead of standing up a request scope to observe a cookie.
 */
export function signToken(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function tokenPayload(expiresAt: number): string {
  return encode(Buffer.from(JSON.stringify({ expiresAt })));
}

/**
 * Verify a token. Pure: no cookies, no clock of its own.
 *
 * Every failure is `false`, never a throw. A page render must not blow up on a
 * mangled cookie — it should send the operator to the login form.
 */
export function verifyToken(
  token: string | undefined,
  secret: string,
  now: number,
): boolean {
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = Buffer.from(signToken(payload, secret));
  const actual = Buffer.from(signature);
  // Length is checked before the constant-time compare because timingSafeEqual
  // throws on a mismatch, and a thrown error here is a 500, not a denial.
  if (expected.length !== actual.length) return false;
  if (!timingSafeEqual(expected, actual)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      expiresAt?: unknown;
    };
    return typeof decoded.expiresAt === "number" && now < decoded.expiresAt;
  } catch {
    // A signed-but-unparseable payload means the secret is shared with
    // something that is not this app. Refuse rather than guess.
    return false;
  }
}

/** Mint the session cookie. Server Action / Route Handler only. */
export async function createAdminSession(): Promise<void> {
  const payload = tokenPayload(Date.now() + MAX_AGE_SECONDS * 1000);
  const secret = requireEnv("ADMIN_SESSION_SECRET");

  const jar = await cookies();
  jar.set(COOKIE, `${payload}.${signToken(payload, secret)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // Scoped to /admin: this credential is sent to exactly one area of the site.
    path: "/admin",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearAdminSession(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, path: "/admin", maxAge: 0 });
}

/**
 * Is this request an authenticated admin? Read only, safe during render.
 *
 * Returns false for a missing, malformed, tampered or expired token.
 */
export async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value;
  return verifyToken(token, requireEnv("ADMIN_SESSION_SECRET"), Date.now());
}

/**
 * Gate for a page. Redirects to the login form.
 *
 * Not for actions — an action that redirects has still told the caller
 * something it should not have. Use requireAdminAction there.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    const { redirect } = await import("next/navigation");
    redirect("/admin/login");
  }
}

/**
 * Gate for a server action. Throws.
 *
 * A refusal is deliberately not a typed `{ ok: false }`: that would return 200
 * with a message, which reads to a scraper like a working endpoint. Throwing
 * means an unauthenticated caller gets an error and learns nothing about
 * whether the action does anything.
 */
export async function requireAdminAction(): Promise<void> {
  if (!(await isAdmin())) {
    throw new Error("admin: not authenticated");
  }
}

/** Constant-time comparison against ADMIN_PASSWORD. */
export function passwordMatches(candidate: string): boolean {
  const expected = Buffer.from(requireEnv("ADMIN_PASSWORD"));
  const given = Buffer.from(candidate);
  // timingSafeEqual throws on a length mismatch, and the length of a shared
  // secret is not the secret.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/* ------------------------------------------------------------- lockout ---- */

/*
  Failed-attempt counter, in memory.

  Weak by construction and honest about it: it resets when the process
  restarts, and Next.js dev reloads modules constantly so a lockout there lasts
  seconds. It exists to slow a person typing a password repeatedly, not to
  survive a determined attacker — that needs a shared store, which is not worth
  building for a single operator before the login page even has a rate limit.
*/
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 10 * 60 * 1000;

const failures = new Map<string, { count: number; until: number }>();

export function isLockedOut(key: string): boolean {
  return (failures.get(key)?.until ?? 0) > Date.now();
}

export function recordFailure(key: string): void {
  const existing = failures.get(key);
  const count = (existing?.count ?? 0) + 1;
  failures.set(key, {
    count,
    until: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
  });
}

export function clearFailures(key: string): void {
  failures.delete(key);
}