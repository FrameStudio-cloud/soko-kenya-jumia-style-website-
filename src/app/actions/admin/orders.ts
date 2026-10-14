"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin";
import { recordAdminAction } from "@/lib/admin-audit";
import { getFullDelivery, transitionOrder } from "@/lib/admin-orders";

/*
  Admin order actions.

  Every one of these calls requireAdminAction() FIRST, before touching an
  argument or reaching the database. A guard that runs after the id has been
  validated is still a guard, but one that runs after the query has been issued
  is a log line and nothing else.

  Throwing rather than returning `{ ok: false }`: an unauthenticated caller
  should get an error and learn nothing about whether the action exists.
*/

export type AdminOrderResult = {
  ok: boolean;
  message: string;
};

export async function updateOrderStatusAction(
  orderId: string,
  toStatus: string,
  formData: FormData,
): Promise<AdminOrderResult> {
  await requireAdminAction();

  const note = String(formData.get("note") ?? "");
  const actor = String(formData.get("actor") ?? "admin").trim() || "admin";

  const result = await transitionOrder({ orderId, toStatus, note, actor });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/admin/orders");
  return {
    ok: true,
    message: `Order moved to ${toStatus.replace("_", " ")}.`,
  };
}

/**
 * Cancel and return the stock.
 *
 * Routed through the same transition map as every other change: `cancelled` is
 * reachable only from pending_payment or confirmed, so this cannot cancel a
 * dispatched order even if a caller asks it to.
 */
export async function cancelOrderAction(
  orderId: string,
  formData: FormData,
): Promise<AdminOrderResult> {
  await requireAdminAction();

  const reason = String(formData.get("reason") ?? "").trim();
  const actor = String(formData.get("actor") ?? "admin").trim() || "admin";

  if (!reason) {
    return {
      ok: false,
      message: "Give a reason — it is written to the order's history.",
    };
  }

  const result = await transitionOrder({
    orderId,
    toStatus: "cancelled",
    note: reason,
    actor,
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/admin/orders");
  return { ok: true, message: "Order cancelled and its stock returned." };
}

/* ---------------------------------------------------------------- reveal -- */

export type RevealResult = {
  ok: boolean;
  message: string;
  recipientName?: string | null;
  town?: string | null;
  street?: string | null;
  phone?: string | null;
};

/**
 * Unmask a customer's delivery details.
 *
 * A server action rather than a link, so that the access is recorded at the
 * moment it happens. The audit row is written BEFORE the data is returned: if
 * the log write fails there is no path that hands over an address without also
 * recording that somebody asked.
 *
 * The audit note deliberately does NOT contain the address. This log is read
 * more often than the orders table, and copying the PII into it would defeat
 * the masking it exists to prove was honoured.
 */
export async function revealDeliveryAction(
  orderId: string,
  reference: string,
): Promise<RevealResult> {
  await requireAdminAction();

  const full = await getFullDelivery(orderId);
  if (!full) return { ok: false, message: "That order no longer exists." };

  await recordAdminAction({
    actor: "admin",
    action: "reveal_delivery",
    target: reference,
    note: "Unmasked recipient name, street and phone",
  });

  return {
    ok: true,
    message: "Access recorded.",
    recipientName: full.address.recipientName,
    town: full.address.town,
    street: full.address.street,
    phone: full.phone,
  };
}