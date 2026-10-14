"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { placeOrder, type CheckoutInput } from "@/lib/checkout";
import { readCartSessionId } from "@/lib/cart";
import type { OrderBadgeState } from "@/lib/order-badge";

export type CheckoutResult = {
  ok: boolean;
  message: string;
  references?: string[];
  /** Field-level errors, so the form can mark the offending input. */
  fields?: Record<string, string>;
  /**
   * What to persist as the order-result badge.
   *
   * The action RETURNS this rather than writing it. A server action cannot
   * touch localStorage — it runs on the server — and marking this module
   * "use client" to reach for it pulls src/lib/cart.ts and next/headers into
   * the browser bundle, which 500s /checkout. Persisting is the component's
   * job; deciding is the server's.
   */
  badge: OrderBadgeState;
};

/*
  Server Actions CAN set cookies, so this is the one place a first-time
  shopper's session gets minted. Reading without a session first would throw a
  500 to someone who did nothing wrong, so the cookie is issued here and the
  mutation proceeds.
*/
export async function submitCheckoutAction(
  input: CheckoutInput,
): Promise<CheckoutResult> {
  if (!(await readCartSessionId())) {
    const message = "Your cart session expired. Refresh the page and try again.";
    return {
      ok: false,
      message,
      badge: { status: "failed", message, cartIntact: true },
    };
  }

  try {
    const result = await placeOrder(input);

    if (result.ok) {
      revalidatePath("/cart");
      revalidatePath("/", "layout");
      revalidatePath("/checkout");

      const first = result.references[0];
      const rest = result.references.length - 1;

      redirect(
        `/order/${first}${rest > 0 ? `?also=${result.references.slice(1).join(",")}` : ""}`,
      );
    }

    /*
      Stock failures are reported against the cart, not against a field. The
      address the shopper typed is fine; the product is gone. Pointing at the
      wrong field sends them to fix something that was never wrong.
    */
    if (result.reason === "unavailable_item") {
      const message = `${result.message} Remove it from your cart to continue.`;
      return {
        ok: false,
        message,
        fields: { cart: result.detail ?? "" },
        badge: { status: "failed", message, cartIntact: true },
      };
    }

    if (result.reason === "unsupported_county") {
      return {
        ok: false,
        message: result.message,
        fields: { county: result.message },
        badge: { status: "failed", message: result.message, cartIntact: true },
      };
    }

    return {
      ok: false,
      message: result.message,
      badge: { status: "failed", message: result.message, cartIntact: true },
    };
  } catch (err) {
    /*
      redirect() throws a NEXT_REDIRECT control-flow error. It must not be
      caught and reported as a failure — that would turn a successful checkout
      into "something went wrong" on the confirmation page's redirect.
    */
    if (err instanceof Error && err.message === "NEXT_REDIRECT") {
      throw err;
    }

    const e = err as { message?: string };
    console.error("checkout failed", e);

    /*
      Never surface a raw DB message.

      `cartIntact` is deliberately OMITTED rather than asserted. The failure
      happened inside the transaction, so it rolled back and the cart is very
      probably fine — but "very probably" is not "verified", and claiming
      "your cart is safe" when it is not sends a shopper hunting for items
      that are gone. The badge renders no claim when the value is absent.
    */
    const message =
      "We could not place your order. Nothing was charged — please try again.";

    return { ok: false, message, badge: { status: "failed", message } };
  }
}