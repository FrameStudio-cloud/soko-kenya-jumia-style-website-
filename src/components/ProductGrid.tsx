import Link from "next/link";
import { ProductCard } from "./ProductCard";
import type { ProductRow } from "@/lib/queries";

export function ProductGrid({
  products,
  label,
  emptyMessage,
  compact = false,
}: {
  products: ProductRow[];
  label: string;
  /** Overridden by the search page, which knows WHY the set is empty. */
  emptyMessage?: string;
  /**
   * Five columns instead of four on large screens, from the shopper's settings.
   *
   * The price and seller still render — a compact grid that dropped them to fit
   * more would be trading away the two things a marketplace shopper scans for.
   */
  compact?: boolean;
}) {
  if (products.length === 0) {
    return (
      /*
        Two empty states that look identical but are different failures.
        "filters matched nothing" and "the source failed" must never both
        collapse into "No products found" — the first is the shopper's problem
        to fix, the second is ours.
      */
      <div className="rounded-card bg-card p-10 text-center shadow-card">
        <h3 className="text-xl font-semibold">Nothing matched those filters</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">
          {emptyMessage ??
            "Try a wider price range, or clear a filter or two. Everything in the catalogue is still available."}
        </p>
        {/*
          Clearing filters only makes sense if there ARE filters. On a genuinely
          empty catalogue the button would lead back to the same page.
        */}
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link
            href="/search"
            className="inline-flex h-11 items-center rounded-control bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Clear all filters
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-control border border-hairline px-6 text-sm font-semibold text-ink hover:bg-brand-tint"
          >
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby={`section-${label}`}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id={`section-${label}`} className="text-xl font-semibold">
          {label}
        </h2>
        <Link
          href="/search"
          className="text-sm font-medium text-brand hover:underline"
        >
          See all
        </Link>
      </div>

      {/*
        2 cols at 360px, 3 at 640, 4 at 900, 5 at 1280. Jumia holds five
        across on desktop and drops to two on a phone; this keeps a readable
        card at every width instead of squeezing five into a narrow grid.
      */}
      <ul
        className={[
          "grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4",
          // xl:grid-cols-5 in the default case, 6 when the shopper opts in.
          compact ? "xl:grid-cols-6" : "xl:grid-cols-5",
        ].join(" ")}
      >
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}