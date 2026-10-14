/*
  Client-side storage for the last checkout result.

  Deliberately a plain module with no "use client" and no imports, so it can
  be used by client components without dragging anything server-only along.

  It must NOT be imported by a server action. An earlier version of
  src/app/actions/checkout.ts did exactly that, which forced the action to be
  marked "use client" — and that pulled src/lib/cart.ts (and next/headers with
  it) into the browser bundle, breaking /checkout and /settings with a 500.

  The split: the action decides WHAT happened and returns it; the component
  decides to persist it. Server code has no business reading localStorage
  anyway.
*/

const STORAGE_KEY = "soko_last_order";

export type OrderBadgeState = {
  status: "sent" | "failed";
  /** The order reference, when the order went through. */
  reference?: string;
  /** Why it failed, in language a shopper can act on. */
  message: string;
  /**
   * Whether the cart is still intact.
   *
   * true  — verified, the cart is unchanged
   * false — verified, the cart was consumed
   * undefined — UNKNOWN, so the badge makes no claim
   *
   * The distinction matters. Asserting "your cart is safe" without checking
   * sends a shopper looking for items that are gone.
   */
  cartIntact?: boolean;
};

export function writeLastOrder(state: OrderBadgeState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled or full. The page still shows its inline error; only
    // the persistent badge is lost, which is not worth surfacing.
  }
}

export function readLastOrder(): OrderBadgeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrderBadgeState;
    // Shape check: a stale value from an older build should degrade to
    // nothing rather than render an undefined badge.
    return parsed && (parsed.status === "sent" || parsed.status === "failed")
      ? parsed
      : null;
  } catch {
    // Private browsing, or a corrupted value. Neither is worth an error.
    return null;
  }
}

export function clearLastOrder(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}