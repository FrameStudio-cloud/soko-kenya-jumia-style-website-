/*
  Admin auth and order-lifecycle rules.

  Split in two on purpose, because the two halves fail differently:

    - This file needs no server. It tests the token crypto, the password
      compare, the lockout counters, the transition map, and — the important
      one — that cancelling an order gives the stock back and writes an audit
      row.

    - scripts/smoke-admin-pages.ts covers the HTTP guard: that an unauthenticated
      request to an admin page is redirected and a forged cookie is refused.

  The one thing NOT covered here is the guard inside the admin server actions.
  Those call requireAdminAction(), which reads cookies(), and cookies() throws
  outside a Next request scope — so a script cannot prove they refuse, only that
  they would crash. They are covered by construction (every action's first
  statement) and by scripts/test-admin-orders.ts testing the logic behind them.
  That gap is recorded in docs/admin.md rather than papered over.
*/
import { config } from "dotenv";

config({ path: ".env.local" });

import { sql, close } from "./db";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"} ${label}  (got ${actual}, want ${expected})`);
}

const SECRET = "test-secret-not-the-real-one";
const PASSWORD = "correct horse battery staple";

const { signToken, tokenPayload, verifyToken, passwordMatches, isLockedOut, recordFailure, clearFailures } =
  await import("@/lib/admin");
const { canTransition, ALLOWED_TRANSITIONS, ORDER_STATUSES, transitionOrder } =
  await import("@/lib/admin-orders");
const { recordAdminAction } = await import("@/lib/admin-audit");

process.env.ADMIN_PASSWORD = PASSWORD;

const future = Date.now() + 60_000;
const past = Date.now() - 60_000;

console.log("\ntoken");
{
  const payload = tokenPayload(future);
  check("valid token accepted", verifyToken(`${payload}.${signToken(payload, SECRET)}`, SECRET, Date.now()), true);
  check("expired token refused", verifyToken(`${payload}.${signToken(payload, SECRET)}`, SECRET, future + 1000), false);
  check(
    "payload from the past refused",
    verifyToken(`${tokenPayload(past)}.${signToken(tokenPayload(past), SECRET)}`, SECRET, Date.now()),
    false,
  );

  // The attack this whole mechanism exists to stop.
  const forged = tokenPayload(future);
  check("unsigned payload refused", verifyToken(forged, SECRET, Date.now()), false);
  check("wrong secret refused", verifyToken(`${payload}.${signToken(payload, "other")}`, SECRET, Date.now()), false);

  // Self-consistent signature over a hostile payload still fails verification,
  // because the signature was made with a different secret.
  const stolen = `${tokenPayload(future)}.${signToken(tokenPayload(future), SECRET)}`;
  check("token signed with another secret refused", verifyToken(stolen, "attacker", Date.now()), false);

  check("no token refused", verifyToken(undefined, SECRET, Date.now()), false);
  check("empty token refused", verifyToken("", SECRET, Date.now()), false);
  check("no separator refused", verifyToken("garbage", SECRET, Date.now()), false);
  check("trailing dot refused", verifyToken("payload.", SECRET, Date.now()), false);
}

console.log("\npassword");
{
  check("correct password accepted", passwordMatches(PASSWORD), true);
  check("wrong password refused", passwordMatches(PASSWORD + "x"), false);
  check("empty password refused", passwordMatches(""), false);
  check("prefix of the password refused", passwordMatches("correct"), false);
}

console.log("\nlockout");
{
  const key = "1.2.3.4";
  clearFailures(key);
  check("not locked out initially", isLockedOut(key), false);
  for (let i = 0; i < 8; i++) recordFailure(key);
  check("locked out after 8 failures", isLockedOut(key), true);
  clearFailures(key);
  check("cleared after success", isLockedOut(key), false);

  const other = "5.6.7.8";
  clearFailures(other);
  recordFailure(other);
  check("counters are per-key", isLockedOut(other), false);
}

console.log("\ntransition map");
{
  check("confirmed -> dispatched", canTransition("confirmed", "dispatched"), true);
  check("confirmed -> cancelled", canTransition("confirmed", "cancelled"), true);
  check("dispatched -> delivered", canTransition("dispatched", "delivered"), true);
  // The one rule with a business reason behind it.
  check("dispatched -> cancelled refused", canTransition("dispatched", "cancelled"), false);
  check("delivered -> cancelled refused", canTransition("delivered", "cancelled"), false);
  check("cancelled is terminal", canTransition("cancelled", "confirmed"), false);
  check("refunded is terminal", canTransition("refunded", "confirmed"), false);
  check("no-op transition refused", canTransition("confirmed", "confirmed"), false);
  check("unknown status refused", canTransition("confirmed", "teleported"), false);
  check("every status has an entry", ORDER_STATUSES.every((s) => s in ALLOWED_TRANSITIONS), true);
}

console.log("\norder lifecycle against the database");
{
  await sql(`DELETE FROM orders WHERE reference LIKE 'TMP-ADMIN-%'`);
  await sql(`DELETE FROM products WHERE slug LIKE 'tmp-admin-%'`);

  const [{ id: sellerId }] = await sql<{ id: string }>(`SELECT id FROM sellers LIMIT 1`);
  const [{ id: categoryId }] = await sql<{ id: string }>(`SELECT id FROM categories LIMIT 1`);

  // Stock 5, then we order 2 and cancel: it must come back to 5, not 7.
  const [{ id: productId }] = await sql<{ id: string }>(
    `INSERT INTO products
       (slug, title, price, stock, stock_reserved, status, seller_id, category_id,
        delivery_fee, rating, rating_count)
     VALUES ('tmp-admin-stock', 'Admin Stock Test', 1000, 5, 0, 'active', $1, $2, 0, 0, 0)
     RETURNING id`,
    [sellerId, categoryId],
  );

  const reference = `TMP-ADMIN-${Date.now()}`;
  const [{ id: orderId }] = await sql<{ id: string }>(
    `INSERT INTO orders
       (reference, seller_id, status, subtotal, delivery_total, grand_total,
        county, payment_method, payment_status, delivery_address, delivery_phone)
     VALUES ($1, $2, 'confirmed', 2000, 0, 2000, 'Nairobi', 'cod', 'unpaid',
             '{"recipientName":"Test Person","town":"Westlands","street":"Karen Blk 4"}', '0712345678')
     RETURNING id`,
    [reference, sellerId],
  );

  await sql(
    `INSERT INTO order_items (order_id, product_id, title_snapshot, unit_price, quantity, line_total)
     VALUES ($1, $2, 'Admin Stock Test', 1000, 2, 2000)`,
    [orderId, productId],
  );

  // Mimic checkout faithfully, and in the right order: a cart hold first, so
  // stock_reserved is 2 when the order consumes it. placeOrder decrements both
  // columns and the products_stock_reserved_nonneg CHECK would reject a
  // decrement from zero — which is exactly the guard that stops a checkout
  // consuming a hold that does not exist.
  await sql(`UPDATE products SET stock_reserved = 2 WHERE id = $1`, [productId]);
  await sql(
    `UPDATE products SET stock = stock - 2, stock_reserved = stock_reserved - 2 WHERE id = $1`,
    [productId],
  );
  await sql(
    `INSERT INTO stock_reservations (product_id, quantity, expires_at, cart_id, order_id)
     SELECT id, 2, now() + interval '30 minutes', NULL, $1 FROM products WHERE id = $2`,
    [orderId, productId],
  );

  const midStock = await sql<{ stock: number }>(`SELECT stock FROM products WHERE id = $1`, [productId]);
  check("stock is 3 after the order", Number(midStock[0].stock), 3);

  const illegal = await transitionOrder({ orderId, toStatus: "delivered", actor: "test" });
  check("confirmed -> delivered refused", illegal.ok, false);
  check("reason", !illegal.ok && illegal.reason, "illegal");

  const stillConfirmed = await sql<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [orderId]);
  check("status unchanged after a refused move", stillConfirmed[0].status, "confirmed");

  const cancelled = await transitionOrder({
    orderId,
    toStatus: "cancelled",
    note: "test cancellation",
    actor: "test",
  });
  check("cancel succeeds", cancelled.ok, true);

  const afterStock = await sql<{ stock: number }>(`SELECT stock FROM products WHERE id = $1`, [productId]);
  check("stock returned to 5", Number(afterStock[0].stock), 5);

  // The double-decrement this design exists to prevent.
  const reserved = await sql<{ stock_reserved: number }>(
    `SELECT stock_reserved FROM products WHERE id = $1`,
    [productId],
  );
  check("stock_reserved NOT touched again by the cancel", Number(reserved[0].stock_reserved), 0);

  const holds = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM stock_reservations
      WHERE order_id = $1 AND released_at IS NULL`,
    [orderId],
  );
  check("cancelled order holds marked released", holds[0].n, 0);

  const history = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1`,
    [orderId],
  );
  check("history row written", history[0].n, 1);

  const auditor = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM order_status_history
      WHERE order_id = $1 AND changed_by = 'test' AND note = 'test cancellation'`,
    [orderId],
  );
  check("history records who and why", auditor[0].n, 1);

  const audit = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM admin_audit_log WHERE target = $1`,
    [reference],
  );
  check("no audit row for a status change yet", audit[0].n, 0);

  await recordAdminAction({ actor: "test", action: "reveal_delivery", target: reference });
  const audited = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM admin_audit_log
      WHERE action = 'reveal_delivery' AND target = $1`,
    [reference],
  );
  check("reveal recorded in the audit log", audited[0].n, 1);

  // The audit log must never hold the customer data it exists to protect.
  const leaked = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM admin_audit_log
      WHERE note LIKE '%0712345678%' OR note LIKE '%Karen%'`,
  );
  check("audit log contains no customer PII", leaked[0].n, 0);

  // Orders first, then products: order_items.product_id is ON DELETE RESTRICT,
  // so a product with order lines cannot be deleted at all. That restriction is
  // why the admin console archives rather than deletes, and it is nice to have
  // the teardown trip over the same rule.
  await sql(`DELETE FROM admin_audit_log WHERE target LIKE 'TMP-ADMIN-%'`);
  await sql(`DELETE FROM orders WHERE reference LIKE 'TMP-ADMIN-%'`);
  await sql(`DELETE FROM products WHERE slug LIKE 'tmp-admin-%'`);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nadmin auth and order rules OK");
}

await close();