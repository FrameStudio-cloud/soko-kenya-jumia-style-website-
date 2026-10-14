import { client, query } from "@/db";

/*
  Review moderation: the I/O half.

  A review is public content — its body is rendered on the product page to
  everybody, so nothing here is masked and the moderation screen does not need
  an audited reveal. `user_id` is the random id handed out by the rater cookie,
  not anything that identifies a person, so it can be shown as it is.

  There is no hide, only delete, and that is the schema's doing: `reviews` has
  no status column and adding one would mean filtering it out of the public
  reads and out of the rating average in two places. The audit row is what
  makes a hard delete defensible — it records the id, the product, the rating
  and the text, so a deletion that turns out to be a mistake can be undone by
  hand.

  Deleting a review has to move the product's stored rating, or the number on
  the product page drifts away from the reviews underneath it forever. The
  aggregate is the same one rateProduct() writes, inside the same transaction
  as the delete, because a rating that survives a crash half-updated is worse
  than one that is stale.
*/

export type AdminReviewRow = {
  id: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  rating: number;
  title: string | null;
  body: string | null;
  userId: string;
  orderId: string | null;
  createdAt: string;
};

export type ReviewFilter = {
  q?: string;
  rating?: number | null;
};

export async function listAdminReviews(
  filter: ReviewFilter = {},
  limit = 100,
): Promise<AdminReviewRow[]> {
  const { q = "", rating = null } = filter;

  const predicates: string[] = [];
  const params: unknown[] = [];

  if (rating !== null) {
    params.push(rating);
    predicates.push(`r.rating = $${params.length}`);
  }
  if (q.trim()) {
    params.push(`%${q.trim().replace(/([\\%_])/g, "\\$1")}%`);
    predicates.push(
      `(p.title ILIKE $${params.length} OR r.body ILIKE $${params.length}
        OR r.title ILIKE $${params.length})`,
    );
  }
  params.push(limit);

  const rows = await query<{
    id: string;
    product_id: string;
    product_title: string;
    product_slug: string;
    rating: number;
    review_title: string | null;
    body: string | null;
    user_id: string;
    order_id: string | null;
    created_at: Date;
  }>(
    `SELECT r.id, r.product_id, p.title AS product_title, p.slug AS product_slug,
            r.rating, r.title AS review_title, r.body, r.user_id, r.order_id,
            r.created_at
       FROM reviews r
       JOIN products p ON p.id = r.product_id
      ${predicates.length > 0 ? `WHERE ${predicates.join(" AND ")}` : ""}
      ORDER BY r.created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    productTitle: r.product_title,
    productSlug: r.product_slug,
    rating: Number(r.rating),
    title: r.review_title,
    body: r.body,
    userId: r.user_id,
    orderId: r.order_id,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function countAdminReviews(filter: ReviewFilter = {}): Promise<number> {
  const { q = "", rating = null } = filter;
  const params: unknown[] = [];
  const predicates: string[] = [];

  if (rating !== null) {
    params.push(rating);
    predicates.push(`r.rating = $${params.length}`);
  }
  if (q.trim()) {
    params.push(`%${q.trim().replace(/([\\%_])/g, "\\$1")}%`);
    predicates.push(
      `(p.title ILIKE $${params.length} OR r.body ILIKE $${params.length}
        OR r.title ILIKE $${params.length})`,
    );
  }

  const rows = await query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM reviews r
       JOIN products p ON p.id = r.product_id
      ${predicates.length > 0 ? `WHERE ${predicates.join(" AND ")}` : ""}`,
    params,
  );
  return rows[0]?.n ?? 0;
}

export type ReviewDeleteResult =
  | { ok: true; message: string; productTitle: string }
  | { ok: false; message: string };

/** How much of a deleted review's text the audit row keeps. */
const AUDIT_EXCERPT = 200;

export async function deleteReview({
  reviewId,
  actor,
}: {
  reviewId: string;
  actor: string;
}): Promise<ReviewDeleteResult> {
  const conn = await client();
  try {
    await conn.query("BEGIN");

    const current = await conn.query<{
      id: string;
      product_id: string;
      rating: number;
      title: string | null;
      body: string | null;
      user_id: string;
    }>(
      `SELECT id, product_id, rating, title, body, user_id
         FROM reviews WHERE id = $1 FOR UPDATE`,
      [reviewId],
    );

    if (current.rows.length === 0) {
      await conn.query("ROLLBACK");
      // The common case is a second moderator deleting the same row a moment
      // after the first. Saying so is more useful than "not found".
      return { ok: false, message: "That review has already been deleted." };
    }

    const review = current.rows[0];

    await conn.query(`DELETE FROM reviews WHERE id = $1`, [reviewId]);

    /*
      The stored rating is denormalised onto products, so it has to follow.

      round() to two places because products.rating is numeric(3,2) and an
      unrounded average would overflow it. The subquery is ungrouped, so it
      returns exactly one row even with no reviews left — which is what lets a
      product's last review take it back to 0 rather than leaving a number
      pointing at nothing.
    */
    const recompute = await conn.query<{
      rating: string;
      rating_count: number;
      title: string;
      slug: string;
    }>(
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
        RETURNING p.rating, p.rating_count, p.title, p.slug`,
      [review.product_id],
    );

    await conn.query("COMMIT");

    const product = recompute.rows[0];
    const excerpt = (review.body ?? review.title ?? "").trim().slice(0, AUDIT_EXCERPT);

    const { recordAdminAction } = await import("@/lib/admin-audit");
    await recordAdminAction({
      actor,
      action: "review_delete",
      target: review.id,
      note: `Deleted a ${review.rating}-star review${
        product ? ` of "${product.title}"` : ""
      }: ${excerpt}${excerpt.length === AUDIT_EXCERPT ? "…" : ""}`,
    });

    return {
      ok: true,
      productTitle: product?.title ?? "the product",
      message: product
        ? `Deleted. "${product.title}" now shows ${Number(product.rating)} from ${
            product.rating_count
          } review${product.rating_count === 1 ? "" : "s"}.`
        : "Deleted.",
    };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    console.error("deleteReview failed", err);
    return { ok: false, message: "That could not be saved. Try again." };
  } finally {
    conn.release();
  }
}
