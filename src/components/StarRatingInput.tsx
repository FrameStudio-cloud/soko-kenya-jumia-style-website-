"use client";

import { useState, useTransition } from "react";
import { rateProductAction } from "@/app/actions/reviews";
import { formatCount, formatRating } from "@/lib/format";

const STARS = [1, 2, 3, 4, 5];

/*
  Rating summary + the one place a shopper can rate.

  Both live in a single client component so the displayed average updates the
  moment the action resolves, without a re-render or a revalidatePath. Split
  across two components the count would lag the star the shopper just pressed.

  Lives on the product page and nowhere else. A product card is wrapped in one
  overlay <a> covering the whole card, so an interactive control inside one
  would either sit beneath that link or become a nested interactive element —
  invalid HTML, and unreachable by keyboard. Cards keep the decorative stars
  they have always had; rating happens on the product itself.

  Native radio inputs, styled as stars. Arrow keys move between them, Tab enters
  the group, and a screen reader announces "4 of 5 stars" with no aria hack —
  the same argument as the checkbox in SettingsForm: where a real form control
  exists, use it instead of rebuilding it from divs.
*/
export function ProductRating({
  productId,
  rating,
  ratingCount,
  myRating,
}: {
  productId: string;
  rating: number;
  ratingCount: number;
  /** What this device already gave it, or null if it has never rated. */
  myRating: number | null;
}) {
  const [summary, setSummary] = useState({ rating, ratingCount });
  const [selected, setSelected] = useState<number | null>(myRating);
  const [hovered, setHovered] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Hovering previews the value that WOULD be set. It is not the value.
  const shown = hovered ?? selected ?? 0;

  function choose(stars: number) {
    const previous = selected;
    setSelected(stars);
    setNote(null);

    startTransition(async () => {
      const result = await rateProductAction(productId, stars);

      if (!result.ok) {
        // Snap back to what is actually stored. Leaving the optimistic star lit
        // would claim a rating the database does not hold.
        setSelected(previous);
        setNote(result.message);
        return;
      }

      if (result.rating !== undefined && result.ratingCount !== undefined) {
        setSummary({ rating: result.rating, ratingCount: result.ratingCount });
      }
    });
  }

  return (
    <div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-sm bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand">
          {formatRating(summary.rating)}
          <span className="sr-only"> out of 5 stars</span>
        </span>
        <span className="text-ink-2">{formatCount(summary.ratingCount)} ratings</span>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold text-ink">
          {selected === null ? "Rate this product" : "Your rating"}
        </legend>

        <div
          className="mt-1.5 flex items-center gap-1"
          onMouseLeave={() => setHovered(null)}
        >
          {STARS.map((n) => (
            <label
              key={n}
              onMouseEnter={() => setHovered(n)}
              className={`cursor-pointer ${pending ? "opacity-60" : ""}`}
            >
              <input
                type="radio"
                name={`rating-${productId}`}
                value={n}
                checked={selected === n}
                onChange={() => choose(n)}
                disabled={pending}
                /* sr-only, not hidden: it must stay focusable for arrow keys. */
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={`flex h-11 w-11 items-center justify-center rounded-control text-3xl transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-brand ${
                  /*
                    text-ink-3, not the text-hairline the card stars use. The card
                    stars are decorative and hidden from assistive tech, so a
                    faint empty star is only a background. Here they are the
                    tap targets — #e4e4e7 on white is 1.2:1 and reads as
                    "nothing here", while #6e6e78 is 4.72:1 and reads as a
                    control waiting to be pressed.
                  */
                  n <= shown ? "text-brand-fill" : "text-ink-3"
                }`}
              >
                ★
              </span>
              <span className="sr-only">
                {n} of 5 {n === 1 ? "star" : "stars"}
              </span>
            </label>
          ))}
        </div>

        {/* Announced without stealing focus. */}
        <p role="status" aria-live="polite" className="mt-1 min-h-5 text-sm text-ink-2">
          {note ??
            (selected === null
              ? "One rating per device — you can change it later."
              : "Tap a different star to change your rating.")}
        </p>
      </fieldset>
    </div>
  );
}