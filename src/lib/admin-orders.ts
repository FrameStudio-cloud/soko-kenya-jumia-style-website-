import { client, query } from "@/db";
import {
  canTransition,
  maskAddress,
  ORDER_STATUSES,
  STATUS_LABEL,
  type DeliveryDetails,
  type MaskedDelivery,
  type OrderStatus,
} from "@/lib/admin-order-rules";

/*
  Order administration: the I/O half.

  The rules — allowed transitions, status labels, PII masking — live in
  admin-order-rules.ts, which has no database import. That split is load-bearing,
  not tidiness: OrderStatusControls is a client component that reads
  ALLOWED_TRANSITIONS to decide which buttons to render, and importing it from
  here pulled @/db (and therefore pg, and therefore `dns`) into the browser
  bundle. Importing a plain object literal should not do that.

  Everything an admin can do to an order, and the rules that decide whether they
  may.

  Three decisions worth stating before the code:

  1. Allowed transitions are a MAP, and they are enforced in SQL inside the
     transaction. A button that is hidden in the UI is presentation; the map is
     the control. `dispatched -> cancelled` is deliberately absent — the parcel
     has left, so that path is a refund.

  2. Cancelling returns `products.stock`, and touches nothing else.
     placeOrder() already decremented BOTH stock and stock_reserved, and handed
     the reservation row to the order. So the inverse is a single increment on
     stock: stock_reserved must not move again, or it drifts below the true
     hold count and availability inflates.

  3. Delivery details are masked unless explicitly revealed, and the reveal is
     itself a function that can be logged. See maskAddress().

  This module never calls sweepExpiredReservations(). That sweep matches
  `released_at IS NULL AND expires_at <= now()` with no exclusion for
  order-bound rows, so running it from an admin screen would release holds for
  orders still in flight and decrement stock_reserved a second time. Cancelling
  marks the cancelled order's own reservations released, which is safe, but it
  does not fix the general case — see docs/admin.md.
*/

export {
  ORDER_STATUSES,
  ALLOWED_TRANSITIONS,
  STATUS_LABEL,
  canTransition,
  maskAddress,
} from "@/lib/admin-order-rules";
export type {
  OrderStatus,
  DeliveryDetails,
  MaskedDelivery,
} from "@/lib/admin-order-rules";

/* --------------------------------------------------------------- reads ---- */

export type OrderSummaryRow = {
  id: string;
  reference: string;
  status: OrderStatus;
  paymentStatus: string;
  county: string;
  grandTotal: number;
  createdAt: string;
  sellerName: string;
  lineCount: number;
  itemCount: number;
};

export async function getOrderStatusCounts(): Promise<
  Array<{ status: OrderStatus; count: number }>
> {
  const rows = await query<{ status: string; count: number }>(
    `SELECT status, count(*)::int AS count
       FROM orders
      GROUP BY status
      ORDER BY count DESC`,
  );

  // Every status in the enum, so a status with no orders still renders as a 0
  // rather than silently disappearing from the dashboard.
  const counts = new Map(rows.map((r) => [r.status, Number(r.count)]));
  return ORDER_STATUSES.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}

export type OrderFilter = {
  status?: OrderStatus;
  page?: number;
  perPage?: number;
};

export async function listAdminOrders({
  status,
  page = 1,
  perPage = 25,
}: OrderFilter = {}): Promise<{ rows: OrderSummaryRow[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * perPage;

  // status is range-checked against the enum before it reaches SQL, exactly as
  // parseFilters does for the catalogue. $1::text = '' handles "no filter"
  // without building a different query shape.
  const rows = await query<OrderSummaryRow>(
    `SELECT o.id,
            o.reference,
            o.status,
            o.payment_status AS "paymentStatus",
            o.county,
            o.grand_total::float8 AS "grandTotal",
            o.created_at AS "createdAt",
            s.name AS "sellerName",
            count(oi.product_id)::int AS "lineCount",
            COALESCE(sum(oi.quantity), 0)::int AS "itemCount"
       FROM orders o
       JOIN sellers s ON s.id = o.seller_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ($1::text = '' OR o.status = $1)
      GROUP BY o.id, s.name
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3`,
    [status ?? "", perPage, offset],
  );

  const [totals] = await query<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM orders
      WHERE ($1::text = '' OR status = $1)`,
    [status ?? ""],
  );

  return { rows, total: Number(totals.total) };
}

export type StatusHistoryRow = {
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
  note: string | null;
  createdAt: string;
};

export async function getAdminOrderDetail(reference: string): Promise<{
  order: OrderSummaryRow;
  delivery: MaskedDelivery;
  items: Array<{
    productId: string;
    titleSnapshot: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
  history: StatusHistoryRow[];
} | null> {
  const [order] = await query<OrderSummaryRow & { deliveryAddress: unknown; deliveryPhone: string | null }>(
    `SELECT o.id,
            o.reference,
            o.status,
            o.payment_status AS "paymentStatus",
            o.county,
            o.grand_total::float8 AS "grandTotal",
            o.created_at AS "createdAt",
            o.delivery_address AS "deliveryAddress",
            o.delivery_phone AS "deliveryPhone",
            s.name AS "sellerName",
            (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS "lineCount",
            (SELECT COALESCE(sum(quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS "itemCount"
       FROM orders o
       JOIN sellers s ON s.id = o.seller_id
      WHERE o.reference = $1`,
    [reference],
  );

  if (!order) return null;

  const items = await query<{
    productId: string;
    titleSnapshot: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>(
    `SELECT product_id AS "productId",
            title_snapshot AS "titleSnapshot",
            unit_price::float8 AS "unitPrice",
            quantity,
            line_total::float8 AS "lineTotal"
       FROM order_items
      WHERE order_id = $1
      ORDER BY title_snapshot`,
    [order.id],
  );

  const history = await query<StatusHistoryRow>(
    `SELECT from_status AS "fromStatus",
            to_status AS "toStatus",
            changed_by AS "changedBy",
            note,
            created_at AS "createdAt"
       FROM order_status_history
      WHERE order_id = $1
      ORDER BY created_at`,
    [order.id],
  );

  return {
    order,
    delivery: maskAddress(
      (order.deliveryAddress ?? {}) as Record<string, unknown>,
      order.county,
      order.deliveryPhone,
    ),
    items,
    history,
  };
}

/**
 * The unmasked delivery details, for the audited reveal path ONLY.
 *
  * Kept apart from getAdminOrderDetail on purpose: that function returns the
 * masked shape, so a page cannot accidentally render a customer's street and
  phone by forgetting to think about it. Getting the raw values is a separate
 * call that exists only behind an action which writes an audit row.
 */
export async function getFullDelivery(orderId: string): Promise<{
  address: DeliveryDetails;
  phone: string | null;
  county: string;
} | null> {
  const [row] = await query<{
    deliveryAddress: unknown;
    deliveryPhone: string | null;
    county: string;
  }>(
    `SELECT delivery_address AS "deliveryAddress",
            delivery_phone AS "deliveryPhone",
            county
       FROM orders
      WHERE id = $1`,
    [orderId],
  );

  if (!row) return null;

  return {
    address: (row.deliveryAddress ?? {}) as DeliveryDetails,
    phone: row.deliveryPhone,
    county: row.county,
  };
}

/* ----------------------------------------------------------- mutations ---- */

export type TransitionResult =
  | { ok: true; status: OrderStatus }
  | { ok: false; reason: "not_found" | "illegal" | "unknown_status"; message: string };

/**
 * Move an order to a new status, or cancel it and return its stock.
 *
 * `cancel` is a transition to `cancelled` plus the stock return; it is not a
 * separate path, so there is one place where a status can change and one set of
 * rules it must satisfy.
 *
 * actor is written into order_status_history.changed_by. That column is free
 * text by design — it may hold a shopper, a seller, the admin console or a
 * future sweep — so the value is a label, not an id.
 */
export async function transitionOrder({
  orderId,
  toStatus,
  note,
  actor,
}: {
  orderId: string;
  toStatus: string;
  note?: string;
  actor: string;
}): Promise<TransitionResult> {
  if (!ORDER_STATUSES.includes(toStatus as OrderStatus)) {
    return {
      ok: false,
      reason: "unknown_status",
      message: `"${toStatus}" is not an order status.`,
    };
  }

  const conn = await client();

  try {
    await conn.query("BEGIN");

    /*
      FOR UPDATE, or two admins cancelling the same order would both read
      `confirmed`, both see `cancelled` as legal, and the stock would be
      returned twice.
    */
    const current = await conn.query<{ status: string }>(
      `SELECT status FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );

    if (current.rowCount === 0) {
      await conn.query("ROLLBACK");
      return { ok: false, reason: "not_found", message: "That order no longer exists." };
    }

    const from = current.rows[0].status;

    if (!canTransition(from, toStatus)) {
      await conn.query("ROLLBACK");
      return {
        ok: false,
        reason: "illegal",
        message: `An order that is ${STATUS_LABEL[from as OrderStatus]?.toLowerCase() ?? from} cannot become ${STATUS_LABEL[toStatus as OrderStatus].toLowerCase()}.`,
      };
    }

    if (toStatus === "cancelled") {
      /*
        The inverse of placeOrder, and only the inverse.

        placeOrder ran:
          UPDATE products SET stock = stock - q, stock_reserved = stock_reserved - q

        so BOTH columns already moved. Returning the unit is therefore a single
        increment on stock. Touching stock_reserved here would decrement it a
        second time for a hold that no longer exists, and availability would
        inflate past the true figure.

        Summed per product from order_items rather than from stock_reservations:
        the order's lines are the authoritative record of what was sold, and
        they survive even if the reservation row has been swept.
      */
      await conn.query(
        `UPDATE products p
            SET stock = p.stock + oi.quantity
           FROM order_items oi
          WHERE oi.order_id = $1
            AND p.id = oi.product_id`,
        [orderId],
      );

      /*
        Mark this order's holds released. Defensive: a sweep would otherwise
        find them, and decrement stock_reserved for stock that has already been
        given back.
      */
      await conn.query(
        `UPDATE stock_reservations
            SET released_at = now()
          WHERE order_id = $1
            AND released_at IS NULL`,
        [orderId],
      );
    }

    await conn.query(
      `UPDATE orders SET status = $2, updated_at = now() WHERE id = $1`,
      [orderId, toStatus],
    );

    await conn.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
            VALUES ($1, $2, $3, $4, $5)`,
      [orderId, from, toStatus, actor, note?.trim() || null],
    );

    await conn.query("COMMIT");
    return { ok: true, status: toStatus as OrderStatus };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}