import Link from "next/link";
import { FilterPanel, SortSelect } from "@/components/FilterPanel";
import { ProductGrid } from "@/components/ProductGrid";
import { filterProducts, getCategoryBySlug, parseFilters } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  return { title: category ? `${category.name} — SokoKenya` : "Not found" };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const raw = await searchParams;

  const category = await getCategoryBySlug(slug);

  if (!category) {
    return (
      <div className="rounded-card bg-card p-10 text-center shadow-card">
        <h1 className="text-xl font-semibold">No such category</h1>
        <p className="mt-2 text-sm text-ink-2">
          That category doesn&apos;t exist. It may have been renamed.
        </p>
        <Link
          href="/search"
          className="mt-5 inline-flex h-11 items-center rounded-control bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          Browse everything
        </Link>
      </div>
    );
  }

  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }

  /*
    The category comes from the URL PATH, not from ?category=. Passing it in as
    a filter means the sidebar's category links would have to rewrite the path
    instead of setting a param — and the path is the shareable part of this
    page, so it stays the source of truth for the category.

    A ?category= in the query string is ignored rather than conflicting, so a
    stale link cannot silently filter the page to a different category.
  */
  const filters = { ...parseFilters(flat), category: slug };

  const { products, total, categoryFacets, sellerFacets, priceBounds } =
    await filterProducts(filters);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-28 lg:self-start">
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
        <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
          <Link href="/" className="hover:text-brand hover:underline">
            Home
          </Link>{" "}
          /{" "}
          <Link href="/search" className="hover:text-brand hover:underline">
            Categories
          </Link>{" "}
          / <span className="text-ink">{category.name}</span>
        </nav>

        <div className="rounded-card bg-card p-4 shadow-card">
          <h1 className="text-2xl font-bold">{category.name}</h1>
          <div className="mt-3">
            <SortSelect filters={filters} total={total} />
          </div>
        </div>

        <p className="text-sm text-ink-2">
          Showing {Math.min(products.length, total)} of {total}
        </p>

        <ProductGrid
          products={products}
          label={category.name}
          emptyMessage={`Nothing in ${category.name} matches these filters.`}
        />
      </div>
    </div>
  );
}
