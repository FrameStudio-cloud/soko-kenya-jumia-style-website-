import { sql, close, branch } from "./db";

/*
  Phase 2 schema verification. Confirms the carts/reservations tables exist
  with the shape the query layer depends on, and that the reservation owner
  CHECK actually rejects ambiguous rows.
*/

const cols = await sql<{ table_name: string; column_name: string }>(`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_name IN ('carts','cart_items','stock_reservations')
  ORDER BY table_name, ordinal_position
`);
const byTable: Record<string, string[]> = {};
for (const r of cols) (byTable[r.table_name] ??= []).push(r.column_name);

console.log("--- columns ---");
for (const [t, list] of Object.entries(byTable)) {
  console.log(`  ${t}: ${list.join(", ")}`);
}

const checks = await sql<{ conname: string; pg_get_constraintdef: string }>(`
  SELECT conname, pg_get_constraintdef(oid) AS pg_get_constraintdef
  FROM pg_constraint
  WHERE conrelid IN ('carts'::regclass,'cart_items'::regclass,'stock_reservations'::regclass)
    AND contype IN ('c','u')
  ORDER BY conrelid::text, conname
`);
console.log("\n--- constraints ---");
for (const c of checks) {
  console.log(`  ${c.conname}`);
  console.log(`    ${c.pg_get_constraintdef}`);
}

const idx = await sql<{ indexname: string; indexdef: string }>(`
  SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename IN ('carts','cart_items','stock_reservations')
    AND (indexdef LIKE '%UNIQUE%' OR indexdef LIKE '%WHERE%')
  ORDER BY tablename, indexname
`);
console.log("\n--- partial / unique indexes ---");
for (const i of idx) console.log(`  ${i.indexdef}`);

// session_id must be gone: a nullable owner column would let a reservation
// exist with no cart and no order, which the availability query would count.
console.log("\n--- behavioural checks ---");
const hasSessionId = (byTable["stock_reservations"] ?? []).includes("session_id");
console.log(
  hasSessionId
    ? "  FAIL session_id still present"
    : "  pass session_id dropped",
);

if (!hasSessionId) process.exitCode = 0;

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

/*
  `expected` names the SQLSTATE that proves the rule under test.
  Asserting only "it threw" is the bug that produced four false passes in
  verify-constraints.ts: an insert rejected on a type error satisfies a naive
  check while the constraint it was meant to test is absent.
*/
async function expectRejected(
  label: string,
  statement: string,
  expected: string,
) {
  try {
    await sql(statement);
    console.log(`  FAIL ${label}: accepted`);
    process.exitCode = 1;
  } catch (err) {
    const code = (err as { code?: string }).code ?? "unknown";
    if (code !== expected) {
      console.log(`  FAIL ${label}: ${code}, wanted ${expected}`);
      process.exitCode = 1;
    } else {
      console.log(`  pass ${label} [${code}]`);
    }
  }
}

const [{ id: cartId }] = await sql<{ id: string }>(
  `INSERT INTO carts (session_id) VALUES ('tmp-session') RETURNING id`,
);

/*
  A real order row, because order_id carries a foreign key. Reusing a valid
  uuid would fail on the FK and be reported as a pass for the wrong reason —
  the same class of false-pass the constraint verifier was rewritten to avoid.
*/
const [{ id: orderId }] = await sql<{ id: string }>(`
  INSERT INTO orders (reference, seller_id, subtotal, grand_total, county)
  SELECT 'TMP-CART-CHECK', id, 100, 100, 'Nairobi' FROM sellers LIMIT 1
  RETURNING id
`);

await expectRejected(
  "reservation with neither cart nor order",
  `INSERT INTO stock_reservations (product_id, quantity, expires_at, cart_id, order_id)
   SELECT id, 1, now() + interval '1 hour', NULL, NULL FROM products LIMIT 1`,
  CHECK_VIOLATION,
);

await expectRejected(
  "reservation with both cart and order",
  `INSERT INTO stock_reservations (product_id, quantity, expires_at, cart_id, order_id)
   SELECT id, 1, now() + interval '1 hour', '${cartId}', '${orderId}'
   FROM products LIMIT 1`,
  CHECK_VIOLATION,
);

await expectRejected(
  "cart item with zero quantity",
  `INSERT INTO cart_items (cart_id, product_id, quantity, added_price)
   SELECT '${cartId}', id, 0, 100 FROM products LIMIT 1`,
  CHECK_VIOLATION,
);

const [{ id: p2 }] = await sql<{ id: string }>(
  `SELECT id FROM products ORDER BY slug LIMIT 1`,
);
await sql(
  `INSERT INTO cart_items (cart_id, product_id, quantity, added_price)
   VALUES ('${cartId}', '${p2}', 2, 100)`,
);
await expectRejected(
  "duplicate cart line for the same product",
  `INSERT INTO cart_items (cart_id, product_id, quantity, added_price)
   VALUES ('${cartId}', '${p2}', 1, 100)`,
  UNIQUE_VIOLATION,
);

await expectRejected(
  "second active cart for the same session",
  `INSERT INTO carts (session_id) VALUES ('tmp-session')`,
  UNIQUE_VIOLATION,
);

console.log("\n--- cleanup ---");
await sql(`DELETE FROM orders WHERE reference = 'TMP-CART-CHECK'`);
await sql(`DELETE FROM carts WHERE session_id = 'tmp-session'`);
console.log(`done. branch: ${branch()}`);
await close();
