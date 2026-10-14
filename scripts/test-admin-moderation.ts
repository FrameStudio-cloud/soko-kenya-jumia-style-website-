/*
  Moderation: suspension across every catalogue read path, review deletion
  recomputing ratings, and the two reference-data editors.

  Four things this must prove, in order of how badly they would go wrong:

  1. SUSPENDING A SELLER HIDES THEIR PRODUCTS EVERYWHERE. This is the widest
     change in the admin console: the condition lives in PRODUCT_SELECT and is
     repeated in the count/facet predicates and the two category counts, so it
     has five places to have been forgotten in. The test drives the real query
     functions rather than re-stating the SQL, so a path that was missed shows
     up as a product still visible on a home page, not as a WHERE clause the
     test happens to agree with.

  2. SUSPENSION IS REVERSIBLE. The same matrix is run before, during and after,
     because the products must come back exactly as they were. Nothing about
     the products is edited, so there is nothing to restore by hand — and this
     is the assertion that keeps it that way.

  3. A STALE CART CANNOT BE CHECKED OUT against a seller who has since been
     suspended, or a product that has since been archived. Neither can be
     reached through the catalogue, so the only way to get here is a basket
     assembled before the change — which is exactly the case worth catching.

  4. DELETING A REVIEW MOVES THE PRODUCT'S STORED RATING. It is denormalised
     onto products, so a delete that forgot it would leave a number pointing at
     reviews that no longer exist, forever.
*/
import { config } from "dotenv";

config({ path: ".env.local" });

import { close, sql } from "./db";

// Type-only: erased at compile time, so it does not affect the load order the
// dynamic imports below are chosen for.
import type {
  CategoryFormValues,
  DeliveryAreaFormValues,
} from "@/lib/admin-moderation-rules";
import type { Filters } from "@/lib/queries";

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
  The seam. Set before importing checkout.ts, which pulls in cart.ts — cart.ts
  reads this at module load. Without it, calling placeOrder outside a request
  throws on cookies(), and the only alternative would be a copy of the function.
*/
const SESSION = `mod-${Date.now()}`;
process.env.CART_SESSION_OVERRIDE = SESSION;

const {
  validateSuspensionReason,
  validateCategoryEdit,
  validateDeliveryAreaEdit,
  parseDeliveryAreaForm,
} = await import("@/lib/admin-moderation-rules");
const {
  listAdminSellers,
  getSellerStatusCounts,
  suspendSeller,
  unsuspendSeller,
  setSellerVerified,
} = await import("@/lib/admin-sellers");
const { listAdminCategories, updateCategory } = await import("@/lib/admin-categories");
const { listAdminDeliveryAreas, updateDeliveryArea } = await import(
  "@/lib/admin-delivery-areas"
);
const { listAdminReviews, deleteReview } = await import("@/lib/admin-reviews");
const {
  filterProducts,
  getActiveProducts,
  getDeals,
  getProductBySlug,
  searchProducts,
  getProductsByCategory,
  getRelatedProducts,
  getCategories,
  getCategoryBySlug,
} = await import("@/lib/queries");
const { placeOrder } = await import("@/lib/checkout");

/* ---------------------------------------------------------------- fixtures --- */

const TAG = "tmp-mod";
const SELLER_SLUG = `${TAG}-seller`;
const CATEGORY_SLUG = `${TAG}-cat`;
const PRODUCT_SLUG = `${TAG}-widget`;
const ARCHIVED_SLUG = `${TAG}-archived`;
const SEARCH_TERM = "Zebrawidgetmoderation";

// Pre-clean, so a previous interrupted run cannot make this one pass or fail
// for the wrong reason.
await sql(`DELETE FROM admin_audit_log WHERE target LIKE 'Tmp Moderation%'`);
await sql(`DELETE FROM admin_audit_log WHERE note LIKE '%${TAG}%' OR note LIKE '%${SEARCH_TERM}%'`);
await sql(`DELETE FROM reviews WHERE product_id IN
             (SELECT id FROM products WHERE slug LIKE '${TAG}-%')`);
await sql(`DELETE FROM orders WHERE id IN (
             SELECT DISTINCT o.id FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
             JOIN products p ON p.id = oi.product_id
            WHERE p.slug LIKE '${TAG}-%')`);
await sql(`DELETE FROM stock_reservations WHERE product_id IN
             (SELECT id FROM products WHERE slug LIKE '${TAG}-%')`);
await sql(`DELETE FROM cart_items WHERE product_id IN
             (SELECT id FROM products WHERE slug LIKE '${TAG}-%')`);
await sql(`DELETE FROM carts WHERE session_id = '${SESSION}'`);
await sql(`UPDATE products SET stock_reserved = 0 WHERE slug LIKE '${TAG}-%'`);
await sql(`DELETE FROM products WHERE slug LIKE '${TAG}-%'`);
await sql(`DELETE FROM categories WHERE slug = '${CATEGORY_SLUG}'`);
await sql(`DELETE FROM sellers WHERE slug = '${SELLER_SLUG}'`);

const [sellerRow] = await sql<{ id: string }>(
  `INSERT INTO sellers (slug, name, location, joined_year, is_verified, status)
        VALUES ($1, 'Tmp Moderation Seller', 'Nairobi', 2026, false, 'active')
   RETURNING id`,
  [SELLER_SLUG],
);
const sellerId = sellerRow.id;

const FULL_FILTER: Filters = {
  q: "",
  category: "",
  sellerId,
  minPrice: null,
  maxPrice: null,
  minRating: null,
  inStockOnly: false,
  officialOnly: false,
  sort: "newest",
};

const [categoryRow] = await sql<{ id: string }>(
  `INSERT INTO categories (slug, name) VALUES ($1, 'Tmp Moderation Category') RETURNING id`,
  [CATEGORY_SLUG],
);
const categoryId = categoryRow.id;

/*
  A big enough discount to always sort first in getDeals(), which orders by
  (compare_at_price - price) DESC — otherwise the test would depend on how many
  seeded products happen to be on offer today.
*/
const [productRow] = await sql<{ id: string }>(
  `INSERT INTO products
       (slug, title, price, compare_at_price, stock, stock_reserved, status,
        seller_id, category_id, delivery_fee, rating, rating_count, brand)
   VALUES ($1, $2, 100, 999999, 20, 0, 'active', $3, $4, 0, 0, 0, 'FixtureCo')
   RETURNING id`,
  [PRODUCT_SLUG, `${SEARCH_TERM} Widget`, sellerId, categoryId],
);
const productId = productRow.id;

/* --------------------------------------------------------- the read matrix --- */

/*
  Every public way a product can be found, driven through the real query
  functions.

  Returning a record rather than asserting inline is the point: the same
  matrix runs three times — active, suspended, reinstated — and any path that
  drifts out of step with the others names itself in the output.
*/
async function visibility(): Promise<Record<string, boolean | number>> {
  const [filtered, active, deals, bySlug, searched, inCategory, related, all, one] =
    await Promise.all([
      // Every field of Filters is required — `minPrice: undefined` would build
      // `p.price >= ` and Postgres would refuse the whole query.
      filterProducts(FULL_FILTER, 50),
      getActiveProducts(500),
      getDeals(5),
      getProductBySlug(PRODUCT_SLUG),
      searchProducts(SEARCH_TERM, 50),
      getProductsByCategory(CATEGORY_SLUG),
      // Any id that is not the fixture: the query excludes its own argument,
      // so passing the fixture would assert nothing.
      getRelatedProducts(categoryId, "00000000-0000-4000-8000-0000000000ff", 50),
      getCategories(),
      getCategoryBySlug(CATEGORY_SLUG),
    ]);

  const ids = (rows: Array<{ id: string }>) => rows.some((r) => r.id === productId);

  return {
    filterProducts: ids(filtered.products),
    filterTotal: filtered.total,
    getActiveProducts: ids(active),
    getDeals: ids(deals),
    getProductBySlug: bySlug !== null,
    searchProducts: ids(searched),
    getProductsByCategory: ids(inCategory),
    getRelatedProducts: ids(related),
    categoryCount: all.find((c) => c.slug === CATEGORY_SLUG)?.productCount ?? -1,
    categoryPageCount: one?.productCount ?? -1,
  };
}

console.log("\nsuspension hides a seller's products on every read path");
{
  const visible = await visibility();

  check("filterProducts lists it", visible.filterProducts, true);
  check("filterProducts counts it", visible.filterTotal, 1);
  check("getActiveProducts includes it", visible.getActiveProducts, true);
  check("getDeals includes it", visible.getDeals, true);
  check("getProductBySlug resolves it", visible.getProductBySlug, true);
  check("searchProducts finds it", visible.searchProducts, true);
  check("getProductsByCategory includes it", visible.getProductsByCategory, true);
  check("getRelatedProducts includes it", visible.getRelatedProducts, true);
  check("getCategories counts it", visible.categoryCount, 1);
  check("getCategoryBySlug counts it", visible.categoryPageCount, 1);

  console.log("\nsuspending the seller");

  const suspended = await suspendSeller({
    sellerId,
    reason: `Fixture suspension for ${TAG}`,
    actor: "admin",
  });
  truthy("suspendSeller returned ok", suspended.ok);

  const hidden = await visibility();

  check("filterProducts drops it", hidden.filterProducts, false);
  check("filterProducts total is 0", hidden.filterTotal, 0);
  check("getActiveProducts drops it", hidden.getActiveProducts, false);
  check("getDeals drops it", hidden.getDeals, false);
  check("getProductBySlug 404s", hidden.getProductBySlug, false);
  check("searchProducts drops it", hidden.searchProducts, false);
  check("getProductsByCategory drops it", hidden.getProductsByCategory, false);
  check("getRelatedProducts drops it", hidden.getRelatedProducts, false);
  check("getCategories count is 0", hidden.categoryCount, 0);
  check("getCategoryBySlug count is 0", hidden.categoryPageCount, 0);

  const sellers = await listAdminSellers({ status: "suspended" });
  const mine = sellers.find((s) => s.id === sellerId);
  check("console still lists the seller", Boolean(mine), true);
  check("reason recorded on the row", mine?.suspensionReason, `Fixture suspension for ${TAG}`);

  // The console counts the seller's products regardless of status: they are
  // still theirs, still editable, and still there when they are reinstated.
  check("console still counts their product", mine?.productCount, 1);

  const counts = await getSellerStatusCounts();
  check("both statuses are reported", counts.length, 2);

  console.log("\nreinstating the seller");

  const back = await unsuspendSeller({ sellerId, actor: "admin" });
  truthy("unsuspendSeller returned ok", back.ok);

  const restored = await visibility();

  check("filterProducts lists it again", restored.filterProducts, true);
  check("getActiveProducts includes it again", restored.getActiveProducts, true);
  check("getDeals includes it again", restored.getDeals, true);
  check("getProductBySlug resolves again", restored.getProductBySlug, true);
  check("searchProducts finds it again", restored.searchProducts, true);
  check("getProductsByCategory includes it again", restored.getProductsByCategory, true);
  check("getRelatedProducts includes it again", restored.getRelatedProducts, true);
  check("getCategories counts it again", restored.categoryCount, 1);
  check("getCategoryBySlug counts it again", restored.categoryPageCount, 1);

  // The whole point of suspending by a column rather than by touching products:
  // nothing has to be restored, because nothing was changed.
  const [productStill] = await sql<{ status: string; stock: number }>(
    `SELECT status, stock FROM products WHERE id = $1`,
    [productId],
  );
  check("product status untouched", productStill.status, "active");
  check("product stock untouched", Number(productStill.stock), 20);

  const [unsuspended] = await sql<{ reason: string | null }>(
    `SELECT suspension_reason AS reason FROM sellers WHERE id = $1`,
    [sellerId],
  );
  check("reason cleared on reinstatement", unsuspended.reason, null);
}

/* --------------------------------------------------- stale cart at checkout --- */

console.log("\nplaceOrder refuses a stale cart");

/*
  A fresh cart per scenario, and it has to be fresh.

  placeOrder() CONVERTS the cart it reads — the row stops being `active`, and
  `carts_active_session_key` is a partial unique index covering only active
  carts. Reusing the converted row therefore comes back as "your cart is empty"
  rather than the refusal this test is looking for, which is exactly what the
  first draft reported.
*/
let cartId = "";

async function freshCart(): Promise<string> {
  /*
    Clear any cart still active for this session first.

    A REFUSED order leaves its cart active — only a converted one stops being
    active — and `carts_active_session_key` allows exactly one active cart per
    session. So without this the second scenario trips the unique index rather
    than reaching the code it is meant to be testing.
  */
  await sql(
    `DELETE FROM stock_reservations
      WHERE cart_id IN (SELECT id FROM carts WHERE session_id = $1 AND status = 'active')`,
    [SESSION],
  );
  await sql(
    `DELETE FROM cart_items
      WHERE cart_id IN (SELECT id FROM carts WHERE session_id = $1 AND status = 'active')`,
    [SESSION],
  );
  await sql(`DELETE FROM carts WHERE session_id = $1 AND status = 'active'`, [SESSION]);

  const [row] = await sql<{ id: string }>(
    `INSERT INTO carts (session_id) VALUES ($1) RETURNING id`,
    [SESSION],
  );
  cartId = row.id;
  return cartId;
}

async function addLine(productIdToAdd: string, qty: number) {
  await sql(
    `UPDATE products SET stock_reserved = stock_reserved + $2 WHERE id = $1`,
    [productIdToAdd, qty],
  );
  await sql(
    `INSERT INTO stock_reservations (product_id, cart_id, quantity, expires_at)
          VALUES ($1, $2, $3, now() + interval '30 minutes')`,
    [productIdToAdd, cartId, qty],
  );
  await sql(
    `INSERT INTO cart_items (cart_id, product_id, quantity, added_price)
          VALUES ($1, $2, $3, 100)`,
    [cartId, productIdToAdd, qty],
  );
}

/** Put the fixture products back to full, unheld stock between scenarios. */
async function resetStock() {
  await sql(`UPDATE products SET stock = 20, stock_reserved = 0 WHERE slug LIKE '${TAG}-%'`);
}

const CHECKOUT = {
  recipientName: "Wanjiku Kamau",
  phone: "0712345678",
  county: "Nairobi",
  town: "Westlands",
  street: "Karen Blk 4",
  paymentMethod: "cod" as const,
};

{
  // The basket is assembled while the seller is still trading, which is the
  // only way to reach this case — nothing in the catalogue would add the line
  // afterwards.
  await freshCart();
  await addLine(productId, 2);

  const before = await placeOrder(CHECKOUT);
  truthy("an order from an active seller still goes through", before.ok);

  // A new cart: the one above has been converted and is no longer active.
  await freshCart();
  await sql(`DELETE FROM orders WHERE reference = $1`, [
    before.ok ? before.references[0] : "",
  ]);
  await resetStock();

  await addLine(productId, 2);
  await suspendSeller({ sellerId, reason: `Fixture suspension for ${TAG}`, actor: "admin" });

  const refused = await placeOrder(CHECKOUT);
  check("refused", refused.ok, false);
  check(
    "reason is unavailable_item",
    !refused.ok ? refused.reason : "ok",
    "unavailable_item",
  );
  containsMessage(!refused.ok ? refused.message : "", "no longer available");

  // And nothing was taken: the hold is still the shopper's to release.
  const [stillHeld] = await sql<{ stock_reserved: number }>(
    `SELECT stock_reserved FROM products WHERE id = $1`,
    [productId],
  );
  check("hold left in place", Number(stillHeld.stock_reserved), 2);

  const [ordersLeft] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM orders
      WHERE id IN (SELECT order_id FROM order_items WHERE product_id = $1)`,
    [productId],
  );
  check("no order was created", ordersLeft.n, 0);

  await unsuspendSeller({ sellerId, actor: "admin" });
}

function containsMessage(haystack: string, needle: string) {
  const ok = haystack.includes(needle);
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"} message says "${needle}"${ok ? "" : `  (got "${haystack}")`}`);
}

console.log("\nplaceOrder refuses an archived product in a stale cart");
{
  // A different product from an active seller, so the seller filter cannot be
  // what refuses this one.
  const [activeSeller] = await sql<{ id: string }>(
    `SELECT id FROM sellers WHERE status = 'active' AND slug <> $1 ORDER BY slug LIMIT 1`,
    [SELLER_SLUG],
  );
  const [archived] = await sql<{ id: string }>(
    `INSERT INTO products
       (slug, title, price, stock, stock_reserved, status, seller_id, category_id,
        delivery_fee, rating, rating_count)
     VALUES ($1, 'Tmp Archived Widget', 100, 20, 0, 'active', $2, $3, 0, 0, 0)
     RETURNING id`,
    [ARCHIVED_SLUG, activeSeller.id, categoryId],
  );

  await freshCart();
  await addLine(archived.id, 1);

  const okFirst = await placeOrder(CHECKOUT);
  truthy("an active product checks out", okFirst.ok);

  // A new cart: the one above has been converted.
  await freshCart();
  await sql(`DELETE FROM orders WHERE reference = $1`, [
    okFirst.ok ? okFirst.references[0] : "",
  ]);
  await resetStock();

  await addLine(archived.id, 1);
  await sql(`UPDATE products SET status = 'archived' WHERE id = $1`, [archived.id]);

  const refused = await placeOrder(CHECKOUT);
  check("refused", refused.ok, false);
  check(
    "reason is unavailable_item",
    !refused.ok ? refused.reason : "ok",
    "unavailable_item",
  );
}

await resetStock();

/* ------------------------------------------------------------- reviews --- */

console.log("\ndeleting a review recomputes the product rating");
{
  await sql(`DELETE FROM reviews WHERE product_id = $1`, [productId]);

  await sql(
    `INSERT INTO reviews (product_id, user_id, rating, body)
          VALUES ($1, 'mod-rater-a', 5, 'Excellent'),
                 ($1, 'mod-rater-b', 1, 'Terrible')`,
    [productId],
  );

  /*
    Bring the denormalised rating into line by hand, because these rows were
    inserted directly rather than through rateProduct(), which is what normally
    maintains it. Without this the product would start at 0 and the first
    assertion below would be measuring the insert, not the delete.
  */
  await sql(
    `UPDATE products p
        SET rating = r.avg_rating, rating_count = r.n
       FROM (SELECT COALESCE(round(avg(rating), 2), 0)::numeric(3,2) AS avg_rating,
                    count(*)::int AS n
               FROM reviews WHERE product_id = $1) r
      WHERE p.id = $1`,
    [productId],
  );

  const [twoStar] = await sql<{ rating: string; rating_count: number }>(
    `SELECT rating, rating_count FROM products WHERE id = $1`,
    [productId],
  );
  check("two reviews average to 3", Number(twoStar.rating), 3);
  check("count is 2", Number(twoStar.rating_count), 2);

  const reviews = await listAdminReviews({ q: SEARCH_TERM });
  const five = reviews.find((r) => r.rating === 5);
  truthy("the console lists both", Boolean(five));

  const deleted = await deleteReview({ reviewId: five!.id, actor: "admin" });
  truthy("deleteReview returned ok", deleted.ok);

  const [oneLeft] = await sql<{ rating: string; rating_count: number }>(
    `SELECT rating, rating_count FROM products WHERE id = $1`,
    [productId],
  );
  check("rating recomputed to the single remaining review", Number(oneLeft.rating), 1);
  check("count recomputed to 1", Number(oneLeft.rating_count), 1);

  // Deleting the last one has to take it back to zero, not leave a rating with
  // nothing behind it.
  const remaining = await listAdminReviews({ q: SEARCH_TERM });
  const last = remaining.find((r) => r.productId === productId);
  const gone = await deleteReview({ reviewId: last!.id, actor: "admin" });
  truthy("deleting the last review returned ok", gone.ok);

  const [zero] = await sql<{ rating: string; rating_count: number }>(
    `SELECT rating, rating_count FROM products WHERE id = $1`,
    [productId],
  );
  check("rating back to 0", Number(zero.rating), 0);
  check("count back to 0", Number(zero.rating_count), 0);

  const again = await deleteReview({ reviewId: last!.id, actor: "admin" });
  check("a second delete is refused", again.ok, false);
}

/* ------------------------------------------------------------ categories --- */

console.log("\ncategory editing");
{
  const validated = validateCategoryEdit({ name: "  ", slug: "Bad Slug" });
  check("empty name rejected", !validated.ok && validated.errors.name ? "y" : "n", "y");
  check("bad slug rejected", !validated.ok && validated.errors.slug ? "y" : "n", "y");

  const categories = await listAdminCategories();
  const mine = categories.find((c) => c.slug === CATEGORY_SLUG);
  truthy("the fixture category is listed", Boolean(mine));
  check("its count matches the public count", mine?.productCount, 1);

  const dupInput: CategoryFormValues = {
    name: "Renamed",
    // A slug another category already owns.
    slug: (categories.find((c) => c.slug !== CATEGORY_SLUG) ?? { slug: "" }).slug,
  };
  const dup = await updateCategory({ categoryId, input: dupInput, actor: "admin" });
  check("a duplicate slug is refused", dup.ok, false);
  check(
    "with a sentence, not a constraint name",
    !dup.ok ? (dup.errors.slug ?? "") : "",
    "Another category already uses that slug.",
  );

  const good = await updateCategory({
    categoryId,
    input: { name: "Tmp Moderation Renamed", slug: `${CATEGORY_SLUG}-renamed` },
    actor: "admin",
  });
  truthy("a valid rename is accepted", good.ok);
  containsMessage(!good.ok ? "" : good.message, "will stop working");

  const [renamed] = await sql<{ name: string; slug: string }>(
    `SELECT name, slug FROM categories WHERE id = $1`,
    [categoryId],
  );
  check("name persisted", renamed.name, "Tmp Moderation Renamed");
  check("slug persisted", renamed.slug, `${CATEGORY_SLUG}-renamed`);

  // The renamed slug is the one the read paths must now answer to.
  const [byNewSlug] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM categories WHERE slug = $1`,
    [`${CATEGORY_SLUG}-renamed`],
  );
  check("the new slug resolves", byNewSlug.n, 1);
}

/* -------------------------------------------------------- delivery areas --- */

console.log("\ndelivery area editing");
{
  const areas = await listAdminDeliveryAreas();
  const nairobi = areas.find((a) => a.county === "Nairobi");
  truthy("Nairobi is listed", Boolean(nairobi));

  const badEta = validateDeliveryAreaEdit({
    baseFee: "150",
    freeDeliveryThreshold: "",
    etaDaysMin: "5",
    etaDaysMax: "2",
    isActive: true,
  });
  check(
    "eta_max below eta_min is refused",
    !badEta.ok ? badEta.errors.etaDaysMax ?? "" : "",
    "The longest estimate cannot be shorter than the shortest (5).",
  );

  const negative = validateDeliveryAreaEdit({
    baseFee: "-1",
    freeDeliveryThreshold: "",
    etaDaysMin: "1",
    etaDaysMax: "3",
    isActive: true,
  });
  check("a negative fee is refused", !negative.ok && negative.errors.baseFee ? "y" : "n", "y");

  // An empty threshold has to become NULL, not 0. 0 means every basket ships
  // free; NULL means there is no threshold at all. Reading the empty string as
  // zero would silently make Nairobi free.
  const parsed = parseDeliveryAreaForm(
    new FormData(),
  );
  check("an unticked checkbox reads as inactive", parsed.isActive, false);
  check("an empty threshold reads as empty", parsed.freeDeliveryThreshold, "");

  const good = validateDeliveryAreaEdit({
    baseFee: "250",
    freeDeliveryThreshold: "",
    etaDaysMin: "1",
    etaDaysMax: "4",
    isActive: true,
  });
  truthy("a valid edit is accepted", good.ok);
  check(
    "and the empty threshold became NULL",
    good.ok ? String(good.value.freeDeliveryThreshold) : "bad",
    "null",
  );

  const saved = await updateDeliveryArea({
    deliveryAreaId: nairobi!.id,
    input: {
      baseFee: "250",
      freeDeliveryThreshold: "",
      etaDaysMin: "1",
      etaDaysMax: "4",
      isActive: true,
    } satisfies DeliveryAreaFormValues,
    actor: "admin",
  });
  truthy("the edit is saved", saved.ok);

  const [stored] = await sql<{ base_fee: string; free_delivery_threshold: string | null }>(
    `SELECT base_fee, free_delivery_threshold FROM delivery_areas WHERE id = $1`,
    [nairobi!.id],
  );
  check("fee persisted", Number(stored.base_fee), 250);
  check("threshold stored as NULL, not 0", stored.free_delivery_threshold, null);

  // Put Nairobi back the way it was. The checkout suite quotes it by name and
  // a changed fee would make its arithmetic wrong for reasons of ours.
  const restore = await updateDeliveryArea({
    deliveryAreaId: nairobi!.id,
    input: {
      baseFee: String(nairobi!.baseFee),
      freeDeliveryThreshold:
        nairobi!.freeDeliveryThreshold === null ? "" : String(nairobi!.freeDeliveryThreshold),
      etaDaysMin: String(nairobi!.etaDaysMin),
      etaDaysMax: String(nairobi!.etaDaysMax),
      isActive: nairobi!.isActive,
    } satisfies DeliveryAreaFormValues,
    actor: "admin",
  });
  truthy("Nairobi restored to its original values", restore.ok);
}

/* --------------------------------------------------------- suspension rule --- */

console.log("\nsuspension needs a reason");
{
  const empty = validateSuspensionReason("   ");
  check(
    "an empty reason is refused",
    !empty.ok ? empty.message : "",
    "Say why this seller is being suspended — it is the only record of the decision.",
  );

  const long = validateSuspensionReason("x".repeat(501));
  check("an over-long reason is refused", !long.ok, true);

  const okReason = validateSuspensionReason("  Repeated no-shows.  ");
  check("a reason is trimmed", okReason.ok ? okReason.reason : "", "Repeated no-shows.");

  // Suspending twice must not stack suspensions or rewrite the original
  // reason — the first one is the record.
  await suspendSeller({ sellerId, reason: `First reason for ${TAG}`, actor: "admin" });
  const second = await suspendSeller({ sellerId, reason: `Second reason for ${TAG}`, actor: "admin" });
  check("a second suspension is refused", second.ok, false);

  const [row] = await sql<{ suspension_reason: string }>(
    `SELECT suspension_reason FROM sellers WHERE id = $1`,
    [sellerId],
  );
  check("the original reason survives", row.suspension_reason, `First reason for ${TAG}`);

  /*
    Verified and suspended are separate facts and neither derives from the
    other: suspending must not quietly withdraw a badge, and reinstating must
    not hand one back.
  */
  const verified = await setSellerVerified({ sellerId, verified: true, actor: "admin" });
  truthy("the seller can be verified while suspended", verified.ok);

  const [verifiedRow] = await sql<{ is_verified: boolean; status: string }>(
    `SELECT is_verified, status FROM sellers WHERE id = $1`,
    [sellerId],
  );
  check("verification set", verifiedRow.is_verified, true);
  check("still suspended", verifiedRow.status, "suspended");

  await unsuspendSeller({ sellerId, actor: "admin" });

  const [afterRow] = await sql<{ is_verified: boolean; status: string }>(
    `SELECT is_verified, status FROM sellers WHERE id = $1`,
    [sellerId],
  );
  check("reinstatement kept the verification", afterRow.is_verified, true);
  check("and made them active", afterRow.status, "active");

  const repeated = await setSellerVerified({ sellerId, verified: true, actor: "admin" });
  check("verifying twice is refused rather than duplicated", repeated.ok, false);

  const unverified = await setSellerVerified({ sellerId, verified: false, actor: "admin" });
  truthy("verification can be withdrawn", unverified.ok);
}

/* ------------------------------------------------------------ audit trail --- */

console.log("\naudit trail");
{
  const rows = await sql<{ action: string; n: number }>(
    `SELECT action, count(*)::int AS n FROM admin_audit_log
      WHERE target LIKE 'Tmp Moderation%'
         OR target = 'Nairobi'
         OR note LIKE '%${TAG}%'
         OR note LIKE '%${SEARCH_TERM}%'
      GROUP BY action ORDER BY action`,
  );
  const actions = new Map(rows.map((r) => [r.action, r.n]));

  check("seller_suspend recorded", (actions.get("seller_suspend") ?? 0) > 0, true);
  check("seller_unsuspend recorded", (actions.get("seller_unsuspend") ?? 0) > 0, true);
  check("review_delete recorded", (actions.get("review_delete") ?? 0) > 0, true);
  check("category_update recorded", (actions.get("category_update") ?? 0) > 0, true);
  check("delivery_area_update recorded", (actions.get("delivery_area_update") ?? 0) > 0, true);

  // The audit row is the only record of why somebody was suspended, so the
  // reason has to actually be in it.
  const [reasonRow] = await sql<{ note: string }>(
    `SELECT note FROM admin_audit_log
      WHERE action = 'seller_suspend' AND target = 'Tmp Moderation Seller'
      ORDER BY created_at DESC LIMIT 1`,
  );
  containsMessage(reasonRow?.note ?? "", "First reason for");
}

/* --------------------------------------------------------------- cleanup --- */

await sql(`DELETE FROM admin_audit_log WHERE target = 'Tmp Moderation Seller'`);
await sql(`DELETE FROM admin_audit_log WHERE target LIKE '${CATEGORY_SLUG}%'`);
await sql(`DELETE FROM admin_audit_log WHERE target = 'Nairobi'`);
// review_delete rows key on the review id, which has already been deleted, so
// the product name in the note is the only handle left on them.
await sql(`DELETE FROM admin_audit_log WHERE note LIKE '%${SEARCH_TERM}%'`);
await sql(`DELETE FROM reviews WHERE product_id IN
             (SELECT id FROM products WHERE slug LIKE '${TAG}-%')`);
await sql(`DELETE FROM orders WHERE id IN (
             SELECT DISTINCT o.id FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
             JOIN products p ON p.id = oi.product_id
            WHERE p.slug LIKE '${TAG}-%')`);
await sql(`DELETE FROM stock_reservations WHERE cart_id IN
             (SELECT id FROM carts WHERE session_id = '${SESSION}')`);
await sql(`DELETE FROM cart_items WHERE cart_id IN
             (SELECT id FROM carts WHERE session_id = '${SESSION}')`);
await sql(`DELETE FROM carts WHERE session_id = '${SESSION}'`);
await sql(`DELETE FROM products WHERE slug LIKE '${TAG}-%'`);
await sql(`DELETE FROM categories WHERE slug LIKE '${CATEGORY_SLUG}%'`);
await sql(`DELETE FROM sellers WHERE slug = '${SELLER_SLUG}'`);

const [left] = await sql<{ n: number }>(
  `SELECT (SELECT count(*)::int FROM products WHERE slug LIKE '${TAG}-%')
        + (SELECT count(*)::int FROM sellers WHERE slug = '${SELLER_SLUG}')
        + (SELECT count(*)::int FROM categories WHERE slug LIKE '${CATEGORY_SLUG}%')
        + (SELECT count(*)::int FROM carts WHERE session_id = '${SESSION}') AS n`,
);
check("teardown removed every fixture", left.n, 0);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nmoderation OK");
}

await close();
