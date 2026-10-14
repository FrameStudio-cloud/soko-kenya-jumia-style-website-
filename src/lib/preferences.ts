import { cookies } from "next/headers";

/*
  Device-level preferences.

  There are no accounts yet, so this is deliberately NOT pretending to be a
  profile. It is a set of per-browser preferences that do real work: the saved
  delivery address pre-fills checkout, which is the entire point.

  What changes when auth lands:
    - the cookie is replaced by a users.preferences column
    - the address becomes a row in `addresses`, not an inline blob
    - the "this device only" caveat disappears

  Until then the honest framing is on the page itself, not just in this comment.
*/

const COOKIE = "soko_prefs";
const MAX_AGE = 60 * 60 * 24 * 365;

export type Preferences = {
  /** Default delivery address, pre-filled at checkout. */
  recipientName: string;
  phone: string;
  county: string;
  town: string;
  street: string;
  /**
   * Show the seller's dispatch estimate on product cards. On by default —
   * hiding delivery information is how a marketplace earns a complaint at
   * checkout.
   */
  showDeliveryEstimate: boolean;
  /**
   * Compact product grid: five across on a desktop instead of four. Off by
   * default, because more products per screen is worse for a shopper who needs
   * to read the price and the seller.
   */
  compactGrid: boolean;
  /**
   * Warn before leaving a cart with items in it. On by default.
   */
  confirmBeforeLeavingCart: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = {
  recipientName: "",
  phone: "",
  county: "",
  town: "",
  street: "",
  showDeliveryEstimate: true,
  compactGrid: false,
  confirmBeforeLeavingCart: true,
};

/**
 * Kenyan phone: 07XXXXXXXX, 01XXXXXXXX, +2547/2541, spaces and dashes allowed.
 *
 * Same rule as checkout, and deliberately not stricter. A wrong rejection at
 * checkout loses a sale; a number the courier cannot reach is a support ticket
 * the seller absorbs.
 */
const PHONE = /^(?:\+?254|0)(?:7|1)\d{8}$/;

export function validatePreferences(
  input: Partial<Preferences>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  const name = (input.recipientName ?? "").trim();
  const phone = (input.phone ?? "").replace(/[\s-]/g, "");
  const county = (input.county ?? "").trim();
  const town = (input.town ?? "").trim();

  /*
    Partial addresses are allowed. A shopper who only wants to save their county
    so delivery quotes are right should not be forced to enter a street, and a
    required-field wall on a convenience page is the fastest way to make people
    abandon it.

    But a phone number WITH a name is nearly always a typo, so it is checked
    when present rather than required.
  */
  if (phone !== "" && !PHONE.test(phone)) {
    errors.phone = "Enter a Kenyan phone number, like 0712 345 678.";
  }
  if (name !== "" && name.length < 2) {
    errors.recipientName = "That name is too short to be useful.";
  }
  if (name === "" && phone !== "") {
    errors.recipientName = "Add a name to go with this phone number.";
  }
  if (town !== "" && name === "" && county !== "") {
    errors.recipientName = "Add a name so the rider knows who to ask for.";
  }

  return errors;
}

/** Cap stored values. Cookies are size-limited and this is user input. */
function clamp(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export async function readPreferences(): Promise<Preferences> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return DEFAULT_PREFERENCES;

  /*
    parse without throwing. A cookie is user-editable and survives deploys, so
    a value written by an older version of this code may not match today's
    shape. A malformed cookie must degrade to defaults, not 500 every page.
  */
  try {
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      recipientName: clamp(String(parsed.recipientName ?? ""), 80),
      phone: clamp(String(parsed.phone ?? ""), 20),
      county: clamp(String(parsed.county ?? ""), 60),
      town: clamp(String(parsed.town ?? ""), 80),
      street: clamp(String(parsed.street ?? ""), 160),
      showDeliveryEstimate:
        typeof parsed.showDeliveryEstimate === "boolean"
          ? parsed.showDeliveryEstimate
          : DEFAULT_PREFERENCES.showDeliveryEstimate,
      compactGrid:
        typeof parsed.compactGrid === "boolean"
          ? parsed.compactGrid
          : DEFAULT_PREFERENCES.compactGrid,
      confirmBeforeLeavingCart:
        typeof parsed.confirmBeforeLeavingCart === "boolean"
          ? parsed.confirmBeforeLeavingCart
          : DEFAULT_PREFERENCES.confirmBeforeLeavingCart,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Persist preferences.
 *
 * Server Action / Route Handler only — Next.js forbids cookie writes during a
 * page render, which is the same constraint that shaped the cart session.
 */
export async function writePreferences(prefs: Preferences): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify(prefs), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

/** True when the shopper has saved enough to pre-fill checkout. */
export function hasSavedAddress(prefs: Preferences): boolean {
  return prefs.county !== "" && prefs.recipientName !== "";
}

export { PHONE as KENYAN_PHONE_PATTERN };