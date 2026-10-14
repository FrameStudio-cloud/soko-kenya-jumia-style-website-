"use client";

import { useEffect, useState } from "react";
import {
  clearLastOrder,
  readLastOrder,
  type OrderBadgeState,
} from "@/lib/order-badge";

/*
  Order result badge.

  Two facts this has to get right:

  1. "Sent" vs "Failed" must be a persistent, visible state, not a flash. A
     shopper who clicks Place order and looks away needs to be able to come back
     and still see what happened — a toast that vanishes in four seconds answers
     a question they may not have asked yet.

  2. Failure must never be quiet. A silent retry after a failed order is how a
     shopper ends up with two orders and no idea why.

  Read from localStorage rather than passed as a prop, because the failure case
  never navigates: there is no confirmation page to render the badge on.
*/
export function OrderResultBadge() {
  const [state, setState] = useState<OrderBadgeState | null>(null);

  useEffect(() => {
    setState(readLastOrder());
  }, []);

  if (!state) return null;

  const sent = state.status === "sent";

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "rounded-card border-l-4 p-4 shadow-card",
        sent ? "border-l-discount bg-discount-tint" : "border-l-sale bg-sale-tint",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        {/*
          A glyph, not just a colour. Colour alone fails anyone with a colour
          vision deficiency, and this is exactly where "green means good, red
          means bad" is doing real work.
        */}
        <span
          aria-hidden="true"
          className={[
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-pill text-sm font-bold text-white",
            sent ? "bg-discount" : "bg-sale",
          ].join(" ")}
        >
          {sent ? "✓" : "!"}
        </span>

        <div className="min-w-0 flex-1">
          {/*
            "Order sent" rather than "Success". A shopper's order has not
            arrived; it has been sent to a seller. Precise language here avoids
            a support call later.
          */}
          <p className="font-semibold text-ink">
            {sent ? "Order sent" : "Order not sent"}
          </p>

          <p className="mt-0.5 text-sm text-ink-2">
            {sent ? (
              <>
                We sent order{" "}
                <span className="font-mono font-medium text-ink">
                  {state.reference}
                </span>{" "}
                to the seller. Keep the reference for any questions.
              </>
            ) : (
              state.message
            )}
          </p>

          {state.cartIntact === true && (
            <p className="mt-1 text-sm text-ink-2">
              Your cart has not changed — you can try again.
            </p>
          )}
          {state.cartIntact === false && (
            <p className="mt-1 text-sm font-medium text-alert">
              Your cart was emptied. Start a new one before ordering again.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {sent && state.reference && (
              <a
                href={`/order/${state.reference}`}
                className="inline-flex h-9 items-center rounded-control bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-2"
              >
                View order
              </a>
            )}
            {!sent && (
              <a
                href="/cart"
                className="inline-flex h-9 items-center rounded-control bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-2"
              >
                Back to cart
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                clearLastOrder();
                setState(null);
              }}
              className="inline-flex h-9 items-center rounded-control border border-hairline bg-card px-4 text-sm font-medium text-ink hover:bg-canvas"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export type { OrderBadgeState };