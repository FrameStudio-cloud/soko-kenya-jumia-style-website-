/*
  Order rules, with no database in them.

  Split from admin-orders.ts because a client component needs these — the status
  buttons render straight from the transition map — and admin-orders.ts imports
  @/db, which is pg, which imports `dns`. Without this split, importing a plain
  object literal pulled the whole Postgres driver into the browser bundle and
  the build failed on `Module not found: Can't resolve 'dns'`.

  If a value is needed by both the browser and the server, it belongs here. If
  it is only needed on the server, it belongs in admin-orders.ts.
*/

export const ORDER_STATUSES = [
  "pending_payment",
  "confirmed",
  "dispatched",
  "delivered",
  "cancelled",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["confirmed", "cancelled"],
  confirmed: ["dispatched", "cancelled"],
  // No cancel: the parcel is gone. Refund, or nothing.
  dispatched: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from as OrderStatus] ?? []).includes(to as OrderStatus);
}

/** Human label for a status, so the UI never shows a raw enum value. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  dispatched: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/* ------------------------------------------------------------------ PII ---- */

export type DeliveryDetails = {
  recipientName: string | null;
  town: string | null;
  street: string | null;
  notes: string | null;
};

export type MaskedDelivery = {
  /** First name only. A surname plus a street is enough to identify someone. */
  recipientName: string | null;
  county: string;
  town: string | null;
  /** Never a partial reveal: "K4" from "Karen Blk 4" still identifies a house. */
  street: string | null;
  /** Last three digits. Enough to recognise your own number, useless to a stranger. */
  phone: string | null;
  hasPhone: boolean;
  notes: string | null;
};

const MASK = "••••••";

function firstName(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const [first] = trimmed.split(/\s+/);
  return first ? `${first}${first.length > 1 ? "…" : ""}` : null;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 3) return MASK;
  return `${MASK}${digits.slice(-3)}`;
}

/**
 * What an order list is allowed to show.
 *
 * County and town survive because an operator needs to sanity-check a delivery
 * zone at a glance, and neither identifies a household on its own. Recipient
 * name, street and phone do not survive, because all three would.
 */
export function maskAddress(
  address: DeliveryDetails | Record<string, unknown>,
  county: string,
  phone: string | null,
): MaskedDelivery {
  const a = address as DeliveryDetails;
  return {
    recipientName: firstName(a?.recipientName ?? null),
    county,
    town: a?.town ?? null,
    street: a?.street ? MASK : null,
    phone: maskPhone(phone),
    hasPhone: Boolean(phone),
    notes: a?.notes ?? null,
  };
}