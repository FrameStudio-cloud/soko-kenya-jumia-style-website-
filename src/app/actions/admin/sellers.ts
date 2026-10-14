"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin";
import {
  setSellerVerified,
  suspendSeller,
  unsuspendSeller,
  type SellerWriteResult,
} from "@/lib/admin-sellers";

/*
  Seller moderation actions.

  Same shape as the order and catalogue actions: requireAdminAction() is the
  FIRST statement, before an argument is read or the database touched. A guard
  that runs after the query has been issued is a log line and nothing else.

  Suspending does not touch the products. It moves one column on the seller,
  and the catalogue filters do the rest — which is what makes reinstatement a
  single step with nothing to reverse by hand.
*/

export async function verifySellerAction(sellerId: string): Promise<SellerWriteResult> {
  await requireAdminAction();

  const result = await setSellerVerified({ sellerId, verified: true, actor: "admin" });
  if (result.ok) revalidatePath("/admin/sellers");
  return result;
}

export async function unverifySellerAction(sellerId: string): Promise<SellerWriteResult> {
  await requireAdminAction();

  const result = await setSellerVerified({ sellerId, verified: false, actor: "admin" });
  if (result.ok) revalidatePath("/admin/sellers");
  return result;
}

export async function suspendSellerAction(
  sellerId: string,
  reason: string,
): Promise<SellerWriteResult> {
  await requireAdminAction();

  const result = await suspendSeller({ sellerId, reason, actor: "admin" });
  if (result.ok) {
    /*
      Three, because suspension changes what the whole site can sell. The
      product list is filtered on the seller, so a suspended seller's products
      vanish from it; the category counts and the header rail depend on
      /admin/categories, which reads the same condition; and the catalogue
      pages themselves would otherwise keep showing a seller that has gone.
    */
    revalidatePath("/admin/sellers");
    revalidatePath("/admin/categories");
    revalidatePath("/", "layout");
  }
  return result;
}

export async function unsuspendSellerAction(sellerId: string): Promise<SellerWriteResult> {
  await requireAdminAction();

  const result = await unsuspendSeller({ sellerId, actor: "admin" });
  if (result.ok) {
    revalidatePath("/admin/sellers");
    revalidatePath("/admin/categories");
    revalidatePath("/", "layout");
  }
  return result;
}
