"use server";

import { revalidatePath } from "next/cache";
import {
  addToCart,
  issueCartSessionCookie,
  readCartSessionId,
  removeFromCart,
  setCartItemQuantity,
  MAX_QUANTITY_PER_LINE,
} from "@/lib/cart";

/*
  Server actions for the cart.

  Every action revalidates both /cart and /: the header badge is rendered in
  the layout, so a stale count is visible on every page at once.

  Return values are typed results, never thrown strings. An action that throws
  produces an error boundary over the whole page; a shopper whose cart is full
  should see a message in place, not lose the page they were on.
*/

export type CartActionResult = {
  ok: boolean;
  message: string;
  quantity?: number;
  available?: number;
};

/*
  Why each failure says something different.

  "Sold out" and "no longer available" are different facts. Telling a shopper
  an item is sold out when the seller delisted it sends them hunting for a
  discount that does not exist; telling them it is sold out when their hold
  lapsed is merely accurate and useless. Each branch names the real cause.
*/
export async function addToCartAction(
  productId: string,
  quantity = 1,
): Promise<CartActionResult> {
  /*
    Server Actions CAN set cookies, so this is the one place a first-time
    shopper's session gets minted. Reading without a session first would throw
    a 500 to someone who did nothing wrong, so the cookie is issued here and
    the mutation proceeds.
  */
  if (!(await readCartSessionId())) {
    await issueCartSessionCookie();
  }

  const result = await addToCart(productId, quantity);

  if (result.ok) {
    revalidatePath("/cart");
    revalidatePath("/", "layout");
    return {
      ok: true,
      message:
        result.quantity > 1
          ? `${result.quantity} in your cart`
          : "Added to your cart",
      quantity: result.quantity,
    };
  }

  switch (result.reason) {
    case "not_found":
      return { ok: false, message: "That product is no longer listed." };
    case "sold_out":
      return { ok: false, message: "Sold out. We will not take your order for it." };
    case "quantity_limit":
      return {
        ok: false,
        message: `You can order at most ${MAX_QUANTITY_PER_LINE} of one item.`,
        available: result.available,
      };
    case "insufficient_stock":
      return {
        ok: false,
        message:
          result.available > 0
            ? `Only ${result.available} left. Someone else may have got there first.`
            : "Sold out. We will not take your order for it.",
        available: result.available,
      };
  }
}

export async function setQuantityAction(
  productId: string,
  quantity: number,
): Promise<CartActionResult> {
  if (!(await readCartSessionId())) {
    return { ok: false, message: "Your cart session expired. Reload the page." };
  }

  const result = await setCartItemQuantity(productId, quantity);

  if (result.ok) {
    revalidatePath("/cart");
    revalidatePath("/", "layout");
    return { ok: true, message: "Cart updated", quantity: result.quantity };
  }

  return {
    ok: false,
    message:
      result.reason === "insufficient_stock"
        ? `Only ${result.available} left. Lower the quantity to continue.`
        : "That item is no longer in your cart.",
    available: result.available,
  };
}

export async function removeItemAction(
  productId: string,
): Promise<CartActionResult> {
  if (!(await readCartSessionId())) {
    return { ok: false, message: "Your cart session expired. Reload the page." };
  }

  await removeFromCart(productId);
  revalidatePath("/cart");
  revalidatePath("/", "layout");
  return { ok: true, message: "Removed from your cart" };
}
