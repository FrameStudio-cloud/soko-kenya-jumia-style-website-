import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/ProductCard";
import { ProductRating } from "@/components/StarRatingInput";
import { getMyRating } from "@/lib/reviews";
import { AddToCartPanel } from "@/components/AddToCartPanel";
import { MAX_QUANTITY_PER_LINE } from "@/lib/cart";
import {
  getProductBySlug,
  getProductsByCategory,
  getRelatedProducts,
  searchProducts,
} from "@/lib/queries";
import {
  discountPercent,
  formatCount,
  formatPrice,
  formatRating,
  imageUrl,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Not found — SokoKenya" };

  return {
    title: `${product.title} — SokoKenya`,
    description: `${formatPrice(product.price)}, rated ${formatRating(product.rating)} by ${formatCount(product.ratingCount)} buyers. ${product.deliveryEstimate} delivery.`,
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const related = await getRelatedProducts(product.categoryId, product.id, 5);

  /*
    What THIS device has rated, which is not derivable from the aggregate.
    Skipped entirely when there is no rater cookie, so a first-time visitor pays
    for no extra query.
  */
  const myRating = await getMyRating(product.id);

  const discount = discountPercent(product.price, product.compareAtPrice);
  const available = product.available;
  const outOfStock = available <= 0;
  const lowStock = available > 0 && available <= 5;
  const total = product.price + product.deliveryFee;
  const src = imageUrl(product.imageKey);

  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href="/" className="hover:text-brand hover:underline">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={`/category/${product.categorySlug}`}
              className="hover:text-brand hover:underline"
            >
              {product.categoryName}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="truncate text-ink">{product.title}</li>
        </ol>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          {/*
            The image row carries its own alt text, written when the image was
            added. Falling back to the title rather than leaving it empty: an
            unlabelled image is announced as its filename, which is worse than
            saying what the product is.
          */}
          {/*
            Sold out is desaturated, never faded — see ProductCard for why
            opacity-40 wrecks a full-bleed tile. The class sits on the <img>
            rather than on this wrapper so the no-image placeholder can keep
            the old fade, which is fine on grey-on-white.
          */}
          <div className="aspect-square overflow-hidden rounded-card bg-card shadow-card">
            {src ? (
              <img
                src={src}
                alt={product.imageAlt ?? product.title}
                width={600}
                height={600}
                decoding="async"
                className={`h-full w-full object-cover ${outOfStock ? "grayscale" : ""}`}
              />
            ) : (
              <div
                className={`flex h-full w-full items-center justify-center ${
                  outOfStock ? "opacity-40 grayscale" : ""
                }`}
              >
                <p className="max-w-[60%] text-center text-sm text-ink-3">
                  Product image pending
                  <span className="mt-1 block text-xs">
                    {product.brand} · {product.categoryName}
                  </span>
                </p>
              </div>
            )}
          </div>

          {product.description && (
            <section aria-labelledby="about" className="mt-6 rounded-card bg-card p-6 shadow-card">
              <h2 id="about" className="text-lg font-semibold">
                About this item
              </h2>
              <p className="mt-2 text-base leading-relaxed text-ink-2">
                {product.description}
              </p>
            </section>
          )}
        </div>

        <div className="space-y-5">
          <div>
            {product.isOfficialStore && (
              <span className="mb-2 inline-flex rounded-sm bg-brand-tint px-2 py-1 text-xs font-medium text-brand">
                Official Store
              </span>
            )}
            <h1 className="text-2xl font-bold leading-tight">{product.title}</h1>
            {/*
              Summary and the control that changes it in one client component,
              so the average moves the instant a star is pressed.
            */}
            <ProductRating
              productId={product.id}
              rating={product.rating}
              ratingCount={product.ratingCount}
              myRating={myRating}
            />
          </div>

          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-4xl font-bold">{formatPrice(product.price)}</span>
              {product.compareAtPrice !== null && (
                <>
                  <span className="text-lg text-ink-3 line-through">
                    {formatPrice(product.compareAtPrice)}
                  </span>
                  {discount !== null && (
                    <span className="rounded-sm bg-sale px-2 py-0.5 text-sm font-semibold text-white">
                      Save {discount}%
                    </span>
                  )}
                </>
              )}
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-hairline-2 pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-2">
                  {product.deliveryFee === 0
                    ? "Delivery"
                    : `Delivery to ${product.sellerLocation}`}
                </dt>
                <dd
                  className={
                    product.deliveryFee === 0
                      ? "font-semibold text-discount"
                      : "font-medium"
                  }
                >
                  {product.deliveryFee === 0 ? "Free" : formatPrice(product.deliveryFee)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-2">Estimated arrival</dt>
                <dd className="font-medium">{product.deliveryEstimate}</dd>
              </div>
              <div className="flex justify-between border-t border-hairline-2 pt-1.5">
                <dt className="font-semibold">Total</dt>
                <dd className="text-lg font-bold">{formatPrice(total)}</dd>
              </div>
            </dl>
          </div>

          {outOfStock ? (
            <p className="rounded-control bg-ink-2 px-4 py-3 text-sm font-semibold text-white">
              {product.stock === 0
                ? "Sold out — check back later"
                : "Every unit is in another cart right now"}
            </p>
          ) : (
            <>
              {/*
                Quantity stepper. The + button disables at both the per-line
                limit and what is actually available, so the shopper is never
                offered a quantity the reservation will refuse — the failure
                would arrive as a message after the tap instead of as a
                control that was never enabled.
              */}
              <AddToCartPanel
                productId={product.id}
                productName={product.title}
                available={available}
                max={MAX_QUANTITY_PER_LINE}
              />
              {lowStock && (
                <p className="text-center text-sm font-medium text-alert">
                  Only {available} left in stock
                </p>
              )}
            </>
          )}

          <section aria-labelledby="seller" className="rounded-card bg-card p-5 shadow-card">
            <h2 id="seller" className="text-xs font-semibold uppercase tracking-wide text-ink-2">
              Sold by
            </h2>
            <p className="mt-1.5 font-semibold">{product.sellerName}</p>
            <p className="text-sm text-ink-2">{product.sellerLocation}</p>
            <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-hairline-2 pt-3 text-sm">
              <div>
                <dt className="text-xs text-ink-2">Rating</dt>
                <dd className="font-semibold">
                  {formatRating(product.sellerRating)}
                  <span className="sr-only"> out of 5</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-2">On time</dt>
                <dd className="font-semibold">
                  {Math.round(product.sellerOnTimeRate * 100)}%
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-2">Verified</dt>
                <dd className="font-semibold">
                  {product.isVerified ? "Yes" : "Not yet"}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      {/* Specs as a real description list, not a pile of bolded text. */}
      {Object.keys(product.specs).length > 0 && (
        <section aria-labelledby="specs" className="rounded-card bg-card p-6 shadow-card">
          <h2 id="specs" className="text-xl font-semibold">
            Specifications
          </h2>
          <dl className="mt-4 divide-y divide-hairline-2">
            {Object.entries(product.specs).map(([key, value]) => (
              <div key={key} className="grid grid-cols-2 gap-4 py-2.5 sm:grid-cols-3">
                <dt className="text-sm text-ink-2">{key}</dt>
                <dd className="text-sm font-medium sm:col-span-2">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {related.length > 0 && (
        <section aria-labelledby="related">
          <h2 id="related" className="mb-3 text-xl font-semibold">
            More in {product.categoryName}
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {related.map((item) => (
              <li key={item.id}>
                <ProductCard product={item} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
