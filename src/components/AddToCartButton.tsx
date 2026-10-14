"use client";

import { useOptimistic, useTransition } from "react";
import { addToCartAction, type CartActionResult } from "@/app/actions/cart";

/*
  Add to cart.

  Feedback lives inline, not in an alert. The HIG's rule is that feedback
  belongs in the interface: a shopper who taps add while scrolling a grid
  should see confirmation where their eye already is, not a modal that
  interrupts. role="status" announces it without stealing focus, so a screen
  reader user is told it worked without losing their place on the page.

  useOptimistic shows the new quantity immediately and reconciles when the
  action resolves — or reverts if it failed, which is why the button also
  carries a disabled state: without one, a slow network invites double-taps.
*/
export function AddToCartButton({
  productId,
  productName,
  quantity = 1,
  disabled = false,
  size = "default",
}: {
  productId: string;
  productName: string;
  /**
   * How many units this press requests. Defaults to 1 for the cards, which
   * have no stepper — but the product page's stepper sets it, and hard-coding
   * 1 here meant choosing 5 and getting 1, with the stepper silently doing
   * nothing except relabelling the button.
   */
  quantity?: number;
  disabled?: boolean;
  size?: "default" | "full";
}) {
  const [pending, startTransition] = useTransition();
  const [optimisticCount, setOptimisticCount] = useOptimistic<number, number>(
    0,
    (count, step) => count + step,
  );

  function handleClick() {
    startTransition(async () => {
      setOptimisticCount(quantity);
      const result: CartActionResult = await addToCartAction(productId, quantity);
      announce(result.message, result.ok);
    });
  }

  if (disabled) {
    return (
      <p
        className={`text-sm font-semibold text-ink-2 ${
          size === "full" ? "py-3 text-center" : ""
        }`}
      >
        Sold out
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-label={`Add ${productName} to cart`}
        className={[
          "inline-flex items-center justify-center gap-2 rounded-control bg-brand font-semibold text-white",
          "hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60",
          // 44px on the card grid, 48px on the product page. Both clear the
          // 44pt HIG touch-target floor for a control used on a phone.
          size === "full" ? "h-12 w-full text-base" : "h-11 px-4 text-sm",
        ].join(" ")}
      >
        {pending ? (
          "Adding…"
        ) : (
          <>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add to cart
          </>
        )}
      </button>

      {/*
        aria-live="polite" rather than "assertive": a confirmation should not
        interrupt whatever a screen reader is currently saying.
      */}
      <span aria-live="polite" className="sr-only">
        {optimisticCount > 0 ? "Added to cart" : ""}
      </span>
    </>
  );
}

/*
  One polite live region per page, written to by whichever control last
  acted. Two competing regions produce duplicate or interleaved announcements;
  a single shared node makes the announcement unambiguous.
*/
let region: HTMLElement | null = null;

function announce(message: string, ok: boolean) {
  if (typeof document === "undefined") return;

  if (!region) {
    region = document.getElementById("cart-announcer");
    if (!region) {
      region = document.createElement("div");
      region.id = "cart-announcer";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      region.className = "sr-only";
      document.body.appendChild(region);
    }
  }

  /*
    The failure message is prefixed with "Not added". Without a distinction,
    a screen reader announces a polite, neutral-sounding sentence for a
    failure and the user believes the item went in.
  */
  region.textContent = ok ? message : `Not added. ${message}`;
}
