/*
  End-to-end smoke check for the checkout page over HTTP.

  Creates a cart for a KNOWN session id so the session cookie can be set
  manually, then fetches /checkout and asserts the page rendered rather than
  redirecting to an empty cart.

  The conversion itself is proven by scripts/test-checkout.ts, which exercises
  the SQL directly with real concurrency. This covers the parts that only
  exist in the app: routing, the session cookie, and the summary figures.

  Usage: npx tsx scripts/smoke-checkout-page.ts
*/
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local" });

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3117";
const SESSION = `smoke-${Date.now()}`;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
}

const conn = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  connectionTimeoutMillis: 15_000,
});
await conn.connect();

const { rows: productRows } = await conn.query(
  `SELECT p.id, p.title, p.price, p.seller_id
     FROM products p
    WHERE p.status = 'active' AND p.stock - p.stock_reserved >= 2
    ORDER BY p.slug LIMIT 2`,
);

if (productRows.length < 2) {
  console.log("need two seeded products with stock; run scripts/seed.ts first");
  await conn.end();
  process.exit(1);
}

const { rows: cartRows } = await conn.query(
  `INSERT INTO carts (session_id) VALUES ($1) RETURNING id`,
  [SESSION],
);
const cartId = cartRows[0].id;

for (const [index, product] of productRows.entries()) {
  const qty = index === 0 ? 2 : 1;

  const reserved = await conn.query(
    `UPDATE products SET stock_reserved = stock_reserved + $2
      WHERE id = $1 AND stock - stock_reserved >= $2 RETURNING id`,
    [product.id, qty],
  );
  if (reserved.rowCount === 0) continue;

  await conn.query(
    `INSERT INTO stock_reservations (product_id, cart_id, quantity, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 minutes')`,
    [product.id, cartId, qty],
  );
  await conn.query(
    `INSERT INTO cart_items (cart_id, product_id, quantity, added_price)
     VALUES ($1, $2, $3, $4)`,
    [cartId, product.id, qty, product.price],
  );
}

console.log(`session ${SESSION}, cart ${cartId}, ${productRows.length} lines\n`);

const headers = { cookie: `soko_cart=${SESSION}` };
const res = await fetch(`${BASE}/checkout`, { headers, redirect: "manual" });

console.log("=== GET /checkout ===");
check("status 200", res.status === 200, `got ${res.status}`);

const html = await res.text();

check("checkout form rendered", html.includes("recipientName"));
check("county select populated", html.includes("Choose a county"));
check("cash on delivery offered", html.includes("Cash on delivery"));
check("summary shows subtotal", html.includes("Subtotal"));
check("did not redirect to empty cart", !html.includes("Your cart is empty"));
check("per-seller note only when multi-seller", html.includes("Delivery is charged per seller") === new Set(productRows.map((p) => p.seller_id)).size > 1);
check("checkout CTA present on cart page", (await (await fetch(`${BASE}/cart`, { headers })).text()).includes("Proceed to checkout"));

console.log("\n=== GET /checkout with an empty session ===");
const empty = await fetch(`${BASE}/checkout`, {
  headers: { cookie: `soko_cart=nothing-here-${Date.now()}` },
  redirect: "manual",
});
check(
  "empty cart redirects (307) rather than showing a dead form",
  empty.status === 307 || empty.status === 302,
  `got ${empty.status}`,
);

console.log("\n=== GET /order/UNKNOWN ===");
const missing = await fetch(`${BASE}/order/DOESNOTEXIST`, { headers, redirect: "manual" });
check("unknown reference 404s", missing.status === 404, `got ${missing.status}`);

console.log("\n=== cleanup ===");
await conn.query(`DELETE FROM carts WHERE id = $1`, [cartId]);
await conn.query(
  `UPDATE products SET stock_reserved = 0 WHERE id = ANY($1::uuid[])`,
  [productRows.map((p) => p.id)],
);
await conn.end();
console.log("  cart and holds removed");

console.log(
  failures === 0
    ? "\nRESULT: checkout page behaves over HTTP"
    : `\nRESULT: ${failures} FAILURE(S)`,
);
if (failures > 0) process.exitCode = 1;
