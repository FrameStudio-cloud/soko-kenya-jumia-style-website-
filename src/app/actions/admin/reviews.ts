"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin";
import { deleteReview, type ReviewDeleteResult } from "@/lib/admin-reviews";

/*
  Review moderation actions.

  Same shape as the others: requireAdminAction() is the FIRST statement, before
  an argument is read or the database touched.

  The delete also moves the product's stored rating, so the product page has to
  be revalidated alongside the list — otherwise a moderator deletes a one-star
  review and the product keeps showing the old average until somebody's cache
  happens to expire.
*/

export async function deleteReviewAction(reviewId: string): Promise<ReviewDeleteResult> {
  await requireAdminAction();

  const result = await deleteReview({ reviewId, actor: "admin" });

  if (result.ok) {
    revalidatePath("/admin/reviews");
    revalidatePath("/", "layout");
  }

  return result;
}
