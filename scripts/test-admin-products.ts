/*
  Catalogue editing: validation, persistence, and archiving.

  Three things this must prove, in order of how badly they would go wrong:

  1. Validation catches what the CHECK constraints catch, with a sentence
     instead of a constraint name. Especially the stock/held-carts rule: an
     operator lowering stock below units in live baskets is the one error a
     CHECK refuses that a human would not expect to be refused.

  2. Archiving UNPUBLISHES. Proven through getProductBySlug(), the real public
     read path, rather than a hand-written `WHERE status = 'active'` that could
     agree with the test while disagreeing with the site.

  3. Archive is soft: the row survives, and a product with order lines cannot be
     hard-deleted at all (order_items.product_id is onDelete: restrict).
*/
import { config } from "dotenv";

config({ path: ".env.local" });

import { close, sql } from "./db";

// Type-only: erased at compile time, so it does not affect the load order the
// dynamic imports below are chosen for.
import type { ProductFormValues } from "@/lib/admin-product-rules";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"} ${label}  (got ${actual}, want ${expected})`);
}

function contains(label: string, haystack: string | undefined, needle: string) {
  const ok = Boolean(haystack && haystack.includes(needle));
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"} ${label}${ok ? "" : `  (got "${haystack}")`}`);
}

const {
  validateProductEdit,
  parseMoney,
  parseInteger,
  toFormValues,
} = await import("@/lib/admin-product-rules");
const { updateProduct, listAdminProducts, getAdminProductDetail } = await import(
  "@/lib/admin-products"
);
const { getProductBySlug } = await import("@/lib/queries");

const ANY_UUID = "00000000-0000-4000-8000-000000000001";

function validInput(overrides: Partial<ProductFormValues> = {}): ProductFormValues {
  return {
    title: "Validation Fixture",
    slug: "tmp-admin-product",
    description: "A product used to check validation.",
    brand: "FixtureCo",
    price: "15000",
    compareAtPrice: "",
    stock: "10",
    deliveryFee: "350",
    deliveryEstimateDays: "3",
    categoryId: ANY_UUID,
    sellerId: ANY_UUID,
    status: "active",
    ...overrides,
  };
}

/* ---------------------------------------------------------- parse helpers --- */

console.log("\nparsing form numbers");
{
  check("plain number", parseMoney("42000"), 42000);
  check("thousands separator", parseMoney("42,000"), 42000);
  check("surrounding space", parseMoney(" 42000 "), 42000);
  check("decimals", parseMoney("42000.50"), 42000.5);
  check("empty is null", parseMoney(""), "null");
  check("letters is null", parseMoney("abc"), "null");
  check("currency symbol is null", parseMoney("KSh 42000"), "null");
  check("integer helper rejects decimals", parseInteger("12.5"), "null");
  check("integer helper accepts negatives", parseInteger("-5"), -5);
  check("integer helper empty", parseInteger(""), "null");
}

/* ------------------------------------------------------------ validation --- */

console.log("\nvalidation");
{
  const ok = validateProductEdit(validInput(), { stockReserved: 0 });
  check("valid input accepted", ok.ok, true);

  const empty = validateProductEdit(validInput({ title: "   " }), { stockReserved: 0 });
  check("empty title rejected", empty.ok, false);
  if (!empty.ok) contains("empty title explains itself", empty.errors.title, "needs a title");

  const pricedZero = validateProductEdit(validInput({ price: "0" }), { stockReserved: 0 });
  check("price of zero rejected", pricedZero.ok, false);
  if (!pricedZero.ok) contains("price of zero message", pricedZero.errors.price, "above zero");

  check("non-numeric price rejected", validateProductEdit(validInput({ price: "abc" }), { stockReserved: 0 }).ok, false);
  check("negative price rejected", validateProductEdit(validInput({ price: "-100" }), { stockReserved: 0 }).ok, false);

  /*
    The -0% rule. A compare-at equal to the selling price would let the site
    strike through the real price and claim a saving that does not exist.
  */
  const equal = validateProductEdit(validInput({ compareAtPrice: "15000" }), { stockReserved: 0 });
  check("compare-at equal to price rejected", equal.ok, false);
  if (!equal.ok) contains("equal compare-at message", equal.errors.compareAtPrice, "0%");

  check(
    "compare-at below price rejected",
    validateProductEdit(validInput({ compareAtPrice: "9000" }), { stockReserved: 0 }).ok,
    false,
  );
  check(
    "compare-at above price accepted",
    validateProductEdit(validInput({ compareAtPrice: "20000" }), { stockReserved: 0 }).ok,
    true,
  );
  check(
    "empty compare-at accepted",
    validateProductEdit(validInput({ compareAtPrice: "" }), { stockReserved: 0 }).ok,
    true,
  );

  const held = validateProductEdit(validInput({ stock: "4" }), { stockReserved: 7 });
  check("stock below held units rejected", held.ok, false);
  if (!held.ok) contains("explains the held units", held.errors.stock, "held in live carts");
  check(
    "stock equal to held units accepted",
    validateProductEdit(validInput({ stock: "7" }), { stockReserved: 7 }).ok,
    true,
  );
  check("negative stock rejected", validateProductEdit(validInput({ stock: "-1" }), { stockReserved: 0 }).ok, false);

  check("slug with a space rejected", validateProductEdit(validInput({ slug: "sony headphones" }), { stockReserved: 0 }).ok, false);
  check("slug with a slash rejected", validateProductEdit(validInput({ slug: "a/b" }), { stockReserved: 0 }).ok, false);
  check("uppercase slug accepted", validateProductEdit(validInput({ slug: "Sony-1000XM5" }), { stockReserved: 0 }).ok, true);

  check("unknown status rejected", validateProductEdit(validInput({ status: "deleted" }), { stockReserved: 0 }).ok, false);
  check("negative delivery fee rejected", validateProductEdit(validInput({ deliveryFee: "-1" }), { stockReserved: 0 }).ok, false);
  check("empty delivery estimate accepted", validateProductEdit(validInput({ deliveryEstimateDays: "" }), { stockReserved: 0 }).ok, true);
  check("non-integer delivery estimate rejected", validateProductEdit(validInput({ deliveryEstimateDays: "soon" }), { stockReserved: 0 }).ok, false);
  check("empty category rejected", validateProductEdit(validInput({ categoryId: "" }), { stockReserved: 0 }).ok, false);
  check("garbage seller id rejected", validateProductEdit(validInput({ sellerId: "not-a-uuid" }), { stockReserved: 0 }).ok, false);

  // Uppercase is normalised, not rejected.
  const upper = validateProductEdit(validInput({ slug: "SONY-1000" }), { stockReserved: 0 });
  check("uppercase slug is lowercased", upper.ok && upper.value.slug, "sony-1000");
}

/* ------------------------------------------------------------ persistence --- */

console.log("\nediting a real product");
await sql(`DELETE FROM orders WHERE reference LIKE 'TMP-CAT-%'`);
await sql(`DELETE FROM products WHERE slug LIKE 'tmp-cat-%'`);

const [{ id: sellerId }] = await sql<{ id: string }>(`SELECT id FROM sellers LIMIT 1`);
const [{ id: categoryId }] = await sql<{ id: string }>(`SELECT id FROM categories LIMIT 1`);

const slug = `tmp-cat-${Date.now()}`;
const [{ id: productId }] = await sql<{ id: string }>(
  `INSERT INTO products
     (slug, title, description, brand, price, compare_at_price, stock, stock_reserved,
      status, seller_id, category_id, delivery_fee, delivery_estimate_days)
   VALUES ($1, 'Catalogue Fixture', 'Original description', 'FixtureCo', 15000, 20000,
           10, 0, 'draft', $2, $3, 350, 3)
   RETURNING id`,
  [slug, sellerId, categoryId],
);

{
  const detail = await getAdminProductDetail(productId);
  check("detail loads", Boolean(detail), true);

  const row = detail!;
  // A draft is already hidden — every public read filters status = 'active',
  // so this is a rule the admin screen inherits rather than introduces.
  check("a draft is hidden from the shop", (await getProductBySlug(slug)) === null, true);

  // Flip to active and confirm the public path sees it.
  const published = await updateProduct({
    id: productId,
    input: toFormValues({ ...row, status: "active" }),
    actor: "test",
  });
  check("publish succeeds", published.ok, true);
  check("active product is visible on the shop", (await getProductBySlug(slug)) !== null, true);
  const [publishedRow] = await sql<{ status: string }>(
    `SELECT status FROM products WHERE id = $1`,
    [productId],
  );
  check("published status persisted", publishedRow.status, "active");

  // Edit the ordinary fields.
  const edited = await updateProduct({
    id: productId,
    input: {
      ...toFormValues(row),
      title: "Catalogue Fixture Edited",
      price: "17999",
      compareAtPrice: "22000",
      brand: "RenamedBrand",
      stock: "25",
      status: "active",
    },
    actor: "test",
  });
  check("edit succeeds", edited.ok, true);

  const after = await getAdminProductDetail(productId);
  check("title persisted", after?.title, "Catalogue Fixture Edited");
  check("price persisted", after?.price, 17999);
  check("compare-at persisted", after?.compareAtPrice, 22000);
  check("brand persisted", after?.brand, "RenamedBrand");
  check("stock persisted", after?.stock, 25);
  check("category unchanged", after?.categoryId, categoryId);

  const statusOnly = await updateProduct({
    id: productId,
    input: toFormValues(after!),
    actor: "test",
  });
  check("no-op save succeeds", statusOnly.ok, true);
}

/* -------------------------------------------------------- rejected writes --- */

console.log("\nrejected writes");
{
  const current = (await getAdminProductDetail(productId))!;

  const zero = await updateProduct({ id: productId, input: { ...toFormValues(current), price: "0" }, actor: "test" });
  check("price of zero refused", zero.ok, false);
  if (!zero.ok) contains("...with a field message", zero.errors?.price, "above zero");

  const badCompare = await updateProduct({ id: productId, input: { ...toFormValues(current), compareAtPrice: "17999" }, actor: "test" });
  check("compare-at equal to price refused", badCompare.ok, false);

  // The stock rule, end to end. Only the counter is set, and that is not a
  // shortcut: products.stock_reserved is deliberately denormalised (see the
  // comment on it in schema.ts) precisely so availability is a row lock on one
  // row rather than a SUM over reservations. It is the counter validation reads.
  await sql(`UPDATE products SET stock_reserved = 6 WHERE id = $1`, [productId]);

  const tooLow = await updateProduct({ id: productId, input: { ...toFormValues(current), stock: "2" }, actor: "test" });
  check("stock below live holds refused", tooLow.ok, false);
  if (!tooLow.ok) contains("...and says why", tooLow.errors?.stock, "held in live carts");

  const stillIntact = await getAdminProductDetail(productId);
  check("refused write left stock alone", stillIntact?.stock, 25);
  check("refused write left price alone", stillIntact?.price, 17999);

  const dupSlug = `tmp-cat-dup-${Date.now()}`;
  await sql(
    `INSERT INTO products (slug, title, price, stock, seller_id, category_id, status)
     VALUES ($1, 'Other', 1000, 1, $2, $3, 'draft')`,
    [dupSlug, sellerId, categoryId],
  );
  const clash = await updateProduct({
    id: productId,
    input: { ...toFormValues(current), slug: dupSlug },
    actor: "test",
  });
  check("duplicate slug refused", clash.ok, false);
  if (!clash.ok) contains("...with a human message", clash.message, "already used by another product");

  // Put the counter back so teardown starts from a consistent row.
  await sql(`UPDATE products SET stock_reserved = 0 WHERE id = $1`, [productId]);
}

/* -------------------------------------------------------- status + audit --- */

console.log("\narchiving");
{
  const before = (await getAdminProductDetail(productId))!;
  const archived = await updateProduct({
    id: productId,
    input: { ...toFormValues(before), status: "archived" },
    actor: "test",
  });
  check("archive succeeds", archived.ok, true);
  check("the message says so", archived.ok && archived.statusChanged, true);

  check("archived product unreachable by slug", (await getProductBySlug(slug)) === null, true);

  const [still] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM products WHERE id = $1`,
    [productId],
  );
  check("archive is SOFT — the row survives", still.n, 1);

  const [audit] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM admin_audit_log
      WHERE action = 'product_status_change' AND target = $1 AND note LIKE '%archived%'`,
    [slug],
  );
  check("the status change was audited", audit.n, 1);
}

/* ------------------------------------------------------------ soft delete --- */

console.log("\nhard delete is impossible");
{
  // Give the product an order line: from here the schema refuses deletion.
  const [{ id: orderId }] = await sql<{ id: string }>(
    `INSERT INTO orders
       (reference, seller_id, status, subtotal, delivery_total, grand_total, county,
        payment_method, payment_status, delivery_address)
     VALUES ($1, $2, 'delivered', 17999, 0, 17999, 'Nairobi', 'cod', 'unpaid', '{}')
     RETURNING id`,
    [`TMP-CAT-${Date.now()}`, sellerId],
  );
  await sql(
    `INSERT INTO order_items (order_id, product_id, title_snapshot, unit_price, quantity, line_total)
     VALUES ($1, $2, 'Catalogue Fixture Edited', 17999, 1, 17999)`,
    [orderId, productId],
  );

  let refused = false;
  let reason = "";
  try {
    await sql(`DELETE FROM products WHERE id = $1`, [productId]);
  } catch (err) {
    refused = true;
    reason = (err as { code?: string; constraint?: string }).constraint ?? "";
  }
  check("DELETE of an ordered product fails", refused, true);
  contains("...by foreign key", reason, "product_id");

  const [stillThere] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM products WHERE id = $1`,
    [productId],
  );
  check("the product is still there afterwards", stillThere.n, 1);
}

/* ------------------------------------------------------------- list filter --- */

console.log("\nlisting and filtering");
{
  const all = await listAdminProducts({ perPage: 100 });
  check("the fixture is listed", all.rows.some((r) => r.id === productId), true);

  const archived = await listAdminProducts({ status: "archived", perPage: 100 });
  check(
    "the status filter finds it while archived",
    archived.rows.some((r) => r.id === productId),
    true,
  );

  const active = await listAdminProducts({ status: "active", perPage: 100 });
  check(
    "the active filter excludes it",
    active.rows.some((r) => r.id === productId),
    false,
  );

  const searched = await listAdminProducts({ q: "Catalogue Fixture Edited", perPage: 100 });
  check("search by title finds it", searched.rows.some((r) => r.id === productId), true);

  // A LIKE metacharacter must not turn into a wildcard.
  const percent = await listAdminProducts({ q: "%", perPage: 100 });
  check("a bare % matches nothing rather than everything", percent.total, 0);
}

/* --------------------------------------------------------------- cleanup --- */

// Orders first: order_items.product_id is ON DELETE RESTRICT, so a product with
// order lines cannot be deleted until its orders are gone.
await sql(`DELETE FROM admin_audit_log WHERE target LIKE 'tmp-cat-%'`);
await sql(`DELETE FROM orders WHERE reference LIKE 'TMP-CAT-%'`);
await sql(`DELETE FROM products WHERE slug LIKE 'tmp-cat-%'`);

const [left] = await sql<{ n: number }>(
  `SELECT (SELECT count(*)::int FROM products WHERE slug LIKE 'tmp-cat-%')
        + (SELECT count(*)::int FROM orders WHERE reference LIKE 'TMP-CAT-%') AS n`,
);
check("teardown removed every fixture", left.n, 0);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\ncatalogue editing OK");
}

await close();
