import type { ProductRow } from "@/lib/queries";
import {
  discountPercent,
  formatCount,
  formatPrice,
  formatRating,
  imageUrl,
} from "@/lib/format";
import { AddToCartButton } from "./AddToCartButton";

/*
  Star rating.

  A row of five glyphs is invisible to a screen reader, so each star is
  aria-hidden and the row carries a single text equivalent instead. Partial
  fills use a clipped overlay rather than an outline star — the outline form
  reads as "empty" at small sizes.
*/
function Stars({ rating }: { rating: number }) {
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));

  return (
    <span
      className="relative inline-block leading-none"
      aria-hidden="true"
      style={{ fontSize: "0.75rem", letterSpacing: "0.1em" }}
    >
      <span className="text-hairline">★★★★★</span>
      <span
        className="absolute inset-0 overflow-hidden text-brand-fill"
        style={{ width: `${pct}%` }}
      >
        ★★★★★
      </span>
    </span>
  );
}

export function ProductCard({ product }: { product: ProductRow }) {
  const discount = discountPercent(product.price, product.compareAtPrice);
  /*
    Sellable, not physical. `stock` includes units other shoppers are holding
    in their carts, so a card keyed on stock advertises quantity that cannot be
    reserved. `available` is what the reservation will actually accept.
  */
  const available = product.available;
  const outOfStock = available <= 0;
  const lowStock = available > 0 && available <= 5;
  const freeDelivery = product.deliveryFee === 0;
  const src = imageUrl(product.imageKey);

  return (
    <article className="group relative flex flex-col bg-card shadow-card transition-shadow hover:shadow-raise">
      {/*
        The whole card is clickable via one overlay link rather than a link
        wrapping everything, so the title stays a single accessible link and
        the price is not swallowed into one giant link name.
      */}
      <a
        href={`/product/${product.slug}`}
        className="absolute inset-0 z-10"
        aria-label={`${product.title}, ${formatPrice(product.price)}`}
      />

      <div className="relative aspect-square overflow-hidden bg-canvas">
        {/*
          The row stores an OBJECT KEY, so imageUrl() is what decides where the
          bytes come from — today public/, tomorrow Object Storage, without
          touching this component.

          A product with no image row keeps the brand placeholder rather than a
          broken img icon: an empty box reads as a bug, and a photo of the
          wrong product is worse than an honest gap.

          Sold out is shown by DESATURATING the image, never by fading it.
          opacity-40 was correct when the image was grey text on white, where
          it only dimmed it. Against a full-bleed colour tile it drops the
          panel to 40% over the white card, so the white wordmark ends up
          floating on nothing — which reads as a rendering fault, i.e. as the
          very bug this whole pipeline replaced. The placeholder below keeps
          the old fade because it is grey-on-white, where fading is harmless.
        */}
        {src ? (
          <img
            src={src}
            alt={product.imageAlt ?? product.title}
            width={600}
            height={600}
            loading="lazy"
            decoding="async"
            className={`h-full w-full object-cover ${outOfStock ? "grayscale" : ""}`}
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center ${
              outOfStock ? "opacity-40 grayscale" : ""
            }`}
            aria-hidden="true"
          >
            <span className="max-w-[70%] text-center text-2xs font-medium uppercase tracking-wide text-ink-3">
              {product.brand || product.categoryName}
            </span>
          </div>
        )}

        <div className="absolute left-0 top-0 flex flex-col items-start gap-1 p-2">
          {discount !== null && !outOfStock && (
            <span className="rounded-sm bg-sale px-1.5 py-0.5 text-2xs font-semibold text-white">
              -{discount}%
            </span>
          )}
          {outOfStock && (
            <span className="rounded-sm bg-ink px-1.5 py-0.5 text-2xs font-semibold text-white">
              Sold out
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {/*
          Every badge here pairs colour with a word. Colour alone would fail a
          colour-blind user and anyone on a washed-out phone screen.
        */}
        {product.isOfficialStore && (
          <span className="inline-flex w-fit items-center gap-1 rounded-sm bg-brand-tint px-1.5 py-0.5 text-2xs font-medium text-brand">
            Official Store
          </span>
        )}

        <h3 className="clamp-2 text-sm font-normal leading-snug text-ink group-hover:text-brand">
          {product.title}
        </h3>

        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-ink">
            {formatPrice(product.price)}
          </span>
          {product.compareAtPrice !== null && (
            <span className="text-xs text-ink-3 line-through">
              {formatPrice(product.compareAtPrice)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Stars rating={product.rating} />
          <span className="text-xs text-ink-2">
            <span className="sr-only">Rated </span>
            {formatRating(product.rating)}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">from </span>
            {formatCount(product.ratingCount)}
          </span>
        </div>

        <div className="mt-auto space-y-0.5 pt-1.5">
          {freeDelivery ? (
            <p className="text-xs font-semibold text-discount">Free delivery</p>
          ) : (
            <p className="text-xs text-ink-2">
              +{formatPrice(product.deliveryFee)} delivery
            </p>
          )}
          {lowStock ? (
            <p className="text-xs font-medium text-alert">
              Only {available} left
            </p>
          ) : outOfStock ? (
            /*
              Distinct from "sold out": stock may exist while every unit is
              held in someone's cart. Saying "check back later" is honest and
              actionable; a bare "Sold out" would be wrong.
            */
            <p className="text-xs text-ink-3">
              {product.stock === 0 ? "Sold out" : "All units in other carts"}
            </p>
          ) : (
            <p className="text-xs text-ink-3">{product.deliveryEstimate}</p>
          )}
        </div>

        {/*
          z-20 puts the button above the whole-card overlay link (z-10).
          Without it the button is unclickable, because the link wins the
          pointer. Sold-out cards get no button — an inert control reads as a
          bug, and "Sold out" above already says what happened.
        */}
        {!outOfStock && (
          <div className="relative z-20 mt-2 px-3 pb-3">
            <AddToCartButton productId={product.id} productName={product.title} />
          </div>
        )}
      </div>
    </article>
  );
}
