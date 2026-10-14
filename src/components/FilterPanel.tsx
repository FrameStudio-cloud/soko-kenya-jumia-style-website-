import Link from "next/link";
import type { Filters, Facet, SortOption } from "@/lib/queries";
import {
  PRICE_BANDS,
  RATING_FLOORS,
  SORT_OPTIONS,
} from "@/lib/queries";
import { formatCount, formatPrice } from "@/lib/format";

/*
  Filter sidebar.

  Every control is a plain link, not a fetch. That choice is what makes a
  filtered result set shareable, refreshable, and server-rendered — and it is
  why the whole thing works with JavaScript disabled. Progressive disclosure
  costs more code than a fetch-and-rerender would, and it buys a page that
  cannot break.

  Filters compose as query params on ONE url. Separate params per facet would
  make "clear one, keep the rest" a string-surgery problem in three places.
*/

type Props = {
  filters: Filters;
  categoryFacets: Facet[];
  sellerFacets: Facet[];
  priceBounds: { min: number; max: number };
  total: number;
};

/** Merge changes into the current params, dropping anything cleared. */
function buildUrl(
  filters: Filters,
  changes: Record<string, string | null>,
): string {
  const params = new URLSearchParams();

  const merged: Record<string, string | null> = {
    q: filters.q || null,
    category: filters.category || null,
    sellerId: filters.sellerId || null,
    minPrice: filters.minPrice !== null ? String(filters.minPrice) : null,
    maxPrice: filters.maxPrice !== null ? String(filters.maxPrice) : null,
    minRating:
      filters.minRating !== null ? String(filters.minRating) : null,
    inStock: filters.inStockOnly ? "1" : null,
    official: filters.officialOnly ? "1" : null,
    sort: filters.sort !== "relevance" ? filters.sort : null,
    ...changes,
  };

  for (const [key, value] of Object.entries(merged)) {
    if (value !== null && value !== "") params.set(key, value);
  }

  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}

/** Matches a price band to the current bounds, so the active one is known. */
function isBandActive(
  filters: Filters,
  band: { min: number | null; max: number | null },
): boolean {
  return (
    (filters.minPrice ?? null) === band.min &&
    (filters.maxPrice ?? null) === band.max
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="border-b border-hairline-2 pb-5 last:border-0">
      <legend className="mb-3 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function FilterPanel({
  filters,
  categoryFacets,
  sellerFacets,
  priceBounds,
  total,
}: Props) {
  const hasFilters =
    filters.category ||
    filters.sellerId ||
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    filters.minRating !== null ||
    filters.inStockOnly ||
    filters.officialOnly;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Filters</h2>
        {hasFilters && (
          <Link
            href={buildUrl(filters, {
              category: null,
              sellerId: null,
              minPrice: null,
              maxPrice: null,
              minRating: null,
              inStock: null,
              official: null,
            })}
            scroll={false}
            className="text-sm font-medium text-brand hover:underline"
          >
            Clear all
          </Link>
        )}
      </div>

      {/* Result count is the filter panel's heading context: a shopper needs to
          know whether the filter helped before reading what it did. */}
      <p className="text-sm text-ink-2" role="status" aria-live="polite">
        {total} {total === 1 ? "product" : "products"}
      </p>

      <Group title="Category">
        <ul className="space-y-1">
          {categoryFacets.map((facet) => {
            const active = filters.category === facet.value;
            return (
              <li key={facet.value}>
                <Link
                  href={buildUrl(filters, {
                    category: active ? null : facet.value,
                  })}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={[
                    "flex min-h-11 items-center justify-between gap-2 rounded-control px-3 text-sm",
                    active
                      ? "bg-brand-tint font-semibold text-brand"
                      : "text-ink-2 hover:bg-canvas hover:text-ink",
                  ].join(" ")}
                >
                  <span className="truncate">{facet.label}</span>
                  <span
                    className={`shrink-0 text-xs ${active ? "text-brand" : "text-ink-3"}`}
                  >
                    {facet.count}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Group>

      <Group title="Price">
        {/*
          Bands, not two number inputs. Number inputs look more precise and
          are worse to use on a phone: a phone keyboard, two boxes, and a
          shopper who has to guess whether the bound is inclusive. The bounds
          are still available in the custom range below for anyone who needs
          them.
        */}
        <ul className="space-y-1">
          {PRICE_BANDS.map((band) => {
            const active = isBandActive(filters, band);
            const href = buildUrl(filters, {
              minPrice: band.min !== null ? String(band.min) : null,
              maxPrice: band.max !== null ? String(band.max) : null,
            });

            return (
              <li key={band.label}>
                <Link
                  href={href}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={[
                    "flex min-h-11 items-center rounded-control px-3 text-sm",
                    active
                      ? "bg-brand-tint font-semibold text-brand"
                      : "text-ink-2 hover:bg-canvas hover:text-ink",
                  ].join(" ")}
                >
                  {band.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* The current range, for someone who needs finer control. */}
        <p className="mt-3 text-xs text-ink-3">
          Matching {formatPrice(priceBounds.min)} to {formatPrice(priceBounds.max)}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Link
            href={buildUrl(filters, { minPrice: null, maxPrice: String(priceBounds.min) })}
            scroll={false}
            className="flex h-11 flex-1 items-center justify-center rounded-control border border-hairline text-sm text-ink hover:bg-canvas"
          >
            Under {formatPrice(priceBounds.min)}
          </Link>
          <Link
            href={buildUrl(filters, { minPrice: String(priceBounds.max), maxPrice: null })}
            scroll={false}
            className="flex h-11 flex-1 items-center justify-center rounded-control border border-hairline text-sm text-ink hover:bg-canvas"
          >
            Over {formatPrice(priceBounds.max)}
          </Link>
        </div>
      </Group>

      <Group title="Rating">
        <ul className="space-y-1">
          {RATING_FLOORS.map((option) => {
            const active = filters.minRating === option.value;
            return (
              <li key={option.label}>
                <Link
                  href={buildUrl(filters, {
                    minRating: option.value !== null ? String(option.value) : null,
                  })}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={[
                    "flex min-h-11 items-center justify-between rounded-control px-3 text-sm",
                    active
                      ? "bg-brand-tint font-semibold text-brand"
                      : "text-ink-2 hover:bg-canvas hover:text-ink",
                  ].join(" ")}
                >
                  {option.value !== null && (
                    /*
                      The stars are decorative here; the label already says
                      "4.5 and up", so a screen reader gains nothing from
                      announcing five glyphs as well.
                    */
                    <span aria-hidden="true" className="mr-1 text-brand-fill">
                      {"★".repeat(Math.round(option.value))}
                    </span>
                  )}
                  <span className="flex-1">{option.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Group>

      <Group title="Seller">
        <ul className="space-y-1">
          {sellerFacets.slice(0, 8).map((facet) => {
            const active = filters.sellerId === facet.value;
            return (
              <li key={facet.value}>
                <Link
                  href={buildUrl(filters, { sellerId: active ? null : facet.value })}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={[
                    "flex min-h-11 items-center justify-between gap-2 rounded-control px-3 text-sm",
                    active
                      ? "bg-brand-tint font-semibold text-brand"
                      : "text-ink-2 hover:bg-canvas hover:text-ink",
                  ].join(" ")}
                >
                  <span className="truncate">{facet.label}</span>
                  <span className="shrink-0 text-xs text-ink-3">{facet.count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Group>

      <Group title="Other">
        <div className="space-y-1">
          <ToggleLink
            href={buildUrl(filters, { inStock: filters.inStockOnly ? null : "1" })}
            active={filters.inStockOnly}
            label="In stock only"
            hint="Hides sold-out and fully-held items"
          />
          <ToggleLink
            href={buildUrl(filters, { official: filters.officialOnly ? null : "1" })}
            active={filters.officialOnly}
            label="Official stores only"
            hint="Verified brand sellers"
          />
        </div>
      </Group>
    </div>
  );
}

function ToggleLink({
  href,
  active,
  label,
  hint,
}: {
  href: string;
  active: boolean;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={[
        "flex min-h-11 items-start gap-3 rounded-control px-3 py-2.5",
        active ? "bg-brand-tint" : "hover:bg-canvas",
      ].join(" ")}
    >
      {/*
        A drawn box rather than a checkbox: a real <input type=checkbox> inside
        a link is invalid and announces badly. aria-pressed on the link is the
        honest signal, and the check glyph carries it visually.
      */}
      <span
        aria-hidden="true"
        className={[
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs",
          active ? "border-brand bg-brand text-white" : "border-hairline bg-card",
        ].join(" ")}
      >
        {active ? "✓" : ""}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-sm ${active ? "font-semibold text-brand" : "text-ink"}`}
        >
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>
      </span>
    </Link>
  );
}

/** Sort control. Also links, for the same reason as the filters. */
export function SortSelect({
  filters,
  total,
}: {
  filters: Filters;
  total: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-ink-2 sm:hidden">
        {total} {total === 1 ? "result" : "results"}
      </p>

      <div className="ml-auto flex items-center gap-2">
        <label htmlFor="sort" className="text-sm text-ink-2">
          Sort by
        </label>
        {/*
          A <select> that navigates on change needs a client component. The
          form-get alternative — a select inside a GET form that submits on
          change — requires JS anyway. So this is a list of links, which works
          without JS and announces as a set of choices rather than a combobox.
        */}
        <div className="flex flex-wrap items-center gap-1">
          {SORT_OPTIONS.map((option) => {
            const active = filters.sort === option.value;
            return (
              <Link
                key={option.value}
                href={buildUrl(filters, {
                  sort: option.value === "relevance" ? null : option.value,
                })}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={[
                  "flex h-11 items-center rounded-control px-3 text-sm",
                  active
                    ? "bg-ink font-semibold text-white"
                    : "text-ink-2 hover:bg-canvas hover:text-ink",
                ].join(" ")}
              >
                {option.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Chips summarising what is currently applied, each individually removable. */
export function ActiveFilterChips({
  filters,
  categoryLabel,
  sellerLabel,
}: {
  filters: Filters;
  categoryLabel?: string;
  sellerLabel?: string;
}) {
  const chips: Array<{ label: string; href: string }> = [];

  if (filters.q) {
    chips.push({
      label: `“${filters.q}”`,
      href: buildUrl(filters, { q: null }),
    });
  }
  if (filters.category) {
    chips.push({
      label: categoryLabel ?? filters.category,
      href: buildUrl(filters, { category: null }),
    });
  }
  if (filters.sellerId) {
    chips.push({
      label: sellerLabel ?? "Seller",
      href: buildUrl(filters, { sellerId: null }),
    });
  }
  if (filters.minPrice !== null || filters.maxPrice !== null) {
    const from =
      filters.minPrice !== null ? formatPrice(filters.minPrice) : formatCount(0);
    const to = filters.maxPrice !== null ? formatPrice(filters.maxPrice) : "any";
    chips.push({
      label: `${from} – ${to}`,
      href: buildUrl(filters, { minPrice: null, maxPrice: null }),
    });
  }
  if (filters.minRating !== null) {
    chips.push({
      label: `${filters.minRating}+ stars`,
      href: buildUrl(filters, { minRating: null }),
    });
  }
  if (filters.inStockOnly) {
    chips.push({ label: "In stock", href: buildUrl(filters, { inStock: null }) });
  }
  if (filters.officialOnly) {
    chips.push({
      label: "Official stores",
      href: buildUrl(filters, { official: null }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-2">Applied:</span>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.label}>
            <Link
              href={chip.href}
              scroll={false}
              className="flex h-9 items-center gap-1.5 rounded-pill bg-brand-tint px-3 text-sm font-medium text-brand hover:bg-brand-edge"
            >
              {chip.label}
              <span aria-hidden="true">&times;</span>
              <span className="sr-only">Remove this filter</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type { SortOption };
