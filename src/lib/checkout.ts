import { client, query } from "@/db";
import { readCartSessionId, type CartView, getCartView } from "@/lib/cart";

/*
  Checkout: delivery quoting and the cart -> order conversion.

  The conversion is the first time stock genuinely leaves inventory, and it is
  the only place in the app where one shopper's action must not be able to
  affect another's. Everything here is therefore a single transaction with
  no read-then-write.
*/

export type DeliveryQuote = {
  county: string;
  /** One entry per seller — each becomes its own order and its own shipment. */
  perSeller: Array<{
    sellerId: string;
    sellerName: string;
    subtotal: number;
    fee: number;
    /** Set when the basket crossed this county's free-delivery threshold. */
    freeApplied: boolean;
    /** Set when this seller offers no free-delivery threshold at all. */
    threshold: number | null;
  }>;
  totalDelivery: number;
  /** Counties we actually deliver to, for the address form's select. */
  availableCounties: Array<{ county: string; fee: number }>;
};

/**
 * Delivery cost for a county.
 *
 * Free delivery thresholds are per SELLER BASKET, not per cart. A shopper
 * buying KSh 3,000 from one seller and KSh 3,000 from another has not earned
 * free delivery from either — applying the threshold across the whole cart
 * means two small orders ship free that neither seller agreed to.
 */
export async function quoteDelivery(county: string): Promise<DeliveryQuote> {
  const cart = await getCartView();

  const area = await query<{
    county: string;
    base_fee: string;
    free_delivery_threshold: string | null;
  }>(
    `SELECT county, base_fee, free_delivery_threshold
       FROM delivery_areas WHERE county = $1 AND is_active`,
    [county],
  );

  const available = await query<{ county: string; base_fee: string }>(
    `SELECT county, base_fee FROM delivery_areas
      WHERE is_active ORDER BY county`,
  );

  // An unsupported county is not an error the caller should have to handle:
  // quote with a zero fee and let the checkout form block submission instead,
  // because the form is where the shopper can actually change their mind.
  const baseFee = area[0] ? Number(area[0].base_fee) : 0;
  const threshold = area[0] ? area[0].free_delivery_threshold : null;

  const perSeller = cart.sellers.map((seller) => {
    const subtotal = seller.items.reduce((n, i) => n + i.lineTotal, 0);
    const qualifies = threshold !== null && subtotal >= Number(threshold);

    return {
      sellerId: seller.id,
      sellerName: seller.name,
      subtotal,
      fee: qualifies ? 0 : baseFee,
      freeApplied: qualifies && baseFee > 0,
      threshold: threshold === null ? null : Number(threshold),
    };
  });

  return {
    county,
    perSeller,
    totalDelivery: perSeller.reduce((n, s) => n + s.fee, 0),
    availableCounties: available.map((a) => ({
      county: a.county,
      fee: Number(a.base_fee),
    })),
  };
}

export type CheckoutInput = {
  recipientName: string;
  phone: string;
  county: string;
  town: string;
  street?: string;
  notes?: string;
  /** Free-text gift message or rider instructions. */
  paymentMethod: "cod";
};

export type PlaceOrderResult =
  | { ok: true; references: string[]; grandTotal: number }
  | {
      ok: false;
      reason:
        | "empty_cart"
        | "no_session"
        | "unsupported_county"
        | "unavailable_item"
        | "total_mismatch";
      message: string;
      detail?: string;
    };

/*
  Kenyan phone format: 07XXXXXXXX, 01XXXXXXXX, +2547XXXXXXXX or the same
  without the country code. Deliberately not stricter — a wrong rejection at
  checkout loses a sale, whereas a wrong number the courier cannot reach is a
  support ticket the seller has to absorb.
*/
const PHONE = /^(?:\+?254|0)(?:7|1)\d{8}$/;

function validate(input: CheckoutInput): string | null {
  if (input.recipientName.trim().length < 2) {
    return "Enter the name of the person receiving this.";
  }
  if (!PHONE.test(input.phone.replace(/[\s-]/g, ""))) {
    return "Enter a Kenyan phone number, like 0712 345 678.";
  }
  if (input.county.trim() === "") {
    return "Choose the county this order is delivered to.";
  }
  if (input.town.trim().length < 2) {
    return "Enter the town or estate for delivery.";
  }
  return null;
}

/**
 * Convert the cart into one order per seller, inside a single transaction.
 *
 * Why one transaction for all sellers: a cart holding items from three
 * sellers produces three orders. If the second fails, the first must not stay
 * placed — the shopper paid once and would have one order they never
 * intended. All or nothing.
 *
 * Why the reservations move rather than being re-taken: the cart already holds
 * stock. Re-reserving would double-count, and releasing-then-reserving leaves
 * a window where a competing shopper takes the units mid-checkout.
 */
export async function placeOrder(
  input: CheckoutInput,
): Promise<PlaceOrderResult> {
  const sessionId = await readCartSessionId();
  if (!sessionId) {
    return { ok: false, reason: "no_session", message: "Your cart session expired." };
  }

  const invalid = validate(input);
  if (invalid) {
    return { ok: false, reason: "total_mismatch", message: invalid };
  }

  const conn = await client();

  try {
    await conn.query("BEGIN");

    /*
      Read the cart inside the transaction, FOR UPDATE. The lock is what
      prevents two checkout submissions of the SAME cart racing: the second
      blocks here, then finds the cart already converted and returns the
      existing orders instead of placing duplicates.
    */
    const cartRows = await conn.query<{ id: string }>(
      `SELECT id FROM carts
        WHERE session_id = $1 AND status = 'active'
        FOR UPDATE`,
      [sessionId],
    );

    const cartId = cartRows.rows[0]?.id;
    if (!cartId) {
      await conn.query("COMMIT");
      return { ok: false, reason: "empty_cart", message: "Your cart is empty." };
    }

    const lines = await conn.query<{
      product_id: string;
      quantity: number;
      seller_id: string;
      title: string;
      price: string;
      product_status: string;
      seller_status: string;
      reserved: string;
    }>(
      `SELECT ci.product_id, ci.quantity, p.seller_id, p.title, p.price,
              p.status AS product_status, s.status AS seller_status,
              COALESCE((
                SELECT sum(quantity)::int FROM stock_reservations
                 WHERE cart_id = $1 AND product_id = ci.product_id
                   AND released_at IS NULL
              ), 0) AS reserved
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         JOIN sellers s ON s.id = p.seller_id
        WHERE ci.cart_id = $1
        ORDER BY p.seller_id, ci.created_at`,
      [cartId],
    );

    if (lines.rows.length === 0) {
      await conn.query("COMMIT");
      return { ok: false, reason: "empty_cart", message: "Your cart is empty." };
    }

    /*
      Every line must still be reserved in full.

      A hold can lapse if the shopper sat on the cart page past its 30-minute
      window while units were sold to someone else. Catching it here — before
      any order row exists — is what stops an order being placed for stock that
      is gone.
    */
    const lapsed = lines.rows.filter((l) => Number(l.reserved) < Number(l.quantity));
    if (lapsed.length > 0) {
      await conn.query("ROLLBACK");
      return {
        ok: false,
        reason: "unavailable_item",
        message:
          lapsed.length === 1
            ? `Your hold on "${lapsed[0].title}" expired.`
            : `Your holds on ${lapsed.length} items expired.`,
        detail: lapsed.map((l) => l.title).join(", "),
      };
    }

    /*
      And nothing in the basket may have stopped being sellable since it went
      in.

      This is the last line of defence rather than the first. Every catalogue
      read path filters on seller status, RESERVE_SQL refuses to hold a unit
      for a product that is not active, so a cart assembled after either change
      cannot contain one of these lines at all. What is left is the cart
      assembled before — which is precisely the case that has to be caught, or
      suspending a seller would stop their next sale while still honouring the
      orders already queued for them.

      The wording is deliberate. "No longer available" is true and gives the
      shopper something to do; naming the suspension would leak an internal
      moderation decision to somebody who only ever picked a product, and read
      as an accusation against a shop they chose.
    */
    const unsellable = lines.rows.filter(
      (l) => l.product_status !== "active" || l.seller_status !== "active",
    );
    if (unsellable.length > 0) {
      await conn.query("ROLLBACK");
      return {
        ok: false,
        reason: "unavailable_item",
        message:
          unsellable.length === 1
            ? `"${unsellable[0].title}" is no longer available.`
            : `${unsellable.length} items in your basket are no longer available.`,
        detail: unsellable.map((l) => l.title).join(", "),
      };
    }

    const area = await conn.query<{
      base_fee: string;
      free_delivery_threshold: string | null;
    }>(
      `SELECT base_fee, free_delivery_threshold
         FROM delivery_areas WHERE county = $1 AND is_active`,
      [input.county],
    );

    if (!area.rows[0]) {
      await conn.query("ROLLBACK");
      return {
        ok: false,
        reason: "unsupported_county",
        message: `We do not deliver to ${input.county} yet.`,
      };
    }

    const baseFee = Number(area.rows[0].base_fee);
    const threshold = area.rows[0].free_delivery_threshold;

    const bySeller = new Map<
      string,
      { sellerId: string; subtotal: number; items: typeof lines.rows }
    >();
    for (const line of lines.rows) {
      const entry = bySeller.get(line.seller_id) ?? {
        sellerId: line.seller_id,
        subtotal: 0,
        items: [],
      };
      const qty = Number(line.quantity);
      const unit = Number(line.price);
      entry.subtotal += unit * qty;
      entry.items.push(line);
      bySeller.set(line.seller_id, entry);
    }

    /*
      Decrement real stock and hand the reservation to the order, per line.

      The WHERE clauses are the guard, not the JS above. `stock >= qty` makes
      the decrement fail rather than go negative, and `stock_reserved >= qty`
      confirms the hold we are consuming actually exists. If either fails the
      row count is 0 and the whole transaction rolls back.

      Decrementing `stock` here and only here is why the cart could safely
      hold stock without owning it.
    */
    for (const line of lines.rows) {
      const qty = Number(line.quantity);

      const decremented = await conn.query(
        `UPDATE products
            SET stock = stock - $2,
                stock_reserved = stock_reserved - $2
          WHERE id = $1 AND stock >= $2 AND stock_reserved >= $2
        RETURNING id`,
        [line.product_id, qty],
      );

      if (decremented.rowCount === 0) {
        await conn.query("ROLLBACK");
        return {
          ok: false,
          reason: "unavailable_item",
          message: `"${line.title}" sold out while you were checking out.`,
        };
      }

      /*
        Decrement the counter only. The hold itself moves to the order further
        below, once an order row exists to move it to.
      */
    }

    const address = {
      recipientName: input.recipientName.trim(),
      county: input.county,
      town: input.town.trim(),
      street: input.street?.trim() || null,
    };

    const references: string[] = [];
    let grandTotal = 0;

    for (const group of bySeller.values()) {
      const subtotal = round2(group.subtotal);
      const qualifies = threshold !== null && subtotal >= Number(threshold);
      const fee = qualifies ? 0 : baseFee;
      const total = round2(subtotal + fee);

      // Reference is human-quotable: buyers read it out over the phone.
      const reference = `SK${Date.now().toString(36).toUpperCase()}${Math.random()
        .toString(36)
        .slice(2, 6)
        .toUpperCase()}`;

      const inserted = await conn.query<{ id: string }>(
        `INSERT INTO orders
           (reference, seller_id, status, subtotal, delivery_total, grand_total,
            county, payment_method, payment_status, delivery_address,
            delivery_phone, delivery_notes, expires_at)
         VALUES ($1, $2, 'confirmed', $3, $4, $5, $6, 'cod', 'unpaid', $7, $8, $9, NULL)
         RETURNING id`,
        [
          reference,
          group.sellerId,
          subtotal,
          fee,
          total,
          input.county,
          JSON.stringify(address),
          input.phone,
          input.notes?.trim() || null,
        ],
      );

      const orderId = inserted.rows[0].id;
      grandTotal += total;
      references.push(reference);

      for (const item of group.items) {
        const qty = Number(item.quantity);
        const unit = Number(item.price);

        await conn.query(
          `INSERT INTO order_items
             (order_id, product_id, title_snapshot, unit_price, quantity, line_total)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            orderId,
            item.product_id,
            item.title,
            unit,
            qty,
            round2(unit * qty),
          ],
        );
      }

      /*
        Hand this seller's holds to its order. cart_id and order_id are written
        in ONE statement because the num_nonnulls(cart_id, order_id) = 1 CHECK
        forbids a row with both set or neither — so they cannot be updated
        separately without violating it in between.
      */
      await conn.query(
        `UPDATE stock_reservations
            SET cart_id = NULL, order_id = $2
          WHERE cart_id = $1
            AND released_at IS NULL
            AND product_id IN (
              SELECT product_id FROM order_items WHERE order_id = $2
            )`,
        [cartId, orderId],
      );

      await conn.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
         VALUES ($1, NULL, 'confirmed', 'checkout', 'Order placed')`,
        [orderId],
      );
    }

    /*
      Convert the cart last. Until this statement runs the cart is still
      active and every order above is reversible by the ROLLBACK — which is
      exactly the ordering that makes a partial checkout impossible.
    */
    await conn.query(
      `UPDATE carts SET status = 'converted', updated_at = now() WHERE id = $1`,
      [cartId],
    );
    await conn.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);

    await conn.query("COMMIT");

    return { ok: true, references, grandTotal: round2(grandTotal) };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    const e = err as { message?: string; constraint?: string };
    throw new Error(`checkout failed: ${e.message ?? "unknown error"}`);
  } finally {
    conn.release();
  }
}

/**
 * Money is in cents from here on.
 *
 * 0.1 + 0.2 !== 0.3 in binary floating point, and a marketplace that rounds
 * wrongly at the ninth decimal is a marketplace whose totals do not reconcile
 * against its line items. Rounding once, at the boundary, keeps the CHECK
 * constraint on orders satisfiable.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type OrderSummary = {
  reference: string;
  status: string;
  subtotal: number;
  deliveryTotal: number;
  grandTotal: number;
  county: string;
  createdAt: string;
  sellerName: string;
  address: { recipientName: string; county: string; town: string; street: string | null };
  phone: string | null;
  items: Array<{
    title: string;
    slug: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  history: Array<{ fromStatus: string | null; toStatus: string; createdAt: string }>;
};

export async function getOrdersByReferences(
  references: string[],
): Promise<OrderSummary[]> {
  if (references.length === 0) return [];

  const orders = await query<Record<string, any>>(
    `SELECT o.id, o.reference, o.status, o.subtotal, o.delivery_total,
            o.grand_total, o.county, o.created_at, o.delivery_address,
            o.delivery_phone, o.expires_at,
            s.name AS seller_name
       FROM orders o
       JOIN sellers s ON s.id = o.seller_id
      WHERE o.reference = ANY($1::text[])
      ORDER BY o.created_at`,
    [references],
  );

  const ids = orders.map((o) => o.id);

  const items = await query<Record<string, any>>(
    `SELECT oi.order_id, oi.title_snapshot, oi.unit_price, oi.quantity,
            oi.line_total, p.slug
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ANY($1::uuid[])
      ORDER BY oi.title_snapshot`,
    [ids],
  );

  const history = await query<Record<string, any>>(
    `SELECT order_id, from_status, to_status, created_at
       FROM order_status_history
      WHERE order_id = ANY($1::uuid[])
      ORDER BY created_at`,
    [ids],
  );

  return orders.map((o) => ({
    reference: o.reference,
    status: o.status,
    subtotal: Number(o.subtotal),
    deliveryTotal: Number(o.delivery_total),
    grandTotal: Number(o.grand_total),
    county: o.county,
    createdAt: o.created_at,
    sellerName: o.seller_name,
    address: (o.delivery_address ?? {}) as OrderSummary["address"],
    phone: o.delivery_phone,
    items: items
      .filter((i) => i.order_id === o.id)
      .map((i) => ({
        title: i.title_snapshot,
        slug: i.slug,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
      })),
    history: history
      .filter((h) => h.order_id === o.id)
      .map((h) => ({
        fromStatus: h.from_status,
        toStatus: h.to_status,
        createdAt: h.created_at,
      })),
  }));
}

/** One reference, for the /order/[reference] route. */
export async function getOrderByReference(
  reference: string,
): Promise<OrderSummary | null> {
  const [order] = await getOrdersByReferences([reference]);
  return order ?? null;
}

export type { CartView };
