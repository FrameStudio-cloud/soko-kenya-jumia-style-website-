import { cookies } from "next/headers";
import { client, query } from "@/db";

/*
  Product ratings.

  `reviews` has existed since the first migration — a table, a 1..5 check and a
  unique (user_id, product_id) index — with no reader and no writer anywhere in
  the app. Every star on screen was a denormalised number that nothing could
  ever change. This module is the only place that writes one.

  The aggregate on `products` is REBUILT from reviews rather than incremented.
  Incrementing a running average needs the previous sum and the previous count,
  and neither is stored, so the first write would already be wrong and every
  one after it would compound the error. Recomputing from a count of rows is one
  index scan over a handful of entries and cannot be wrong.

  -----------------------------------------------------------------------
  The consequence of rebuilding, stated up front

  The catalogue was seeded with fictional aggregates — 4.8 from 2.2k ratings —
  that no review row backs. So the first genuine rating on a product replaces
  them with the real average and a count of 1. That is correct rather than
  broken: reviews is now the source of truth and products.rating only mirrors
  it. Until the seed inserts real review rows, the seeded averages are fiction
  that happens to look plausible.
*/

const RATER_COOKIE = "soko_rater";
const RATER_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type RateResult =
  | {
      ok: true;
      rating: number;
      ratingCount: number;
      /** False when this replaced the rater's own previous vote. */
      isFirstRating: boolean;
    }
  | { ok: false; reason: "invalid_rating" | "not_found" | "no_rater"; message: string };

/**
 * Read this device's rater id, or undefined if it has never rated anything.
 *
 * READ ONLY. A page render cannot set a cookie: Next.js permits cookie writes
 * only inside a Server Action or Route Handler, and calling `set` during render
 * throws. So this never mints one — the product page simply shows "no rating
 * yet", which is correct for a device that has never rated. The cookie is
 * minted in the server action, which is allowed to write.
 */
export async function readRaterId(): Promise<string | undefined> {
  /* Test seam — see CART_SESSION_OVERRIDE in src/lib/cart.ts. Set by
     scripts/test-ratings.ts before importing this module; unset in the app. */
  if (process.env.RATER_ID_OVERRIDE) {
    return process.env.RATER_ID_OVERRIDE;
  }

  const jar = await cookies();
  return jar.get(RATER_COOKIE)?.value;
}

/**
 * Mint the rater cookie. Server Action / Route Handler only.
 *
 * httpOnly   script cannot read or forge it.
 * sameSite   lax survives top-level navigation and blocks cross-site POSTs.
 * maxAge     a year, so a shopper who rated in March is still recognised in
 *            November. A visitor is not a returning user by intent.
 *
 * NOT signed. Same reason and same consequence as the cart cookie: with no auth
 * secret there is nothing to sign with, so this is an unguessable UUID rather
 * than a tamper-evident token. It identifies a DEVICE, not a person — clearing
 * cookies produces a new identity and a second vote. The database unique index
 * is the real guard against two votes from one device; this cookie is what
 * makes re-rating an update instead of a new row. When Neon Auth lands, drop
 * the cookie and key on the account id instead.
 */
export async function issueRaterCookie(): Promise<string> {
  const id = crypto.randomUUID();
  const jar = await cookies();

  jar.set(RATER_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: RATER_MAX_AGE_SECONDS,
  });

  return id;
}

/** The star this device gave this product, or null if it has not rated it. */
export async function getMyRating(productId: string): Promise<number | null> {
  const raterId = await readRaterId();
  if (!raterId) return null;

  const [row] = await query<{ rating: number }>(
    `SELECT rating FROM reviews WHERE user_id = $1 AND product_id = $2`,
    [raterId, productId],
  );

  return row ? row.rating : null;
}

/**
 * Record a rating and rebuild the product's aggregate.
 *
 * Both writes share one transaction, and the product row is locked first. Two
 * visitors rating the same product at the same moment must serialise their
 * recompute: without the lock the slower one rebuilds from a set that does not
 * yet contain the faster one's vote, and the faster rating silently disappears
 * from the average while still counting in the total.
 */
export async function rateProduct(
  productId: string,
  stars: number,
): Promise<RateResult> {
  // Never trust the number that arrived from the browser.
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return {
      ok: false,
      reason: "invalid_rating",
      message: "Choose a rating between 1 and 5 stars.",
    };
  }

  const raterId = await readRaterId();
  if (!raterId) {
    return {
      ok: false,
      reason: "no_rater",
      message: "We could not tell this device apart yet. Please try again.",
    };
  }

  const conn = await client();

  try {
    await conn.query("BEGIN");

    // FOR UPDATE serialises concurrent raters on this product. Also the
    // existence check: an inactive or unknown product must not gain a rating.
    const product = await conn.query(
      `SELECT id FROM products WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [productId],
    );
    if (product.rowCount === 0) {
      await conn.query("ROLLBACK");
      return {
        ok: false,
        reason: "not_found",
        message: "That product is no longer available.",
      };
    }

    const existing = await conn.query(
      `SELECT 1 FROM reviews WHERE user_id = $1 AND product_id = $2`,
      [raterId, productId],
    );
    const isFirstRating = existing.rowCount === 0;

    /*
      Upsert on the unique index, so a second tap on a different star is an
      UPDATE and not a second row. created_at moves too — the column is "when
      this rater's current opinion was formed", not "when they first rated",
      and nothing sorts by it yet.
    */
    await conn.query(
      `INSERT INTO reviews (product_id, user_id, rating)
            VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET rating = EXCLUDED.rating, created_at = now()`,
      [productId, raterId, stars],
    );

    /*
      The subquery is an ungrouped aggregate, so it returns exactly one row even
      when there are no reviews — which is what lets the same statement set
      rating to 0 and count to 0 rather than leaving a product untouched.

      round() to two places because products.rating is numeric(3,2); an unrounded
      average would overflow the column.
    */
    const aggregate = await conn.query(
      `UPDATE products p
          SET rating = r.avg_rating,
              rating_count = r.n
         FROM (
           SELECT COALESCE(round(avg(rating), 2), 0)::numeric(3,2) AS avg_rating,
                  count(*)::int AS n
             FROM reviews
            WHERE product_id = $1
         ) r
        WHERE p.id = $1
        RETURNING p.rating, p.rating_count`,
      [productId],
    );

    await conn.query("COMMIT");

    return {
      ok: true,
      rating: Number(aggregate.rows[0].rating),
      ratingCount: Number(aggregate.rows[0].rating_count),
      isFirstRating,
    };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}