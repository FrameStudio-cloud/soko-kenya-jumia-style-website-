"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin";
import {
  parseCategoryForm,
  type CategoryFormValues,
} from "@/lib/admin-moderation-rules";
import { updateCategory, type CategoryUpdateResult } from "@/lib/admin-categories";

/*
  Category actions.

  Same shape as the others: requireAdminAction() is the FIRST statement, before
  an argument is read or the database touched.

  The slug change is the one that needs care. `/category/[slug]` is linked from
  the header rail, the footer and every product page, and the products
  themselves carry a category slug in their own URLs' neighbourhood — so a
  rename revalidates the whole tree, not just the admin list. Doing it
  conservatively costs a little render time on an admin click and saves a
  moderator seeing a category page that still shows the old name.
*/

export async function updateCategoryAction(
  categoryId: string,
  formData: FormData,
): Promise<CategoryUpdateResult> {
  await requireAdminAction();

  const input: CategoryFormValues = parseCategoryForm(formData);
  const result = await updateCategory({ categoryId, input, actor: "admin" });

  if (result.ok) {
    revalidatePath("/admin/categories");
    revalidatePath("/", "layout");
  }

  return result;
}
