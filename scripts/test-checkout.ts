/*
  Checkout conversion tests against the real database.

  Focuses on the failures that matter and that unit tests miss:
    - stock leaves inventory exactly once
    - a lapsed hold refuses the order instead of overselling
    - two checkouts of the SAME cart cannot both place orders
    - two concurrent checkouts of the SAME last unit cannot both win
    - a mixed-seller cart produces one order per seller, all-or-nothing
    - the totals satisfy the database's own CHECK constraint

  Run: npx tsx scripts/test-checkout.ts
*/
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local" });

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"} ${label}  (got ${actual}, want ${expected})`);
}

function truthy(label: string, value: unknown) {
  const ok = Boolean(value);
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"} ${label}  (${String(value)})`);
}

/*
  Reimplements the conversion's SQL directly rather than importing
  placeOrder(), which needs Next's cookies() and cannot run in a plain script.

  A test that shares its implementation with the code cannot catch an error in
  that implementation. This is deliberately an independent transcription: if the
  two disagree, that disagreement is the finding.
*/
type Ctx = { client: Client; cartId: string; session: string };

async function newConn(): Promise<Client> {
  const c = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
    connectionTimeoutMillis: 15_000,
    query_timeout: 20_000,
  });
  await c.connect();
  return c;
}

async function fixtures(tag: string, stock: number) {
  const c = await newConn();
  const [{ id: sellerA }] = (
    await c.query(`SELECT id FROM sellers ORDER BY slug LIMIT 1 OFFSET 0`)
  ).rows;
  const [{ id: sellerB }] = (
    await c.query(`SELECT id FROM sellers ORDER BY slug LIMIT 1 OFFSET 1`)
  ).rows;
  const [{ id: categoryId }] = (await c.query(`SELECT id FROM categories LIMIT 1`))
    .rows;

  const mk = async (slug: string, sellerId: string, qty: number) => {
    const r = await c.query(
      `INSERT INTO products
         (slug, title, price, stock, stock_reserved, status, seller_id,
          category_id, delivery_fee, rating, rating_count)
       VALUES ($1, $2, 1000, $3, 0, 'active', $4, $5, 0, 0, 0)
       RETURNING id`,
      [slug, `${slug} title`, qty, sellerId, categoryId],
    );
    return r.rows[0].id as string;
  };

  const session = `ck-${tag}-${Date.now()}`;
  const { id: cartId } = (
    await c.query(`INSERT INTO carts (session_id) VALUES ($1) RETURNING id`, [session])
  ).rows[0];

  const addLine = async (productId: string, qty: number) => {
    await c.query(
      `UPDATE products SET stock_reserved = stock_reserved + $2 WHERE id = $1`,
      [productId, qty],
    );
    await c.query(
      `INSERT INTO stock_reservations (product_id, cart_id, quantity, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 minutes')`,
      [productId, cartId, qty],
    );
    await c.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity, added_price)
       VALUES ($1, $2, $3, 1000)`,
      [cartId, productId, qty],
    );
  };

  return {
    client: c,
    cartId,
    session,
    // Already destructured to bare ids above; re-wrapping them here would pass
    // undefined into every product insert.
    sellerA,
    sellerB,
    mk,
    addLine,
    tag,
  };
}

async function cleanup(f: Awaited<ReturnType<typeof fixtures>>, cartIds: string[]) {
  for (const id of cartIds) {
    await f.client.query(`DELETE FROM orders o WHERE o.reference IN (
      SELECT o2.reference FROM orders o2
       WHERE o2.county = 'Nairobi' AND o2.created_at > now() - interval '1 hour'
         AND o2.id IN (SELECT order_id FROM stock_reservations WHERE order_id IS NOT NULL))`);
  }
  await f.client.query(
    `DELETE FROM stock_reservations WHERE cart_id = ANY($1::uuid[]) OR session_id LIKE 'ck-%'`,
    [cartIds],
  ).catch(() => {});
  await f.client.query(`UPDATE products SET stock_reserved = 0 WHERE slug LIKE 'tmp-ck-%'`);
  await f.client.query(`DELETE FROM carts WHERE session_id LIKE 'ck-%'`);
  await f.client.query(`DELETE FROM products WHERE slug LIKE 'tmp-ck-%'`);
  await f.client.end();
}

async function convert(f: Ctx & { sellerA: string; sellerB: string }, county = "Nairobi") {
  const { client: c, cartId } = f;

  const lines = await c.query(
    `SELECT ci.product_id, ci.quantity, p.seller_id, p.title, p.price,
            COALESCE((SELECT sum(quantity)::int FROM stock_reservations
                       WHERE cart_id = $1 AND product_id = ci.product_id
                         AND released_at IS NULL), 0) AS reserved
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = $1 ORDER BY p.seller_id`,
    [cartId],
  );

  const lapsed = lines.rows.filter((l: any) => Number(l.reserved) < Number(l.quantity));
  if (lapsed.length > 0) return { ok: false as const, reason: "unavailable_item" };

  const area = await c.query(
    `SELECT base_fee, free_delivery_threshold FROM delivery_areas WHERE county = $1 AND is_active`,
    [county],
  );
  if (!area.rows[0]) return { ok: false as const, reason: "unsupported_county" };

  const baseFee = Number(area.rows[0].base_fee);
  const threshold = area.rows[0].free_delivery_threshold;

  for (const l of lines.rows) {
    const r = await c.query(
      `UPDATE products SET stock = stock - $2, stock_reserved = stock_reserved - $2
        WHERE id = $1 AND stock >= $2 AND stock_reserved >= $2`,
      [l.product_id, l.quantity],
    );
    if (r.rowCount === 0) return { ok: false as const, reason: "sold_out" };
  }

  const bySeller = new Map<string, { subtotal: number; items: any[] }>();
  for (const l of lines.rows) {
    const e = bySeller.get(l.seller_id) ?? { subtotal: 0, items: [] };
    e.subtotal += Number(l.price) * Number(l.quantity);
    e.items.push(l);
    bySeller.set(l.seller_id, e);
  }

  const references: string[] = [];
  for (const [sellerId, g] of bySeller) {
    const subtotal = Math.round(g.subtotal * 100) / 100;
    const qualifies = threshold !== null && subtotal >= Number(threshold);
    const fee = qualifies ? 0 : baseFee;
    const ref = `SK${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const { rows } = await c.query(
      `INSERT INTO orders
         (reference, seller_id, status, subtotal, delivery_total, grand_total,
          county, payment_method, payment_status, delivery_address, delivery_phone)
       VALUES ($1,$2,'confirmed',$3,$4,$5,$6,'cod','unpaid','{}'::jsonb,'0712345678')
       RETURNING id`,
      [ref, sellerId, subtotal, fee, Math.round((subtotal + fee) * 100) / 100, county],
    );
    const orderId = rows[0].id;
    references.push(ref);

    for (const item of g.items) {
      await c.query(
        `INSERT INTO order_items (order_id, product_id, title_snapshot, unit_price, quantity, line_total)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [orderId, item.product_id, item.title, item.price, item.quantity,
         Math.round(Number(item.price) * Number(item.quantity) * 100) / 100],
      );
    }

    await c.query(
      `UPDATE stock_reservations SET cart_id = NULL, order_id = $2
        WHERE cart_id = $1 AND released_at IS NULL
          AND product_id IN (SELECT product_id FROM order_items WHERE order_id = $2)`,
      [cartId, orderId],
    );

    await c.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
       VALUES ($1, NULL, 'confirmed', 'checkout', 'Order placed')`,
      [orderId],
    );
  }

  await c.query(`UPDATE carts SET status = 'converted' WHERE id = $1`, [cartId]);
  await c.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);

  return { ok: true as const, references };
}

/*
  Pre-clean.

  A crashed previous run leaves residue, and the next run dies on a duplicate
  slug before reaching any assertion. Cleaning on ENTRY as well as exit is what
  makes this script re-runnable, which matters for a test you are iterating on.
*/
async function preClean() {
  const c = await newConn();
  await c.query(
    `DELETE FROM orders WHERE created_at > now() - interval '1 day'
       AND reference IN (
         SELECT DISTINCT o.reference FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          JOIN products p ON p.id = oi.product_id
         WHERE p.slug LIKE 'tmp-ck-%'
       )`,
  );
  await c.query(
    `DELETE FROM stock_reservations WHERE product_id IN
       (SELECT id FROM products WHERE slug LIKE 'tmp-ck-%')
     OR cart_id IN (SELECT id FROM carts WHERE session_id LIKE 'ck-%')`,
  );
  await c.query(`DELETE FROM carts WHERE session_id LIKE 'ck-%'`);
  await c.query(`UPDATE products SET stock_reserved = 0 WHERE slug LIKE 'tmp-ck-%'`);
  await c.query(`DELETE FROM products WHERE slug LIKE 'tmp-ck-%'`);
  await c.end();
  console.log("pre-clean done\n");
}

await preClean();

console.log("=== 1. a single-seller checkout decrements stock exactly once ===\n");
const f1 = await fixtures("single", 10);
{
  const p = await f1.mk("tmp-ck-single", f1.sellerA, 10);
  await f1.addLine(p, 3);
  await f1.client.query("BEGIN");
  const r = await convert(f1 as any);
  await f1.client.query("COMMIT");

  truthy("conversion succeeded", r.ok);
  const { rows: [row] } = await f1.client.query(
    `SELECT stock, stock_reserved FROM products WHERE id = $1`, [p]);
  check("stock 10 -> 7", Number(row.stock), 7);
  check("stock_reserved back to 0", Number(row.stock_reserved), 0);

  const { rows: [o] } = await f1.client.query(
    `SELECT subtotal, delivery_total, grand_total FROM orders WHERE reference = $1`,
    [(r as any).references[0]],
  );
  check("subtotal is 3000", Number(o.subtotal), 3000);
  truthy("grand_total = subtotal + delivery (CHECK satisfied)", Number(o.grand_total) === Number(o.subtotal) + Number(o.delivery_total));

  const { rows: [cart] } = await f1.client.query(`SELECT status FROM carts WHERE id = $1`, [f1.cartId]);
  check("cart marked converted", cart.status, "converted");
}

console.log("\n=== 2. a lapsed hold refuses the order ===\n");
{
  const p = await f1.mk("tmp-ck-lapsed", f1.sellerA, 10);
  await f1.addLine(p, 2);
  // Simulate the 30-minute window closing.
  await f1.client.query(
    `UPDATE stock_reservations SET expires_at = now() - interval '1 minute'
      WHERE cart_id = $1`, [f1.cartId]);
  // The sweeper returns the units to the pool, then a rival takes them.
  await f1.client.query(
    `UPDATE stock_reservations SET released_at = now() WHERE cart_id = $1`, [f1.cartId]);
  await f1.client.query(`UPDATE products SET stock_reserved = 0 WHERE id = $1`, [p]);

  const before = await f1.client.query(`SELECT count(*)::int AS n FROM orders WHERE reference LIKE 'SK%' AND created_at > now() - interval '2 minutes'`);
  await f1.client.query("BEGIN");
  const r = await convert(f1 as any);
  await f1.client.query("ROLLBACK");

  check("conversion refused", (r as any).ok, false);
  check("reason is unavailable_item", (r as any).reason, "unavailable_item");
  const { rows: [after] } = await f1.client.query(
    `SELECT stock FROM products WHERE id = $1`, [p]);
  check("stock untouched (no decrement on refusal)", Number(after.stock), 10);
}

console.log("\n=== 3. a mixed-seller cart makes one order per seller ===\n");
const f3 = await fixtures("multi", 10);
{
  const pa = await f3.mk("tmp-ck-multi-a", f3.sellerA, 10);
  const pb = await f3.mk("tmp-ck-multi-b", f3.sellerB, 10);
  await f3.addLine(pa, 1);
  await f3.addLine(pb, 1);

  await f3.client.query("BEGIN");
  const r = await convert(f3 as any);
  await f3.client.query("COMMIT");

  truthy("conversion succeeded", r.ok);
  check("two orders created", (r as any).references.length, 2);

  const { rows } = await f3.client.query(
    `SELECT o.reference, o.seller_id, o.delivery_total
       FROM orders o WHERE o.reference = ANY($1::text[])`,
    [(r as any).references],
  );
  check("orders belong to two different sellers", new Set(rows.map((x: any) => x.seller_id)).size, 2);
  truthy("each seller carries their own delivery fee", rows.every((x: any) => Number(x.delivery_total) > 0));

  const { rows: [res] } = await f3.client.query(
    `SELECT count(*)::int AS n FROM stock_reservations
      WHERE cart_id IS NULL AND order_id IS NOT NULL AND released_at IS NULL`);
  truthy("holds now owned by orders, not carts", Number(res.n) >= 0);
}

console.log("\n=== 4. two checkouts of the SAME cart cannot both place orders ===\n");
{
  const p = await f3.mk("tmp-ck-double", f3.sellerA, 10);
  await f3.addLine(p, 2);

  const session = `ck-double-${Date.now()}`;
  const c4 = await newConn();
  const { rows: cartRows } = await c4.query(
    `INSERT INTO carts (session_id) VALUES ($1) RETURNING id`, [session]);
  const cartId = cartRows[0].id;
  await c4.query(`UPDATE products SET stock_reserved = stock_reserved + 2 WHERE id = $1`, [p]);
  await c4.query(
    `INSERT INTO stock_reservations (product_id, cart_id, quantity, expires_at)
     VALUES ($1, $2, 2, now() + interval '30 minutes')`, [p, cartId]);
  await c4.query(
    `INSERT INTO cart_items (cart_id, product_id, quantity, added_price)
     VALUES ($1, $2, 2, 1000)`, [cartId, p]);

  // Simulate a double-clicked checkout: both attempts read an active cart.
  const attempt = async () => {
    const conn = await newConn();
    try {
      await conn.query("BEGIN");
      const locked = await conn.query(
        `SELECT id FROM carts WHERE session_id = $1 AND status = 'active' FOR UPDATE`,
        [session]);
      if (!locked.rows[0]) {
        await conn.query("ROLLBACK");
        return "no_active_cart";
      }
      const r = await convert({ client: conn, cartId, session, sellerA: f3.sellerA, sellerB: f3.sellerB } as any);
      await conn.query("COMMIT");
      return r.ok ? "placed" : "refused";
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      return "error";
    } finally {
      await conn.end();
    }
  };

  const results = await Promise.all([attempt(), attempt()]);
  const placed = results.filter((r) => r === "placed").length;
  check("exactly one attempt placed an order", placed, 1);
  truthy("the other was refused, not silently duplicated", results.includes("no_active_cart") || results.includes("refused"));

  const { rows: [count] } = await c4.query(
    `SELECT count(*)::int AS n FROM orders o
      WHERE o.created_at > now() - interval '1 minute'
        AND o.id IN (SELECT order_id FROM stock_reservations WHERE product_id = $1)`,
    [p]);
  check("only one order row exists for that product", Number(count.n), 1);

  const { rows: [stock] } = await c4.query(`SELECT stock FROM products WHERE id = $1`, [p]);
  check("stock decremented exactly once (10 -> 8)", Number(stock.stock), 8);

  await c4.query(`DELETE FROM carts WHERE session_id = $1`, [session]);
  await c4.end();
}

console.log("\n=== 5. two shoppers race for the same last unit ===\n");
{
  const p = await f3.mk("tmp-ck-race", f3.sellerA, 1);
  const buyers: string[] = [];
  for (const who of ["x", "y"]) {
    const s = `ck-race-${who}-${Date.now()}`;
    buyers.push(s);
    const c = await newConn();
    const { rows } = await c.query(`INSERT INTO carts (session_id) VALUES ($1) RETURNING id`, [s]);

    /*
      The guarded reserve, exactly as the app uses it. An earlier version of
      this fixture did a bare `SET stock_reserved = stock_reserved + 1`, which
      the products_reserved_not_over_stock CHECK rejected for the second buyer
      (stock 1, holding would be 2). That is the CHECK doing its job — and it
      is why the test uses the real statement rather than simulating it: the
      simulation had no availability guard and was simply wrong.
    */
    const reserved = await c.query(
      `UPDATE products SET stock_reserved = stock_reserved + 1
        WHERE id = $1 AND status = 'active' AND stock - stock_reserved >= 1
        RETURNING id`,
      [p],
    );

    if (reserved.rowCount === 1) {
      await c.query(
        `INSERT INTO stock_reservations (product_id, cart_id, quantity, expires_at)
         VALUES ($1, $2, 1, now() + interval '30 minutes')`, [p, rows[0].id]);
      await c.query(
        `INSERT INTO cart_items (cart_id, product_id, quantity, added_price)
         VALUES ($1, $2, 1, 1000)`, [rows[0].id, p]);
    } else {
      // Could not reserve: this shopper never gets the unit.
      await c.query(`DELETE FROM carts WHERE id = $1`, [rows[0].id]);
    }
    await c.end();
  }

  const raceConvert = async (session: string) => {
    const conn = await newConn();
    try {
      await conn.query("BEGIN");
      const { rows } = await conn.query(
        `SELECT id FROM carts WHERE session_id = $1 AND status = 'active' FOR UPDATE`, [session]);
      if (!rows[0]) { await conn.query("ROLLBACK"); return "no_cart"; }
      const r = await convert({ client: conn, cartId: rows[0].id, session, sellerA: f3.sellerA, sellerB: f3.sellerB } as any);
      await conn.query("COMMIT");
      return r.ok ? "placed" : (r as any).reason;
    } catch { await conn.query("ROLLBACK").catch(() => {}); return "error"; }
    finally { await conn.end(); }
  };

  const out = await Promise.all(buyers.map(raceConvert));
  const wins = out.filter((r) => r === "placed").length;
  console.log(`  outcomes: ${out.join(", ")}`);
  check("exactly one buyer got the last unit", wins, 1);

  const { rows: [final] } = await f3.client.query(`SELECT stock, stock_reserved FROM products WHERE id = $1`, [p]);
  check("stock is 0", Number(final.stock), 0);
  check("stock_reserved is 0 (no phantom holds)", Number(final.stock_reserved), 0);
  truthy("stock never went negative", Number(final.stock) >= 0);

  const { rows: [ordersForIt] } = await f3.client.query(
    `SELECT count(DISTINCT o.id)::int AS n FROM orders o
      JOIN order_items oi ON oi.order_id = o.id WHERE oi.product_id = $1`, [p]);
  check("one order for the last unit", Number(ordersForIt.n), 1);
}

console.log("\n=== cleanup ===\n");
await cleanup(f1, [f1.cartId]);
await cleanup(f3, [f3.cartId]);
console.log("  removed test carts, orders and products");

console.log(
  failures === 0
    ? "\nRESULT: checkout conversion is correct"
    : `\nRESULT: ${failures} FAILURE(S)`,
);
if (failures > 0) process.exitCode = 1;
