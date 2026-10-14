import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/ProductGrid";
import {
  ActiveFilterChips,
  FilterPanel,
  SortSelect,
} from "@/components/FilterPanel";
import { filterProducts, parseFilters } from "@/lib/queries";
import { readPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Search — SokoKenya" };

/*
  Search and browse in one route.

  /search with no params is the full catalogue, not an empty search. That
  matters because the header search form posts here: a shopper pressing Enter on
  an empty box should land on a browsable list, not a page telling them to type
  something.
*/
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;

  /*
    Collapsed to a single string here. A param arriving twice (?category=a&category=b)
    arrives as an array, and forwarding that straight to parseFilters would put
    "a,b" into a uuid comparison. Taking the first value is also what the
    browser does when a shopper edits a URL by hand.
  */
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }

  const [filters, preferences] = await Promise.all([parseFilters(flat), readPreferences()]);
  const { products, total, categoryFacets, sellerFacets, priceBounds } =
    await filterProducts(filters);

  const categoryLabel = categoryFacets.find(
    (f) => f.value === filters.category,
  )?.label;
  const sellerLabel = sellerFacets.find((f) => f.value === filters.sellerId)?.label;

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/*
        Filters before results in the DOM, not after. On desktop the sidebar is
        on the left, and reading order should match visual order — otherwise a
        screen-reader user meets 48 products before learning they can be
        narrowed.
      */}
      <aside className="lg:sticky lg:top-28 lg:self-start">
        {/*
          Hidden on small screens rather than collapsed. A 48-item grid below a
          disclosure triangle is a reasonable trade for a phone, where the
          filters would otherwise push the products off the first screen
          entirely.
        */}
        <details className="rounded-card bg-card p-4 shadow-card lg:hidden">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between font-semibold">
            Filters
            <span aria-hidden="true" className="text-ink-3">
              ▾
            </span>
          </summary>
          <div className="mt-4 border-t border-hairline-2 pt-4">
            <FilterPanel
              filters={filters}
              categoryFacets={categoryFacets}
              sellerFacets={sellerFacets}
              priceBounds={priceBounds}
              total={total}
            />
          </div>
        </details>

        <div className="hidden rounded-card bg-card p-4 shadow-card lg:block">
          <FilterPanel
            filters={filters}
            categoryFacets={categoryFacets}
            sellerFacets={sellerFacets}
            priceBounds={priceBounds}
            total={total}
          />
        </div>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="rounded-card bg-card p-4 shadow-card">
          <h1 className="sr-only">
            {filters.q ? `Search results for ${filters.q}` : "Browse all products"}
          </h1>

          <SortSelect filters={filters} total={total} />

          <div className="mt-3">
            <ActiveFilterChips
              filters={filters}
              categoryLabel={categoryLabel}
              sellerLabel={sellerLabel}
            />
          </div>
        </div>

        {/*
          Showing the count in the heading when everything is filtered out. A
          "Nothing matched" card alone leaves a shopper unsure whether their
          filter was too narrow or the catalogue is empty.
        */}
        {total > 0 && (
          <p className="text-sm text-ink-2">
            Showing {Math.min(products.length, total)} of {total}
          </p>
        )}

        <ProductGrid
          products={products}
          label={filters.q ? `Results for “${filters.q}”` : "All products"}
          compact={preferences.compactGrid}
          emptyMessage={
            filters.q
              ? `Nothing matched “${filters.q}” with these filters.`
              : "No products match these filters."
          }
        />
      </div>
    </div>
  );
}
