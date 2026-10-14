/*
  Rating behaviour against the real database.

  Runs the REAL rateProduct() from src/lib/reviews.ts rather than re-transcribing
  its SQL. The thing worth proving is that the aggregate on `products` always
  equals what the `reviews` rows say — that invariant is what makes the number
  on a card trustworthy, and a test that re-implemented the upsert could pass
  while the app was wrong in the same direction.

  A dedicated tmp product is created and destroyed, so this never touches the
  seeded catalogue.

  rateProduct reads the rater id from cookies(), which needs a Next request
  scope, so it is injected through the RATER_ID_OVERRIDE seam documented in
  src/lib/reviews.ts. The seam is read per call, so switching raters mid-test is
  just reassigning the env var.

  Usage: npx tsx scripts/test-ratings.ts
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

const SLUG = `tmp-rating-test`;

async function aggregateMatchesReviews(productId: string): Promise<boolean> {
  const [row] = await sql<{ stored: string; live: string }>(
    `SELECT p.rating::text AS stored,
            COALESCE((SELECT round(avg(rating), 2)::numeric(3,2) FROM reviews
                       WHERE product_id = p.id), 0)::text AS live
       FROM products p WHERE p.id = $1`,
    [productId],
  );
  return Number(row.stored) === Number(row.live);
}

async function main() {
  await sql(`DELETE FROM products WHERE slug = $1`, [SLUG]);

  const [{ id: sellerId }] = await sql<{ id: string }>(`SELECT id FROM sellers LIMIT 1`);
  const [{ id: categoryId }] = await sql<{ id: string }>(`SELECT id FROM categories LIMIT 1`);

  const [{ id: productId }] = await sql<{ id: string }>(
    `INSERT INTO products
       (slug, title, price, stock, stock_reserved, status, seller_id, category_id,
        delivery_fee, rating, rating_count)
     VALUES ($1, 'Rating Test', 1000, 10, 0, 'active', $2, $3, 0, 0, 0)
     RETURNING id`,
    [SLUG, sellerId, categoryId],
  );

  const { rateProduct } = await import("@/lib/reviews");

  const asRater = (id: string) => {
    process.env.RATER_ID_OVERRIDE = id;
  };

  console.log("\nfirst rating");
  asRater("rater-A");
  let r = await rateProduct(productId, 4);
  check("ok", r.ok, true);
  check("rating", r.ok && r.rating, 4);
  check("ratingCount", r.ok && r.ratingCount, 1);
  check("isFirstRating", r.ok && r.isFirstRating, true);

  console.log("\nchanging an existing rating");
  r = await rateProduct(productId, 2);
  check("ok", r.ok, true);
  check("rating replaced, not added", r.ok && r.rating, 2);
  check("count stays 1 — re-rating is an UPDATE", r.ok && r.ratingCount, 1);
  check("isFirstRating is false", r.ok && r.isFirstRating, false);

  const [rows] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM reviews WHERE product_id = $1`,
    [productId],
  );
  check("reviews rows for this product", rows.n, 1);

  console.log("\na second rater");
  asRater("rater-B");
  r = await rateProduct(productId, 5);
  check("ok", r.ok, true);
  check("average of 2 and 5", r.ok && r.rating, 3.5);
  check("count is 2", r.ok && r.ratingCount, 2);

  console.log("\nrejected input");
  for (const bad of [0, 6, 2.5, Number.NaN, "4" as unknown as number]) {
    const out = await rateProduct(productId, bad);
    check(`stars=${String(bad)} rejected`, out.ok, false);
    check(`stars=${String(bad)} reason`, !out.ok && out.reason, "invalid_rating");
  }
  const afterBad = await sql<{ n: number }>(
    `SELECT rating_count AS n FROM products WHERE id = $1`,
    [productId],
  );
  check("count untouched by rejected input", afterBad[0].n, 2);

  console.log("\nunknown and inactive products");
  const missing = await rateProduct("00000000-0000-0000-0000-000000000000", 5);
  check("unknown product rejected", missing.ok, false);
  check("reason", !missing.ok && missing.reason, "not_found");

  await sql(`UPDATE products SET status = 'draft' WHERE id = $1`, [productId]);
  asRater("rater-A");
  const draft = await rateProduct(productId, 1);
  check("inactive product rejected", draft.ok, false);
  await sql(`UPDATE products SET status = 'active' WHERE id = $1`, [productId]);

  console.log("\ninvariant");
  check("products.rating equals a fresh recompute from reviews", await aggregateMatchesReviews(productId), true);

  /*
    Only the tmp product is touched, so cleanup is a single cascade. The
    RATER_ID_OVERRIDE is left set deliberately: this process exits immediately.
  */
  await sql(`DELETE FROM products WHERE slug = $1`, [SLUG]);
  const [leftover] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM reviews WHERE product_id = $1`,
    [productId],
  );
  check("reviews cascade with the product", leftover.n, 0);

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log("\nratings OK");
  }
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await close();
}