"use server";

import { issueRaterCookie, rateProduct, readRaterId } from "@/lib/reviews";

/*
  Server action for star ratings.

  Returns typed results, never throws strings — same rule as the cart actions. A
  rejected rating should show a message in place, not replace the product page
  with an error boundary.

  No revalidatePath here, unlike the cart actions. Those revalidate because the
  header badge lives in the layout and a stale count shows on every page at
  once. A rating is shown on exactly one page, and the widget applies the new
  numbers itself the moment the action resolves. Every route is force-dynamic,
  so the next navigation re-reads the aggregate anyway.
*/

export type RateActionResult = {
  ok: boolean;
  message: string;
  rating?: number;
  ratingCount?: number;
};

export async function rateProductAction(
  productId: string,
  stars: number,
): Promise<RateActionResult> {
  /*
    Server Actions CAN set cookies, so this is where a first-time visitor's
    identity gets minted. Reading without one first would return "no_rater" to
    someone who did nothing wrong — they simply never rated before.
  */
  if (!(await readRaterId())) {
    await issueRaterCookie();
  }

  const result = await rateProduct(productId, stars);

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  return {
    ok: true,
    message: result.isFirstRating
      ? "Thanks — your rating is counted."
      : "Thanks — your rating was updated.",
    rating: result.rating,
    ratingCount: result.ratingCount,
  };
}