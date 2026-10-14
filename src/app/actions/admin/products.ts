"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin";
import { updateProduct, type ProductUpdateResult } from "@/lib/admin-products";
import { parseProductForm } from "@/lib/admin-product-rules";

/*
  Catalogue actions.

  Same shape as the order actions: requireAdminAction() is the FIRST statement,
  before an argument is read or the database touched. A guard that runs after
  the query has been issued is a log line and nothing else.

  Note what is absent: there is no delete action. `order_items.product_id` is
  `onDelete: restrict`, so a product that has ever been ordered cannot be
  removed at all — and offering a button the database will reject is worse than
  offering none. `archived` is the removal path.

  Returns ProductUpdateResult directly: `errors` carries per-field messages for
  the form, `message` carries a single sentence for a database refusal. The
  client renders whichever arrived.
*/

export async function updateProductAction(
  productId: string,
  formData: FormData,
): Promise<ProductUpdateResult> {
  await requireAdminAction();

  const input = parseProductForm(formData);
  const result = await updateProduct({ id: productId, input, actor: "admin" });

  if (result.ok) {
    // Both, because the list shows price, stock and status, and the detail page
    // shows the row itself. Revalidating only one leaves the other stale and
    // the operator unsure whether the save took.
    revalidatePath("/admin/products");
    revalidatePath(`/admin/products/${productId}`);
  }

  return result;
}
