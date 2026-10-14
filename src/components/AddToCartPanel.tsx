"use client";

import { useState } from "react";
import { AddToCartButton } from "./AddToCartButton";

/*
  Quantity stepper plus the add button.

  A client component because it holds quantity state, and it lives in its own
  file for that reason: a `useState` inside a page file makes the whole page
  client-rendered, which would pull the database queries across the boundary
  and break server rendering of the product.

  The + control disables at the ceiling instead of erroring when tapped, so the
  limit is visible before the shopper commits to it. The ceiling is the lower of
  the per-line cap and real availability — clamping to availability matters
  because another shopper can take a hold between page load and tap, and a
  button offering 5 when 2 exist just produces an error message.
*/
export function AddToCartPanel({
  productId,
  productName,
  available,
  max,
}: {
  productId: string;
  productName: string;
  available: number;
  max: number;
}) {
  const [quantity, setQuantity] = useState(1);
  const ceiling = Math.min(max, Math.max(1, available));

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-3">
        <div className="flex items-center rounded-control border border-hairline bg-card">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
            className="h-12 w-12 rounded-l-control text-lg font-semibold text-ink hover:bg-brand-tint disabled:opacity-40"
          >
            &minus;
          </button>

          {/*
            aria-live="polite" so the new total is announced. The number is not
            focusable, so without this the change is silent to anyone not
            using sight.
          */}
          <output
            aria-live="polite"
            className="flex h-12 min-w-12 items-center justify-center text-base font-semibold"
          >
            {quantity}
          </output>

          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(ceiling, q + 1))}
            disabled={quantity >= ceiling}
            aria-label="Increase quantity"
            className="h-12 w-12 rounded-r-control text-lg font-semibold text-ink hover:bg-brand-tint disabled:opacity-40"
          >
            +
          </button>
        </div>

        <AddToCartButton
          productId={productId}
          productName={`${quantity} × ${productName}`}
          quantity={quantity}
          size="full"
        />
      </div>

      {available > 0 && available <= 5 && (
        <p className="text-center text-sm text-ink-2">
          {available} available right now
        </p>
      )}
    </div>
  );
}
