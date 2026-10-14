"use server";

import { revalidatePath } from "next/cache";
import {
  DEFAULT_PREFERENCES,
  readPreferences,
  validatePreferences,
  writePreferences,
  type Preferences,
} from "@/lib/preferences";

export type SaveResult = {
  ok: boolean;
  message: string;
  fields?: Record<string, string>;
};

/**
 * Save settings.
 *
 * The payload is the FULL desired state, not a patch. A patch endpoint needs
 * merge semantics — what does a checkbox mean when the request says nothing
 * about it — and getting that wrong silently resets settings the shopper never
 * touched.
 */
export async function savePreferencesAction(
  input: Preferences,
): Promise<SaveResult> {
  const current = await readPreferences();

  const candidate: Preferences = {
    recipientName: input.recipientName.trim().slice(0, 80),
    phone: input.phone.replace(/[\s-]/g, "").slice(0, 20),
    county: input.county.trim().slice(0, 60),
    town: input.town.trim().slice(0, 80),
    street: input.street.trim().slice(0, 160),
    showDeliveryEstimate: input.showDeliveryEstimate,
    compactGrid: input.compactGrid,
    confirmBeforeLeavingCart: input.confirmBeforeLeavingCart,
  };

  const errors = validatePreferences(candidate);
  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fields: errors,
    };
  }

  await writePreferences(candidate);

  // Checkout reads these at render, and the header/grid read the toggles.
  revalidatePath("/checkout");
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  revalidatePath("/cart");
  revalidatePath("/search");

  // A confirmation naming what was saved, not a generic "Saved".
  const saved = [
    candidate.county ? "delivery county" : null,
    candidate.recipientName ? "delivery name" : null,
    candidate.showDeliveryEstimate ? "delivery estimates on" : "delivery estimates off",
    candidate.compactGrid ? "compact grid on" : null,
  ].filter(Boolean);

  return {
    ok: true,
    message:
      saved.length > 0
        ? `Saved: ${saved.join(", ")}.`
        : "Settings saved. We will use your defaults at checkout.",
  };
}

/** Reset to defaults. Separate action so "reset" cannot half-apply. */
export async function resetPreferencesAction(): Promise<SaveResult> {
  await writePreferences(DEFAULT_PREFERENCES);
  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath("/checkout");
  revalidatePath("/cart");
  revalidatePath("/search");

  return { ok: true, message: "Settings reset to defaults." };
}