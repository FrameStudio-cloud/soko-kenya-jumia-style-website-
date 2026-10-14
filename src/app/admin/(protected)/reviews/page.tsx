import Link from "next/link";
import { countAdminReviews, listAdminReviews } from "@/lib/admin-reviews";
import { DeleteReviewButton } from "@/components/admin/DeleteReviewButton";

export const dynamic = "force-dynamic";

/*
  Review moderation.

  Nothing on this page is masked, which is worth stating plainly because every
  other admin screen in the console is. A review's body is already public on
  the product page — it is content the buyer chose to publish — and `user_id`
  is the random id handed out by the rater cookie, not anything that
  identifies a person. There is therefore no audited reveal here, and no
  reason for one.

  Deleting a review is the only destructive action in the console.
*/

function parseRating(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function buildHref(params: Record<string, string | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, String(value));
  }
  const qs = sp.toString();
  return `/admin/reviews${qs ? `?${qs}` : ""}`;
}

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; rating?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const rating = parseRating(params.rating);

  const [reviews, total] = await Promise.all([
    listAdminReviews({ q, rating }),
    countAdminReviews({ q, rating }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Reviews</h1>
        <p className="mt-1 text-sm text-ink-2">
          {total} review{total === 1 ? "" : "s"}
          {rating ? ` rated ${rating} star${rating === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="review-q" className="mb-1 block text-xs font-medium text-ink-3">
            Search
          </label>
          <input
            id="review-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Product, or text in the review"
            className="h-11 w-72 rounded-control border border-hairline bg-card px-3 text-base text-ink"
          />
        </div>
        <div>
          <label htmlFor="review-rating" className="mb-1 block text-xs font-medium text-ink-3">
            Rating
          </label>
          <select
            id="review-rating"
            name="rating"
            defaultValue={rating ? String(rating) : ""}
            className="h-11 rounded-control border border-hairline bg-card px-3 text-base text-ink"
          >
            <option value="">Any rating</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} star{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-11 rounded-control bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-2"
        >
          Apply
        </button>
        {(q || rating) && (
          <a
            href="/admin/reviews"
            className="flex h-11 items-center rounded-control px-3 text-sm font-medium text-ink-2 hover:bg-canvas"
          >
            Clear
          </a>
        )}
      </form>

      {reviews.length === 0 ? (
        <p className="rounded-card border-l-4 border-l-alert bg-alert-tint p-5 text-sm text-ink-2">
          No reviews match these filters.
        </p>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="rounded-card bg-card p-5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className="text-sm font-semibold text-ink"
                      aria-label={`${review.rating} out of 5`}
                    >
                      <span aria-hidden>{"★".repeat(review.rating)}</span>
                      <span aria-hidden className="text-hairline">
                        {"★".repeat(5 - review.rating)}
                      </span>
                      <span className="ml-2 text-ink-3">{review.rating}/5</span>
                    </span>
                    <Link
                      href={`/product/${review.productSlug}`}
                      className="truncate text-sm font-semibold hover:text-brand hover:underline"
                    >
                      {review.productTitle}
                    </Link>
                  </div>

                  {review.title && (
                    <p className="mt-2 text-sm font-semibold">{review.title}</p>
                  )}
                  {review.body && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{review.body}</p>
                  )}

                  <p className="mt-2 text-xs text-ink-3">
                    {new Date(review.createdAt).toLocaleDateString("en-KE", {
                      dateStyle: "medium",
                    })}{" "}
                    · rater {review.userId.slice(0, 8)}
                    {review.orderId ? " · verified purchase" : " · no order attached"}
                  </p>
                </div>

                <DeleteReviewButton reviewId={review.id} productTitle={review.productTitle} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
