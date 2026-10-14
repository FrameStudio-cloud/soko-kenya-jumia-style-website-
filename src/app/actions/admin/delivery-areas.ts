"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin";
import {
  parseDeliveryAreaForm,
  type DeliveryAreaFormValues,
} from "@/lib/admin-moderation-rules";
import {
  updateDeliveryArea,
  type DeliveryAreaUpdateResult,
} from "@/lib/admin-delivery-areas";

/*
  Delivery area actions.

  Same shape as the others: requireAdminAction() is the FIRST statement, before
  an argument is read or the database touched.

  /checkout is revalidated because the delivery estimate and the county list
  both read this table, and an operator who has just switched a county off
  should not have to hard-refresh to see it disappear from the picker.
*/

export async function updateDeliveryAreaAction(
  deliveryAreaId: string,
  formData: FormData,
): Promise<DeliveryAreaUpdateResult> {
  await requireAdminAction();

  const input: DeliveryAreaFormValues = parseDeliveryAreaForm(formData);
  const result = await updateDeliveryArea({ deliveryAreaId, input, actor: "admin" });

  if (result.ok) {
    revalidatePath("/admin/delivery-areas");
    revalidatePath("/checkout");
  }

  return result;
}
