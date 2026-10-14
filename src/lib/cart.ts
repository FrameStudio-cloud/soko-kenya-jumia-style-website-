import { cookies } from "next/headers";
import { client, query } from "@/db";

/*
  Cart and reservation logic. Every stock change goes through one of these,
  so the reservation invariant has exactly one implementation to audit.

  The invariant, stated once:

    available(product) = stock - stock_reserved
    stock_reserved     = sum(quantity) over live reservations

  It holds because stock_reserved is only ever changed by RESERVE_SQL and
  RELEASE_SQL, both of which are single atomic statements. No read-then-write
  anywhere.
*/

export const RESERVATION_MINUTES = 30;
export const MAX_QUANTITY_PER_LINE = 10;

const RESERVE_SQL = `
  UPDATE products
     SET stock_reserved = stock_reserved + $2
   WHERE id = $1
     AND status = 'active'
     AND stock - stock_reserved >= $2
  RETURNING stock, stock_reserved
`;

const RELEASE_SQL = `
  UPDATE products
     SET stock_reserved = greatest(0, stock_reserved - $2)
   WHERE id = $1
  RETURNING stock_reserved
`;

export type CartResult =
  | { ok: true; cartId: string; quantity: number; available: number }
  | {
      ok: false;
      reason:
        | "not_found"
        | "sold_out"
        | "insufficient_stock"
        | "quantity_limit";
      available: number;
    };

const CART_COOKIE = "soko_cart";
const CART_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Read the cart session id, or undefined if this shopper has none.
 *
 * READ ONLY. A page render cannot set a cookie: Next.js allows cookie writes
 * only inside a Server Action or Route Handler, and calling `set` during
 * render throws. The first attempt did exactly that and 500'd on /cart.
 *
 * So the cookie is minted in a Route Handler (see app/cart/session/route.ts)
 * which the header links to on first visit, and every read path tolerates its
 * absence by treating the shopper as having no cart yet.
 */
export async function readCartSessionId(): Promise<string | undefined> {
  /*
    TEST SEAM — exists only so scripts/test-place-order-real.ts can call
    placeOrder() outside a Next request scope.

    placeOrder must be tested as written, not re-transcribed: a test that
    shares nothing with the implementation cannot catch an error where both are
    wrong the same way. But cookies() needs a request, and mocking that would
    mean stubbing the very thing under test.

    Set by the test process before importing this module. Unset in the app, so
    this branch never runs in production. If you find yourself wanting to set
    it outside a test, the seam has outgrown its purpose.
  */
  if (process.env.CART_SESSION_OVERRIDE) {
    return process.env.CART_SESSION_OVERRIDE;
  }

  const jar = await cookies();
  return jar.get(CART_COOKIE)?.value;
}

/**
 * Mint the session cookie. Server Action / Route Handler only.
 *
 * httpOnly   script cannot read or forge it.
 * sameSite   lax survives top-level navigation and blocks cross-site POSTs,
 *            which is the entire CSRF surface for a cookie-keyed cart.
 * maxAge     30 days, so a cart survives a shopping session without the cookie
 *            becoming permanent.
 *
 * NOT signed yet. Phase 2 has no auth secret to sign with, so the value is a
 * random UUID rather than a signed token — unguessable, but not tamper-evident.
 * When Neon Auth lands, add an HMAC over this value and reject unsigned
 * cookies: an unsigned cart id is a cart-id oracle, and a forged one exposes
 * someone else's cart. Tracked in the phase 3 notes, not forgotten.
 */
export async function issueCartSessionCookie(): Promise<string> {
  const id = crypto.randomUUID();
  const jar = await cookies();

  jar.set(CART_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CART_MAX_AGE_SECONDS,
  });

  return id;
}

/**
 * The cart this shopper is operating on.
 *
 * `required: false` everywhere a cart can legitimately not exist yet — a
 * first-time visitor reading a page. Only mutations demand a session, and they
 * get a clear error rather than a crash if the cookie is somehow missing.
 */
export async function getOrCreateCart(): Promise<{ id: string }> {
  const sessionId = await readCartSessionId();
  if (!sessionId) {
    throw new Error(
      "No cart session. The cart cookie is issued by /cart/session — call that before mutating the cart.",
    );
  }

  const conn = await client();

  try {
    await conn.query("BEGIN");

    const existingRows = await conn.query<{ id: string }>(
      `SELECT id FROM carts WHERE session_id = $1 AND status = 'active' LIMIT 1`,
      [sessionId],
    );
    const existing = existingRows.rows[0];
    if (existing) {
      await conn.query("COMMIT");
      return existing;
    }

    /*
      ON CONFLICT DO NOTHING then re-select. Two tabs can reach this at once;
      the partial unique index lets exactly one insert win and the loser reads
      the winner's row. A bare INSERT would surface a duplicate-key error to a
      user who did nothing wrong.
    */
    const createdRows = await conn.query<{ id: string }>(
      `INSERT INTO carts (session_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`,
      [sessionId],
    );
    const created = createdRows.rows[0];
    if (created) {
      await conn.query("COMMIT");
      return created;
    }

    const racedRows = await conn.query<{ id: string }>(
      `SELECT id FROM carts WHERE session_id = $1 AND status = 'active' LIMIT 1`,
      [sessionId],
    );
    await conn.query("COMMIT");

    const raced = racedRows.rows[0];
    if (!raced) throw new Error("could not create or find an active cart");
    return raced;
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Add to cart, holding stock atomically.
 *
 * Order of operations matters. The reservation is taken FIRST: if the cart
 * line were written first and the reservation failed, the cart would show an
 * item nobody can buy. A cart holding something unavailable is a support
 * ticket; a reservation without a cart line is invisible and self-heals.
 *
 * Whole operation runs in one transaction so a failure rolls the hold back.
 * Without that, a failed insert would leak reserved stock until expiry.
 */
export async function addToCart(
  productId: string,
  quantity: number,
): Promise<CartResult> {
  const wanted = Math.max(1, Math.floor(quantity));

  if (wanted > MAX_QUANTITY_PER_LINE) {
    const [row] = await query<{ available: number }>(
      `SELECT (stock - stock_reserved)::int AS available FROM products WHERE id = $1`,
      [productId],
    );
    return {
      ok: false,
      reason: "quantity_limit",
      available: row?.available ?? 0,
    };
  }

  const cart = await getOrCreateCart();
  const conn = await client();

  try {
    await conn.query("BEGIN");

    const reserved = await conn.query<{ stock: number; stock_reserved: number }>(
      RESERVE_SQL,
      [productId, wanted],
    );

    if (reserved.rowCount === 0) {
      await conn.query("ROLLBACK");

      /*
        Distinguish "no such product" from "sold out" by looking again. The
        UPDATE matched nothing for either reason, and telling a shopper a
        product is sold out when it has been delisted sends them looking for
        a discount that does not exist.
      */
      /*
        Read on the SAME connection. The transaction was rolled back, so this
        connection is still ours; borrowing a different one from the pool here
        would work but hides that the reads are outside the transaction.
      */
      const result = await conn.query<{ stock: number; stock_reserved: number }>(
        `SELECT stock, stock_reserved FROM products WHERE id = $1`,
        [productId],
      );
      const row = result.rows[0];

      if (!row) {
        return { ok: false, reason: "not_found", available: 0 };
      }
      return {
        ok: false,
        reason: "sold_out",
        available: Number(row.stock) - Number(row.stock_reserved),
      };
    }

    /*
      Upsert rather than insert-or-select, so re-adding increments the line.
      The hold is always the INCREMENT, never the new total: the previous
      units are already counted in stock_reserved, and re-reserving the total
      would double-count them.
    */
    await conn.query(
      `
      INSERT INTO cart_items (cart_id, product_id, quantity, added_price)
      SELECT $1, p.id, $2, p.price
        FROM products p WHERE p.id = $3
      ON CONFLICT (cart_id, product_id) DO UPDATE
        SET quantity = cart_items.quantity + EXCLUDED.quantity,
            created_at = now()
      `,
      [cart.id, wanted, productId],
    );

    /*
      Refresh the hold's expiry. A shopper actively shopping keeps their
      units; an abandoned one lapses on schedule.
    */
    await conn.query(
      `
      UPDATE stock_reservations
         SET expires_at = now() + ($3 || ' minutes')::interval
       WHERE product_id = $1 AND cart_id = $2 AND released_at IS NULL
      `,
      [productId, cart.id, String(RESERVATION_MINUTES)],
    );

    await conn.query("COMMIT");

    const lineRows = await conn.query<{ quantity: number }>(
      `SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2`,
      [cart.id, productId],
    );

    return {
      ok: true,
      cartId: cart.id,
      quantity: Number(lineRows.rows[0]?.quantity ?? wanted),
      available: reserved.rows[0].stock - reserved.rows[0].stock_reserved,
    };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Set an exact line quantity. Releases the hold difference, in both directions. */
export async function setCartItemQuantity(
  productId: string,
  quantity: number,
): Promise<CartResult> {
  const cart = await getOrCreateCart();
  const target = Math.floor(quantity);

  const [line] = await query<{ quantity: number }>(
    `SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2`,
    [cart.id, productId],
  );

  if (!line) return { ok: false, reason: "not_found", available: 0 };

  const current = Number(line.quantity);

  if (target <= 0) {
    await removeFromCart(productId);
    return { ok: true, cartId: cart.id, quantity: 0, available: 0 };
  }

  const delta = target - current;
  if (delta === 0) {
    return { ok: true, cartId: cart.id, quantity: target, available: 0 };
  }

  const conn = await client();

  try {
    await conn.query("BEGIN");

    if (delta > 0) {
      // Need more units: take the difference as a hold.
      const reserved = await conn.query<{ stock: number; stock_reserved: number }>(
        RESERVE_SQL,
        [productId, delta],
      );
      if (reserved.rowCount === 0) {
        await conn.query("ROLLBACK");
        const [row] = await query<{ stock: number; stock_reserved: number }>(
          `SELECT stock, stock_reserved FROM products WHERE id = $1`,
          [productId],
        );
        if (!row) return { ok: false, reason: "not_found", available: 0 };
        return {
          ok: false,
          reason: "insufficient_stock",
          available: Number(row.stock) - Number(row.stock_reserved),
        };
      }
    } else {
      // Releasing: decrement the counter and shorten the reservation.
      await conn.query(RELEASE_SQL, [productId, Math.abs(delta)]);
    }

    await conn.query(
      `UPDATE cart_items SET quantity = $1 WHERE cart_id = $2 AND product_id = $3`,
      [target, cart.id, productId],
    );

    await conn.query(
      `
      UPDATE stock_reservations
         SET expires_at = now() + ($4 || ' minutes')::interval
       WHERE product_id = $1 AND cart_id = $2 AND released_at IS NULL
      `,
      [productId, cart.id, String(RESERVATION_MINUTES)],
    );

    await conn.query("COMMIT");

    return { ok: true, cartId: cart.id, quantity: target, available: 0 };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Remove a line and release its hold. */
export async function removeFromCart(productId: string): Promise<void> {
  const cart = await getOrCreateCart();

  const [line] = await query<{ quantity: number }>(
    `SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2`,
    [cart.id, productId],
  );
  if (!line) return;

  const conn = await client();

  try {
    await conn.query("BEGIN");
    await conn.query(RELEASE_SQL, [productId, Number(line.quantity)]);
    await conn.query(
      `DELETE FROM stock_reservations
        WHERE product_id = $1 AND cart_id = $2 AND released_at IS NULL`,
      [productId, cart.id],
    );
    await conn.query(
      `DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2`,
      [cart.id, productId],
    );
    await conn.query("COMMIT");
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Release every hold in the cart, e.g. after checkout. */
export async function clearCart(): Promise<void> {
  const cart = await getOrCreateCart();

  const conn = await client();
  try {
    await conn.query("BEGIN");
    await conn.query(
      `
      UPDATE products p
         SET stock_reserved = greatest(0, p.stock_reserved - r.qty)
        FROM (
          SELECT product_id, sum(quantity)::int AS qty
            FROM stock_reservations
           WHERE cart_id = $1 AND released_at IS NULL
           GROUP BY product_id
        ) r
       WHERE p.id = r.product_id
      `,
      [cart.id],
    );
    await conn.query(
      `UPDATE stock_reservations SET released_at = now()
        WHERE cart_id = $1 AND released_at IS NULL`,
      [cart.id],
    );
    await conn.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cart.id]);
    await conn.query("COMMIT");
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * The empty cart. A shared constant so every "no session" path returns the
 * same shape and no caller has to null-check four fields.
 */
function emptyCart(): CartView {
  return {
    id: "",
    items: [],
    sellers: [],
    itemCount: 0,
    subtotal: 0,
    unavailableCount: 0,
  };
}

export type CartView = {
  id: string;
  items: Array<{
    productId: string;
    slug: string;
    title: string;
    quantity: number;
    /* Price NOW, not price when added. The buyer pays the current price. */
    unitPrice: number;
    /* Display-only, so the cart can flag a price change. */
    addedPrice: number;
    priceChanged: boolean;
    lineTotal: number;
    available: number;
    imageKey: string | null;
    sellerId: string;
    sellerName: string;
  }>;
  /** Grouped by seller, in first-seen order. One order per seller. */
  sellers: Array<{
    id: string;
    name: string;
    items: CartView["items"];
  }>;
  itemCount: number;
  subtotal: number;
  /*
    Count of lines whose hold has lapsed or whose product sold out meanwhile.
    Surfaced as a notice rather than hidden, because a cart that silently
    contains an unbuyable item is the classic marketplace bug.
  */
  unavailableCount: number;
};

export async function getCartView(): Promise<CartView> {
  const sessionId = await readCartSessionId();
  // No cookie yet means no cart yet. An empty cart is a valid answer,
  // not an error � this runs on every page render via the header badge.
  if (!sessionId) return emptyCart();

  const rows = await query<{
    cart_id: string;
    product_id: string;
    slug: string;
    title: string;
    quantity: number;
    unit_price: string;
    added_price: string;
    available: number;
    object_key: string | null;
    seller_id: string;
    seller_name: string;
  }>(
    `
    SELECT ci.cart_id, ci.product_id,
           p.slug, p.title, ci.quantity,
           p.price AS unit_price, ci.added_price,
           (p.stock - p.stock_reserved)::int AS available,
           pi.object_key,
           s.id AS seller_id, s.name AS seller_name
      FROM cart_items ci
      JOIN carts c ON c.id = ci.cart_id
      JOIN products p ON p.id = ci.product_id
      JOIN sellers s ON s.id = p.seller_id
      LEFT JOIN LATERAL (
        SELECT object_key FROM product_images
         WHERE product_id = p.id
         ORDER BY position LIMIT 1
      ) pi ON true
     WHERE c.session_id = $1 AND c.status = 'active'
     ORDER BY ci.created_at
  `,
    [sessionId],
  );

  const items = rows.map((r) => {
    const unitPrice = Number(r.unit_price);
    const addedPrice = Number(r.added_price);
    return {
      productId: r.product_id,
      slug: r.slug,
      title: r.title,
      quantity: Number(r.quantity),
      unitPrice,
      addedPrice,
      priceChanged: addedPrice !== unitPrice,
      lineTotal: unitPrice * Number(r.quantity),
      available: Number(r.available),
      imageKey: r.object_key,
      sellerId: r.seller_id,
      sellerName: r.seller_name,
    };
  });

  /*
    Sellers, grouped. One order belongs to one seller, so a mixed basket
    becomes N orders at checkout — the shopper pays once, each seller
    fulfils one shipment. Surfacing the split in the cart means the count is
    never a surprise at checkout.
  */
  const sellerMap = new Map<string, { id: string; name: string; items: typeof items }>();
  for (const item of items) {
    const entry = sellerMap.get(item.sellerId) ?? {
      id: item.sellerId,
      name: item.sellerName,
      items: [] as typeof items,
    };
    entry.items.push(item);
    sellerMap.set(item.sellerId, entry);
  }

  return {
    id: rows[0]?.cart_id ?? "",
    items,
    sellers: [...sellerMap.values()],
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotal: items.reduce((n, i) => n + i.lineTotal, 0),
    unavailableCount: items.filter((i) => i.available < i.quantity).length,
  };
}

/** Just the header badge count. Cheap enough to render on every page. */
export async function getCartCount(): Promise<number> {
  const sessionId = await readCartSessionId();
  if (!sessionId) return 0;

  const [row] = await query<{ n: number }>(
    `
    SELECT COALESCE(sum(ci.quantity), 0)::int AS n
      FROM cart_items ci
      JOIN carts c ON c.id = ci.cart_id
     WHERE c.session_id = $1 AND c.status = 'active'
  `,
    [sessionId],
  );

  return Number(row?.n ?? 0);
}

/**
 * Release holds whose window has closed.
 *
 * Correctness does NOT depend on this running — the availability query
 * filters on expires_at itself. This exists to stop lapsed rows accumulating.
 * A cron that silently stops causes table growth, not overselling, which is
 * the property that makes the system safe to operate.
 */
export async function sweepExpiredReservations(): Promise<number> {
  /*
    One statement, so the decrement and the release cannot disagree.

    FOR UPDATE SKIP LOCKED is what lets several sweepers run concurrently
    without double-releasing: each claims a disjoint set of expired rows, and
    rows another sweeper already claimed are skipped rather than waited on.
    Without SKIP LOCKED a second sweeper blocks, and with plain FOR UPDATE the
    two could still process the same row and decrement the counter twice.

    greatest(0, ...) is belt and braces, not the primary defence: if the
    counter ever drifted below the true hold total this clamps at zero rather
    than going negative, which would let the CHECK constraint reject the
    statement and strand the sweep.
  */
  const released = await query<{ n: number }>(`
    WITH expired AS (
      SELECT id, product_id, quantity
        FROM stock_reservations
       WHERE released_at IS NULL AND expires_at <= now()
       FOR UPDATE SKIP LOCKED
    ), marked AS (
      UPDATE stock_reservations sr
         SET released_at = now()
        FROM expired e
       WHERE sr.id = e.id
      RETURNING sr.product_id, sr.quantity
    ), decremented AS (
      UPDATE products p
         SET stock_reserved = greatest(0, p.stock_reserved - r.qty)
        FROM (
          SELECT product_id, sum(quantity)::int AS qty
            FROM marked GROUP BY product_id
        ) r
       WHERE p.id = r.product_id
      RETURNING p.id
    )
    SELECT count(*)::int AS n FROM decremented
  `);

  return Number(released[0]?.n ?? 0);
}
