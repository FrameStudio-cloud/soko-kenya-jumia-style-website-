"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  removeItemAction,
  setQuantityAction,
} from "@/app/actions/cart";
import { formatPrice, imageUrl } from "@/lib/format";

/*
  One cart line.

  The quantity control is optimistic: it moves immediately and reverts if the
  action fails. That is the right trade for a stepper — waiting on a network
  round trip to increment a number makes the whole cart feel broken.

  Optimistic state is therefore paired with a visible pending state. Optimism
  without one is worse than none: a shopper taps + three times during a slow
  request and cannot tell whether it worked.
*/
export function CartItemRow({
  item,
  maxQuantity,
}: {
  item: {
    productId: string;
    slug: string;
    title: string;
    quantity: number;
    unitPrice: number;
    addedPrice: number;
    priceChanged: boolean;
    lineTotal: number;
    available: number;
    /** Object key, or null when the product has no image. */
    imageKey: string | null;
    sellerName: string;
  };
  maxQuantity: number;
}) {
  const [pending, startTransition] = useTransition();
  const [optimisticQty, setOptimisticQty] = useOptimistic(
    item.quantity,
    (current: number, next: number) => next,
  );

  /*
    Ceiling is the lower of the per-line cap and what is reservable. Allowing
    more than `available` produces an error on tap; the shopper already knows
    the limit from the "only N left" line, so the control should respect it.
  */
  const ceiling = Math.min(maxQuantity, Math.max(1, item.available));
  const src = imageUrl(item.imageKey);

  function change(next: number) {
    startTransition(async () => {
      setOptimisticQty(next);
      const result = await setQuantityAction(item.productId, next);
      if (!result.ok) {
        // Force the optimistic value back to the server's truth.
        setOptimisticQty(item.quantity);
        announce(result.message);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeItemAction(item.productId);
      if (!result.ok) announce(result.message);
    });
  }

  const quantity = optimisticQty;
  const lineTotal = item.unitPrice * quantity;

  return (
    <li className="flex gap-4 border-b border-hairline-2 py-4 last:border-0">
      {/*
        Alt is empty on purpose: the product title is the very next element in
        this row, so a descriptive alt would announce the product twice.

        A line with no image keeps the aspect-ratio block — an empty box reads
        better than a broken image icon.
      */}
      {src ? (
        <img
          src={src}
          alt=""
          width={96}
          height={96}
          loading="lazy"
          decoding="async"
          className="h-24 w-24 shrink-0 rounded-control bg-canvas object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-24 w-24 shrink-0 items-center justify-center rounded-control bg-canvas"
        >
          <span className="text-2xs uppercase tracking-wide text-ink-3">image</span>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-2">{item.sellerName}</p>

        <a
          href={`/product/${item.slug}`}
          className="mt-0.5 block text-sm font-medium hover:text-brand hover:underline"
        >
          {item.title}
        </a>

        {/*
          Price movement is stated, not implied. The shopper is charged the
          current price; showing the old one struck through makes that explicit
          instead of letting them discover it at checkout.
        */}
        {item.priceChanged ? (
          <p className="mt-1 text-xs text-alert">
            Price changed to {formatPrice(item.unitPrice)}
            <span className="text-ink-3 line-through">
              {" "}
              {formatPrice(item.addedPrice)}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-sm">{formatPrice(item.unitPrice)} each</p>
        )}

        {item.available < item.quantity && (
          <p className="mt-1 text-xs font-medium text-alert">
            Only {item.available} still available — lower the quantity to keep
            this
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-control border border-hairline bg-card">
            <button
              type="button"
              onClick={() => change(Math.max(1, quantity - 1))}
              disabled={pending || quantity <= 1}
              aria-label={`Decrease quantity of ${item.title}`}
              className="h-10 w-10 rounded-l-control font-semibold text-ink hover:bg-brand-tint disabled:opacity-40"
            >
              &minus;
            </button>
            <output
              aria-live="polite"
              className="flex h-10 min-w-10 items-center justify-center text-sm font-semibold"
            >
              {quantity}
            </output>
            <button
              type="button"
              onClick={() => change(Math.min(ceiling, quantity + 1))}
              disabled={pending || quantity >= ceiling}
              aria-label={`Increase quantity of ${item.title}`}
              className="h-10 w-10 rounded-r-control font-semibold text-ink hover:bg-brand-tint disabled:opacity-40"
            >
              +
            </button>
          </div>

          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="text-sm font-medium text-ink-2 underline underline-offset-2 hover:text-sale disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-base font-bold">{formatPrice(lineTotal)}</p>
        {quantity > 1 && (
          <p className="mt-0.5 text-xs text-ink-3">
            {quantity} &times; {formatPrice(item.unitPrice)}
          </p>
        )}
      </div>
    </li>
  );
}

let region: HTMLElement | null = null;

function announce(message: string) {
  if (typeof document === "undefined") return;
  if (!region) {
    region = document.createElement("div");
    region.id = "cart-line-announcer";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.className = "sr-only";
    document.body.appendChild(region);
  }
  region.textContent = message;
}
