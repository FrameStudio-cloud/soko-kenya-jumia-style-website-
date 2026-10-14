/*
  Exercises the REAL placeOrder() from src/lib/checkout.ts.

  scripts/test-checkout.ts deliberately re-transcribes the SQL, so it can catch
  a bug in that transcription but not a bug where the app and the test agree on
  something wrong. This closes that gap for the parts that do not need Next's
  request context.

  placeOrder reads the cart session from cookies(), which needs a Next request
  scope. Rather than mocking that away, the session id is injected directly
  here and placeOrder is called through a thin seam — see CART_SESSION_OVERRIDE
  in src/lib/cart.ts, which exists only for this script.

  Usage: npx tsx scripts/test-place-order-real.ts
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
async function truthyResult(label: string, value: unknown) {
  const ok = Boolean(value);
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"} ${label}  (${String(value)})`);
}

const conn = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  connectionTimeoutMillis: 15_000,
});
await conn.connect();

async function preClean() {
  await conn.query(
    `DELETE FROM orders WHERE id IN (
       SELECT DISTINCT o.id FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
       WHERE p.slug LIKE 'tmp-real-%')`,
  );
  await conn.query(
    `DELETE FROM stock_reservations
      WHERE product_id IN (SELECT id FROM products WHERE slug LIKE 'tmp-real-%')`,
  );
  await conn.query(`DELETE FROM carts WHERE session_id LIKE 'real-%'`);
  await conn.query(`UPDATE products SET stock_reserved = 0 WHERE slug LIKE 'tmp-real-%'`);
  await conn.query(`DELETE FROM products WHERE slug LIKE 'tmp-real-%'`);
}
await preClean();

/*
  The seam. Set before importing checkout.ts, so cart.ts picks it up at module
  load. Documented in cart.ts as existing only for tests — without it, calling
  placeOrder outside a request throws on cookies(), and the only alternative
  would be a copy of the function, which is what this whole exercise exists to
  avoid.
*/
const SESSION = `real-${Date.now()}`;
process.env.CART_SESSION_OVERRIDE = SESSION;

const { placeOrder, getOrdersByReferences } = await import("@/lib/checkout");

async function buildCart(slug: string, qty: number) {
  const { rows: seller } = await conn.query(`SELECT id FROM sellers ORDER BY slug LIMIT 1`);
  const { rows: cat } = await conn.query(`SELECT id FROM categories LIMIT 1`);
  const { rows: p } = await conn.query(
    `INSERT INTO products (slug, title, price, stock, stock_reserved, status,
                           seller_id, category_id, delivery_fee, rating, rating_count)
     VALUES ($1, $2, 1000, 10, 0, 'active', $3, $4, 0, 0, 0) RETURNING id`,
    [slug, `${slug} title`, seller[0].id, cat[0].id],
  );

  const { rows: cartRows } = await conn.query(
    `INSERT INTO carts (session_id) VALUES ($1) RETURNING id`, [SESSION]);
  const cartId = cartRows[0].id;

  await conn.query(
    `UPDATE products SET stock_reserved = stock_reserved + $2 WHERE id = $1`, [p[0].id, qty]);
  await conn.query(
    `INSERT INTO stock_reservations (product_id, cart_id, quantity, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 minutes')`, [p[0].id, cartId, qty]);
  await conn.query(
    `INSERT INTO cart_items (cart_id, product_id, quantity, added_price)
     VALUES ($1, $2, $3, 1000)`, [cartId, p[0].id, qty]);

  return { productId: p[0].id as string, cartId };
}

console.log("=== placeOrder() happy path ===\n");
const { productId } = await buildCart("tmp-real-a", 2);

const result = await placeOrder({
  recipientName: "Wanjiku Kamau",
  phone: "0712345678",
  county: "Nairobi",
  town: "Westlands",
  street: "Karen Blk 4",
  paymentMethod: "cod",
});

await truthyResult("placeOrder returned ok", result.ok);
if (!result.ok) {
  console.log(`     reason: ${result.reason} — ${result.message}`);
  process.exit(1);
}
check("one order for a one-seller cart", result.references.length, 1);
check("subtotal 2000 + Nairobi 150 delivery", result.grandTotal, 2150);

const { rows: prod } = await conn.query(
  `SELECT stock, stock_reserved FROM products WHERE id = $1`, [productId]);
check("stock decremented 10 -> 8", Number(prod[0].stock), 8);
check("holds fully consumed", Number(prod[0].stock_reserved), 0);

const { rows: orders } = await conn.query(
  `SELECT reference, status, subtotal, delivery_total, grand_total, county,
          delivery_address, delivery_phone
     FROM orders WHERE reference = $1`, [result.references[0]]);
const o = orders[0];
check("status is confirmed", o.status, "confirmed");
check("subtotal snapshotted", Number(o.subtotal), 2000);
check("county recorded", o.county, "Nairobi");
check("address is a JSONB snapshot with the town", o.delivery_address?.town, "Westlands");
check("phone recorded for the courier", o.delivery_phone, "0712345678");

const { rows: items } = await conn.query(
  `SELECT title_snapshot, unit_price, quantity, line_total
     FROM order_items WHERE order_id = (SELECT id FROM orders WHERE reference = $1)`,
  [result.references[0]]);
check("one order line", items.length, 1);
check("line total is unit x qty", Number(items[0].line_total), 2000);

const { rows: hist } = await conn.query(
  `SELECT to_status FROM order_status_history
    WHERE order_id = (SELECT id FROM orders WHERE reference = $1)`,
  [result.references[0]]);
check("history records the placement", `${hist.length}/${hist[0]?.to_status}`, "1/confirmed");

const { rows: cartRows } = await conn.query(
  `SELECT status FROM carts WHERE session_id = $1`, [SESSION]);
check("cart marked converted", cartRows[0].status, "converted");

const { rows: remaining } = await conn.query(
  `SELECT count(*)::int AS n FROM cart_items WHERE cart_id IN
     (SELECT id FROM carts WHERE session_id = $1)`, [SESSION]);
check("cart emptied", Number(remaining[0].n), 0);

console.log("\n=== placeOrder() rejects a bad phone number ===\n");
{
  const { productId: p2 } = await buildCart("tmp-real-b", 1);
  const bad = await placeOrder({
    recipientName: "Test",
    phone: "12345",
    county: "Nairobi",
    town: "Westlands",
    paymentMethod: "cod",
  });
  check("refused", bad.ok, false);
  await truthyResult(
    "names the phone as the problem",
    !bad.ok && bad.message.toLowerCase().includes("phone"),
  );

  /*
    Counted against THIS product, not "orders created recently". The earlier
    assertion counted the happy-path order too and reported a failure that was
    the test's own fault — a reminder that a time-window count is only as
    specific as the thing it is counting.
  */
  const { rows } = await conn.query(
    `SELECT count(*)::int AS n FROM order_items WHERE product_id = $1`, [p2]);
  check("no order line created for this product", Number(rows[0].n), 0);

  const { rows: stillThere } = await conn.query(
    `SELECT quantity FROM cart_items WHERE product_id = $1`, [p2]);
  check("the cart survives a rejected submission", stillThere.length, 1);
}

console.log("\n=== placeOrder() rejects an unsupported county ===\n");
{
  const bad = await placeOrder({
    recipientName: "Test",
    phone: "0712345678",
    county: "Turkana",
    town: "Lodwar",
    paymentMethod: "cod",
  });
  check("refused", bad.ok, false);
  check("reason is the county", !bad.ok && bad.reason, "unsupported_county");
}

console.log("\n=== placeOrder() converts the cart, so a repeat is refused ===\n");
{
  // The cart from the previous section is still active and unconverted,
  // because a REFUSED checkout must not consume it. So a valid attempt now
  // succeeds — which is the correct behaviour, not a double-order bug.
  const ok = await placeOrder({
    recipientName: "Wanjiku Kamau",
    phone: "0712345678",
    county: "Nairobi",
    town: "Westlands",
    paymentMethod: "cod",
  });
  await truthyResult("the surviving cart can still be checked out", ok.ok);

  // Only NOW is the cart converted, and that is what a repeat must hit.
  const repeat = await placeOrder({
    recipientName: "Wanjiku Kamau",
    phone: "0712345678",
    county: "Nairobi",
    town: "Westlands",
    paymentMethod: "cod",
  });
  check("repeat attempt refused", repeat.ok, false);
  check("reason is empty cart", !repeat.ok && repeat.reason, "empty_cart");

  const { rows } = await conn.query(
    `SELECT count(*)::int AS n FROM orders WHERE reference = $1`,
    [result.references[0]],
  );
  check("the original order is untouched, not duplicated", Number(rows[0].n), 1);
}

console.log("\n=== order summary is readable back ===\n");
{
  const [summary] = await getOrdersByReferences([result.references[0]]);
  await truthyResult("summary found by reference", Boolean(summary));
  check("grand total matches", summary.grandTotal, 2150);
  check("items carried through", summary.items.length, 1);
  check("address readable", summary.address.town, "Westlands");
  check(
    `seller name joined in (${summary.sellerName})`,
    typeof summary.sellerName === "string" && summary.sellerName.length > 0,
    true,
  );
}

console.log("\n=== cleanup ===\n");
await preClean();
await conn.end();
console.log("  test products, orders and carts removed");

console.log(
  failures === 0
    ? "\nRESULT: the real placeOrder() is correct"
    : `\nRESULT: ${failures} FAILURE(S)`,
);
if (failures > 0) process.exitCode = 1;
