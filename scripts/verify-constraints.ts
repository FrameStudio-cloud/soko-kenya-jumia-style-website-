/*
  Verifies the schema's invariants hold in the actual database, not just that
  the migration ran.

  Each case asserts that an insert is rejected FOR THE RIGHT REASON. Checking
  only "did it throw" is how four of these passed against an undefined UUID:
  the statement failed, but on a type error rather than the CHECK under test.

  Writes to sellers/categories and deletes what it creates. Dev branch only.
*/
import { branch, close, sql } from "./db";
import type { Row } from "./db";

const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

async function expectRejected(
  label: string,
  statement: string,
  expectedCode: string,
): Promise<void> {
  try {
    await sql(statement);
    console.log(`FAIL  ${label}: accepted, should have been rejected`);
    process.exitCode = 1;
    return;
  } catch (err) {
    const code = (err as { code?: string }).code ?? "unknown";
    if (code !== expectedCode) {
      console.log(
        `FAIL  ${label}: rejected with ${code}, expected ${expectedCode}` +
          `\n        ${String((err as { message?: string }).message).split("\n")[0]}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`pass  ${label}  [${code}]`);
  }
}

// Clear any residue from a previous crashed run before creating fixtures.
await sql(`DELETE FROM reviews WHERE product_id IN (SELECT id FROM products WHERE slug LIKE 'tmp-%')`);
await sql(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE reference LIKE 'TMP-%')`);
await sql(`DELETE FROM orders WHERE reference LIKE 'TMP-%'`);
/*
  session_id was dropped from stock_reservations in migration 0005; the
  reservation owner is now cart_id or order_id. Cleaning on the removed column
  made this suite fail on a schema that is actually correct — a stale test, not
  a broken database.
*/
await sql(`DELETE FROM stock_reservations WHERE cart_id IS NULL AND order_id IS NULL`);
await sql(`DELETE FROM product_images WHERE object_key LIKE 'tmp-%'`);
await sql(`DELETE FROM products WHERE slug LIKE 'tmp-%'`);
await sql(`DELETE FROM delivery_areas WHERE county = 'TmpCounty'`);
await sql(`DELETE FROM categories WHERE slug = 'tmp-cat'`);
await sql(`DELETE FROM sellers WHERE slug LIKE 'tmp-%'`);

const [{ id: sellerId }] = await sql(
  `INSERT INTO sellers (slug, name, location, joined_year)
   VALUES ('tmp-verify', 'Tmp Seller', 'Nairobi', 2026) RETURNING id`,
);
const [{ id: catId }] = await sql(
  `INSERT INTO categories (slug, name) VALUES ('tmp-cat', 'Tmp Cat') RETURNING id`,
);

if (!sellerId || !catId) {
  console.log("FAIL  could not create fixtures");
  process.exit(1);
}

const insertProduct = (slug: string, cols: string, vals: string) =>
  `INSERT INTO products (slug, title, seller_id, category_id, ${cols})
   VALUES ('${slug}', 'T', '${sellerId}', '${catId}', ${vals})`;

console.log("--- CHECK constraints ---");

await expectRejected(
  "price must be > 0",
  insertProduct("tmp-p1", "price", "-5"),
  CHECK_VIOLATION,
);
await expectRejected(
  "stock cannot go negative",
  insertProduct("tmp-p2", "price, stock", "100, -1"),
  CHECK_VIOLATION,
);
await expectRejected(
  "compareAtPrice equal to price is rejected (no -0% badge)",
  insertProduct("tmp-p3", "price, compare_at_price", "100, 100"),
  CHECK_VIOLATION,
);
await expectRejected(
  "compareAtPrice below price is rejected",
  insertProduct("tmp-p4", "price, compare_at_price", "100, 50"),
  CHECK_VIOLATION,
);
await expectRejected(
  "seller rating must be 0-5",
  `INSERT INTO sellers (slug, name, location, joined_year, rating)
   VALUES ('tmp-bad-rating', 'T', 'Nairobi', 2026, 9)`,
  CHECK_VIOLATION,
);
await expectRejected(
  "delivery ETA min must not exceed max",
  `INSERT INTO delivery_areas (county, base_fee, eta_days_min, eta_days_max)
   VALUES ('TmpCounty', 100, 5, 2)`,
  CHECK_VIOLATION,
);
await expectRejected(
  "product must reference an existing seller",
  `INSERT INTO products (slug, title, price, seller_id, category_id)
   VALUES ('tmp-p5', 'T', 100, '00000000-0000-0000-0000-000000000000', '${catId}')`,
  FOREIGN_KEY_VIOLATION,
);

console.log("--- money + snapshot invariants ---");

const [{ id: productId }] = await sql(
  insertProduct("tmp-ok", "price, stock", "100, 5") + " RETURNING id",
);

await expectRejected(
  "order grand total must be > 0",
  `INSERT INTO orders (reference, seller_id, subtotal, grand_total, county)
   VALUES ('TMP-1', '${sellerId}', 0, 0, 'Nairobi')`,
  CHECK_VIOLATION,
);

const [{ id: orderId }] = await sql(
  `INSERT INTO orders (reference, seller_id, subtotal, grand_total, county)
   VALUES ('TMP-3', '${sellerId}', 100, 100, 'Nairobi') RETURNING id`,
);

await expectRejected(
  "order item quantity must be positive",
  `INSERT INTO order_items (order_id, product_id, title_snapshot, unit_price, quantity, line_total)
   VALUES ('${orderId}', '${productId}', 'T', 100, 0, 0)`,
  CHECK_VIOLATION,
);

console.log("--- uniqueness ---");

await sql(
  `INSERT INTO reviews (product_id, user_id, rating) VALUES ('${productId}', 'user-a', 5)`,
);
await expectRejected(
  "one review per buyer per product",
  `INSERT INTO reviews (product_id, user_id, rating) VALUES ('${productId}', 'user-a', 4)`,
  UNIQUE_VIOLATION,
);

console.log("--- valid rows are accepted ---");
const [{ id: discountedId }] = await sql(
  insertProduct("tmp-valid-discount", "price, compare_at_price", "100, 150") +
    " RETURNING id",
);
const res = await sql<Row>(
  `SELECT price, compare_at_price,
          round(((compare_at_price - price) / compare_at_price) * 100) AS pct
   FROM products WHERE id = '${discountedId}'`,
);
console.log(`pass  discounted product accepted, computed ${res[0].pct}% off`);

console.log("\n--- cleanup ---");
await sql(`DELETE FROM orders WHERE reference LIKE 'TMP-%'`);
await sql(`DELETE FROM reviews WHERE product_id IN (SELECT id FROM products WHERE slug LIKE 'tmp-%')`);
await sql(`DELETE FROM products WHERE slug LIKE 'tmp-%'`);
await sql(`DELETE FROM categories WHERE slug = 'tmp-cat'`);
await sql(`DELETE FROM sellers WHERE slug LIKE 'tmp-%'`);
await sql(`DELETE FROM delivery_areas WHERE county = 'TmpCounty'`);
await close();

console.log(`done. branch: ${branch()}`);
if (process.exitCode) console.log("\nRESULT: FAILURES ABOVE");
else console.log("\nRESULT: all constraints hold");
