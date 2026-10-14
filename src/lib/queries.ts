import { and, desc, eq, ilike, sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { products, sellers } from "@/db/schema";
import type { SpecMap } from "@/lib/types";

/*
  Data access. Every read the UI does goes through here, so the UI never
  imports the database and can be reasoned about on its own.

  Two styles, deliberately. Straightforward reads use the query builder;
  anything involving ts_rank, aggregates, or GROUP BY is written as raw SQL,
  because wrapping those in builder fragments produces something longer and
  harder to read than the query it generates.
*/

const num = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);

export type ProductRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  price: number;
  /** null when never discounted, so no strike-through renders on a real price. */
  compareAtPrice: number | null;
  stock: number;
  /** Units held by other shoppers' carts right now. */
  stockReserved: number;
  /** stock - stockReserved. Never promise more than this. */
  available: number;
  brand: string;
  rating: number;
  ratingCount: number;
  deliveryFee: number;
  deliveryEstimate: string;
  specs: SpecMap;
  tags: string[];
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  sellerId: string;
  sellerName: string;
  sellerLocation: string;
  sellerRating: number;
  sellerRatingCount: number;
  sellerOnTimeRate: number;
  isOfficialStore: boolean;
  isVerified: boolean;
  /**
   * Object key of the lowest-position image, or null when there is none.
   *
   * A KEY, not a URL — the endpoint is branch-scoped and a stored URL breaks
   * the moment a preview branch is created. Pass it through imageUrl() to get
   * something an <img> can use.
   */
  imageKey: string | null;
  /** Alt text stored on the image row. Callers fall back to the title. */
  imageAlt: string | null;
};

function toRow(row: Record<string, unknown>): ProductRow {
  const etaDays = num(row.delivery_estimate_days);
  const stock = num(row.stock);
  const reserved = num(row.stock_reserved);

  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: String(row.description ?? ""),
    price: num(row.price),
    compareAtPrice:
      row.compare_at_price === null || row.compare_at_price === undefined
        ? null
        : num(row.compare_at_price),
    stock,
    stockReserved: reserved,
    available: stock - reserved,
    brand: String(row.brand ?? ""),
    rating: num(row.rating),
    ratingCount: num(row.rating_count),
    deliveryFee: num(row.delivery_fee),
    deliveryEstimate: etaDays <= 1 ? "Tomorrow" : `${etaDays} days`,
    specs: (row.specs ?? {}) as SpecMap,
    tags: (row.tags ?? []) as string[],
    categoryId: String(row.category_id),
    categorySlug: String(row.category_slug ?? ""),
    categoryName: String(row.category_name ?? ""),
    sellerId: String(row.seller_id),
    sellerName: String(row.seller_name ?? ""),
    sellerLocation: String(row.seller_location ?? ""),
    sellerRating: num(row.seller_rating),
    sellerRatingCount: num(row.seller_rating_count),
    sellerOnTimeRate: num(row.seller_on_time_rate),
    isOfficialStore: Boolean(row.is_official_store),
    isVerified: Boolean(row.is_verified),
    // null, not "": a missing LEFT JOIN row must never become a src of "".
    imageKey:
      row.image_key === null || row.image_key === undefined
        ? null
        : String(row.image_key),
    imageAlt:
      row.image_alt === null || row.image_alt === undefined
        ? null
        : String(row.image_alt),
  };
}

/*
  Image comes in as the lowest-position row, or absent.

  LATERAL rather than a join on `position = 0`: an image set is allowed to
  start at 1, and a join pinned to 0 would render no picture for a perfectly
  valid row. The (product_id, position) index makes the LIMIT 1 a single index
  probe, so this costs nothing measurable on a 48-row page.
*/
const PRODUCT_SELECT = dsql`
  SELECT p.id, p.slug, p.title, p.description, p.price, p.compare_at_price,
         p.stock, p.stock_reserved, p.brand, p.rating, p.rating_count,
         p.delivery_fee, p.delivery_estimate_days, p.specs, p.tags,
         p.category_id, p.seller_id,
         s.name AS seller_name, s.location AS seller_location,
         s.rating AS seller_rating, s.rating_count AS seller_rating_count,
         s.on_time_rate AS seller_on_time_rate,
         s.is_official_store, s.is_verified,
         c.slug AS category_slug, c.name AS category_name,
         img.object_key AS image_key, img.alt_text AS image_alt
  FROM products p
  /*
    Suspension is a fact about the seller, so it lives in the join rather than
    in each query's WHERE.

    It has to reach every read path at once — home page, deals rail, search, a
    category, related products, and a direct link to a bookmarked product URL.
    Putting it in the one fragment every product query selects means the next
    query is correct for free; scattering it across seven WHERE clauses means
    the eighth is written by somebody who has not read the other seven.

    The count and facet queries inside filterProducts build their own joins, so
    they repeat this — see basePredicates.
  */
  JOIN sellers s ON s.id = p.seller_id AND s.status = 'active'
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN LATERAL (
    SELECT object_key, alt_text
      FROM product_images pi
     WHERE pi.product_id = p.id
     ORDER BY pi.position
     LIMIT 1
  ) img ON true
`;

async function runProductQuery(
  fragment: ReturnType<typeof dsql>,
): Promise<ProductRow[]> {
  const result = await db.execute<Record<string, unknown>>(fragment);
  const rows = result.rows as unknown as Record<string, unknown> | Record<string, unknown>[];
  return (Array.isArray(rows) ? rows : [rows]).map(toRow);
}

/* ========================================================================== */
/* Filters                                                                     */
/* ========================================================================== */

/*
  Filter state is parsed from the URL, not held in component state.

  Two reasons, one of which matters commercially: a filtered result set is
  shareable and survives a refresh, so a link sent to a friend opens the same
  list. The other is that a filter with no URL representation cannot be
  server-rendered, which forces the catalogue to become a client fetch and
  costs a loading state on every page that has one.
*/

export type SortOption =
  | "relevance"
  | "newest"
  | "price_asc"
  | "price_desc"
  | "rating_desc"
  | "discount";

export const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "relevance", label: "Best match" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating_desc", label: "Highest rated" },
  { value: "discount", label: "Biggest discount" },
  { value: "newest", label: "Newest first" },
];

export type Filters = {
  q: string;
  category: string;
  sellerId: string;
  minPrice: number | null;
  maxPrice: number | null;
  minRating: number | null;
  inStockOnly: boolean;
  officialOnly: boolean;
  sort: SortOption;
};

/**
 * Parse and sanitise filter params.
 *
 * Every numeric value is range-checked rather than trusted. A filter that
 * forwards `?minPrice=-5000` straight into SQL is not a crash, but
 * `?minPrice=abc` becomes NaN, which Postgres rejects with a type error that
 * surfaces to the shopper as a 500. An unhandled query param is untrusted
 * input.
 */
export function parseFilters(params: Record<string, string | undefined>): Filters {
  const rawNumber = (key: string, min: number, max: number): number | null => {
    const raw = params[key];
    if (raw === undefined || raw.trim() === "") return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    if (value < min || value > max) return null;
    return value;
  };

  const sortParam = params.sort;
  const sort: SortOption =
    sortParam && SORT_OPTIONS.some((o) => o.value === sortParam)
      ? (sortParam as SortOption)
      : "relevance";

  return {
    q: (params.q ?? "").trim().slice(0, 120),
    category: (params.category ?? "").trim().slice(0, 60),
    sellerId: (params.sellerId ?? "").trim().slice(0, 60),
    minPrice: rawNumber("minPrice", 0, 100_000_000),
    maxPrice: rawNumber("maxPrice", 0, 100_000_000),
    minRating: rawNumber("minRating", 0, 5),
    inStockOnly: params.inStock === "1",
    officialOnly: params.official === "1",
    sort,
  };
}

/** Price bands for the filter UI. Predefined, so they need no validation. */
export const PRICE_BANDS: Array<{ label: string; min: number | null; max: number | null }> = [
  { label: "Any price", min: null, max: null },
  { label: "Under KSh 1,000", min: null, max: 1000 },
  { label: "KSh 1,000 – 5,000", min: 1000, max: 5000 },
  { label: "KSh 5,000 – 15,000", min: 5000, max: 15000 },
  { label: "KSh 15,000 – 50,000", min: 15000, max: 50000 },
  { label: "Over KSh 50,000", min: 50000, max: null },
];

export const RATING_FLOORS = [
  { label: "Any rating", value: null },
  { label: "4.5 and up", value: 4.5 },
  { label: "4.0 and up", value: 4 },
  { label: "3.5 and up", value: 3.5 },
];

export type Facet = { value: string; label: string; count: number };

export type FilterResult = {
  products: ProductRow[];
  total: number;
  /** Counts for each category under the OTHER filters, so the sidebar shows
   *  what selecting a category would actually yield rather than zeros. */
  categoryFacets: Facet[];
  sellerFacets: Facet[];
  /** The full price range in the current result set, for the price inputs. */
  priceBounds: { min: number; max: number };
  appliedCount: number;
};

/**
 * Apply filters, and return facet counts alongside the rows.
 *
 * The facets are computed with the category filter EXCLUDED, so the category
 * list still shows how many results each one would give. Including it means
 * selecting a category collapses every other category to zero, which reads as
 * "these categories are empty" rather than "you have filtered to one".
 *
 * Each facet query repeats the other predicates rather than fetching
 * everything and counting in JS: that would load the whole catalogue to
 * produce a dozen numbers.
 */
export async function filterProducts(
  filters: Filters,
  limit = 48,
): Promise<FilterResult> {
  const {
    q,
    category,
    sellerId,
    minPrice,
    maxPrice,
    minRating,
    inStockOnly,
    officialOnly,
    sort,
  } = filters;

  /* ------------------------------------------------------------ predicates */

  // Shared predicates: everything except the one being faceted.
  const basePredicates = [
    dsql`p.status = 'active'`,
    /*
      Repeats the condition PRODUCT_SELECT already carries, because these
      queries (the total count, both facets, the price bounds) build their own
      joins and never see that fragment. Without it the header would say "48
      products" while the list showed 41, which is worse than no number at all.
    */
    dsql`s.status = 'active'`,
    ...(sellerId ? [dsql`p.seller_id = ${sellerId}::uuid`] : []),
    ...(minPrice !== null ? [dsql`p.price >= ${minPrice}`] : []),
    ...(maxPrice !== null ? [dsql`p.price <= ${maxPrice}`] : []),
    ...(minRating !== null ? [dsql`p.rating >= ${minRating}`] : []),
    ...(inStockOnly ? [dsql`p.stock - p.stock_reserved > 0`] : []),
    ...(officialOnly ? [dsql`s.is_official_store = true`] : []),
  ];

  // Category is applied on top of the base, and omitted from the facets.
  const withCategory = category
    ? [...basePredicates, dsql`c.slug = ${category}`]
    : basePredicates;

  /* -------------------------------------------------------------- search */

  /*
    The same FTS-OR-substring match as searchProducts, because a shopper who
    searches AND filters expects both to narrow the same set. Two separate
    implementations of the same rule would drift.
  */
  const needle = q;
  const pattern = `%${needle.replace(/([\\%_])/g, "\\$1")}%`;

  const searchPredicates = needle
    ? [
        dsql`(
          p.search_vector @@ websearch_to_tsquery('english', ${needle})
          OR p.title ILIKE ${pattern}
          OR p.brand ILIKE ${pattern}
          OR lower(${needle}) = ANY(p.tags)
        )`,
      ]
    : [];

  /* ------------------------------------------------------------ ordering */

  /*
    `relevance` only means something with a search term. Without one there is
    nothing to rank against, so it degrades to newest — which is also the
    better default for a catalogue page.
  */
  const orderBy = (() => {
    switch (sort) {
      case "price_asc":
        return dsql`ORDER BY p.price ASC, p.rating DESC`;
      case "price_desc":
        return dsql`ORDER BY p.price DESC, p.rating DESC`;
      case "rating_desc":
        return dsql`ORDER BY p.rating DESC, p.rating_count DESC`;
      case "discount":
        /*
          Only discounted items can have a discount, so a non-discounted one
          sorting here would need a NULL guard. Sorting by the saving amount
          also beats sorting by percentage: a KSh 400 off KSh 90,000 is a worse
          deal for the shopper than KSh 400 off KSh 900.
        */
        return dsql`ORDER BY (p.compare_at_price - p.price) DESC NULLS LAST, p.rating DESC`;
      case "newest":
        return dsql`ORDER BY p.created_at DESC`;
      case "relevance":
      default:
        return needle
          ? dsql`ORDER BY
              CASE WHEN p.search_vector @@ websearch_to_tsquery('english', ${needle})
                   THEN 0 ELSE 1 END,
              ts_rank(p.search_vector, websearch_to_tsquery('english', ${needle})) DESC,
              p.rating DESC`
          : dsql`ORDER BY p.created_at DESC`;
    }
  })();

  /* --------------------------------------------------------------- query */

  const predicates = [...withCategory, ...searchPredicates];

  const countResult = await db.execute<{ total: number }>(dsql`
    SELECT count(*)::int AS total
      FROM products p
      JOIN sellers s ON s.id = p.seller_id
      JOIN categories c ON c.id = p.category_id
     WHERE ${and(...predicates)}
  `);

  const productsResult = await runProductQuery(dsql`
    ${PRODUCT_SELECT}
     WHERE ${and(...predicates)}
     ${orderBy}
     LIMIT ${limit}
  `);

  /* -------------------------------------------------------------- facets */

  const categoryFacetResult = await db.execute<{
    slug: string;
    name: string;
    n: number;
  }>(dsql`
    SELECT c.slug, c.name, count(p.id)::int AS n
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      JOIN sellers s ON s.id = p.seller_id
     WHERE ${and(
       ...basePredicates,
       ...searchPredicates,
       dsql`p.status = 'active'`,
     )}
     GROUP BY c.slug, c.name
     HAVING count(p.id) > 0
     ORDER BY count(p.id) DESC, c.name
  `);

  const sellerFacetResult = await db.execute<{
    id: string;
    name: string;
    n: number;
  }>(dsql`
    SELECT s.id, s.name, count(p.id)::int AS n
      FROM sellers s
      LEFT JOIN products p ON p.seller_id = s.id
      JOIN categories c ON c.id = p.category_id
     WHERE ${and(
       ...basePredicates.filter((pred) => !String(pred).includes("seller_id")),
       ...searchPredicates,
       dsql`p.status = 'active'`,
     )}
     GROUP BY s.id, s.name
     HAVING count(p.id) > 0
     ORDER BY count(p.id) DESC, s.name
  `);

  /*
    Price bounds over the CURRENT result set, not the catalogue. They drive
    the min/max inputs, and a max of 90,000 when the shopper is looking at
    soap is a confusing place to start typing.
  */
  const boundsResult = await db.execute<{ lo: number | null; hi: number | null }>(dsql`
    SELECT min(p.price)::int AS lo, max(p.price)::int AS hi
      FROM products p
      JOIN sellers s ON s.id = p.seller_id
      JOIN categories c ON c.id = p.category_id
     WHERE ${and(...predicates)}
  `);

  const appliedCount =
    (category ? 1 : 0) +
    (sellerId ? 1 : 0) +
    (minPrice !== null || maxPrice !== null ? 1 : 0) +
    (minRating !== null ? 1 : 0) +
    (inStockOnly ? 1 : 0) +
    (officialOnly ? 1 : 0);

  return {
    products: productsResult,
    total: Number(countResult.rows[0]?.total ?? 0),
    categoryFacets: categoryFacetResult.rows.map((r) => ({
      value: r.slug,
      label: r.name,
      count: Number(r.n),
    })),
    sellerFacets: sellerFacetResult.rows.map((r) => ({
      value: r.id,
      label: r.name,
      count: Number(r.n),
    })),
    priceBounds: {
      min: boundsResult.rows[0]?.lo ?? 0,
      max: boundsResult.rows[0]?.hi ?? 100_000,
    },
    appliedCount,
  };
}

/** Latest active products. The home page feed. */
export async function getActiveProducts(limit = 24): Promise<ProductRow[]> {
  return runProductQuery(dsql`
    ${PRODUCT_SELECT}
    WHERE p.status = 'active'
    ORDER BY p.created_at DESC
    LIMIT ${limit}
  `);
}

/** Genuinely discounted only. The compareAt > price CHECK guarantees the filter. */
export async function getDeals(limit = 5): Promise<ProductRow[]> {
  const rows = await runProductQuery(dsql`
    ${PRODUCT_SELECT}
    WHERE p.status = 'active'
      AND p.compare_at_price IS NOT NULL
    ORDER BY (p.compare_at_price - p.price) DESC NULLS LAST
    LIMIT ${limit * 3}
  `);

  return rows
    .filter((p) => p.compareAtPrice !== null && p.compareAtPrice > p.price)
    .slice(0, limit);
}

export async function getProductBySlug(slug: string): Promise<ProductRow | null> {
  const rows = await runProductQuery(dsql`
    ${PRODUCT_SELECT}
    WHERE p.slug = ${slug} AND p.status = 'active'
    LIMIT 1
  `);
  return rows[0] ?? null;
}

/**
 * Full-text search over the generated tsvector, ranked by ts_rank.
 *
 * FTS OR substring: FTS handles prose and stemming, ILIKE plus exact tag
 * equality handle what FTS structurally cannot. `websearch_to_tsquery('usb-c')`
 * parses as a PHRASE query, so a hyphenated model number only matches when
 * those words are literally adjacent in the title — and tags like "usb-c" can
 * never equal a stemmed query at all.
 *
 * An empty term short-circuits: websearch_to_tsquery('') yields an empty query
 * matching nothing, so the naive version returns zero results for an empty box.
 */
export async function searchProducts(term: string, limit = 48): Promise<ProductRow[]> {
  return filterProducts(parseFilters({ q: term }), limit).then((r) => r.products);
}

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  productCount: number;
};

/*
  Counts come from a GROUP BY in Postgres, not from summing an array in JS.
  The old fixture derived them client-side, which cannot be right once a
  category holds more products than one page can hold.
*/
export async function getCategories(): Promise<CategoryRow[]> {
  const result = await db.execute<{
    id: string;
    slug: string;
    name: string;
    product_count: number;
  }>(dsql`
    SELECT c.id, c.slug, c.name, count(p.id)::int AS product_count
    FROM categories c
    /*
      The count has to match what a shopper can actually reach, so it repeats
      the seller condition PRODUCT_SELECT carries. A category whose only
      products belong to a suspended seller shows 0 rather than a number the
      list behind it cannot deliver.
    */
    LEFT JOIN products p
      ON p.category_id = c.id
     AND p.status = 'active'
     AND EXISTS (SELECT 1 FROM sellers s
                  WHERE s.id = p.seller_id AND s.status = 'active')
    GROUP BY c.id, c.slug, c.name
    ORDER BY c.name
  `);

  return result.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    productCount: Number(r.product_count),
  }));
}

/**
 * One category by slug, with its own active-product count.
 *
 * Looks the slug up in SQL rather than taking the first row of getCategories()
 * and comparing slugs in JS — that version resolved only whichever category
 * sorted first by name and returned null for the other seven, so every link in
 * the header rail landed on "No such category". The WHERE clause is the whole
 * point of this function; it cannot be delegated to the caller.
 *
 * The count is computed the same way getCategories computes it (active rows
 * only), so a category's count is identical on the rail and on its own page.
 */
export async function getCategoryBySlug(slug: string): Promise<CategoryRow | null> {
  const result = await db.execute<{
    id: string;
    slug: string;
    name: string;
    product_count: number;
  }>(dsql`
    SELECT c.id, c.slug, c.name, count(p.id)::int AS product_count
      FROM categories c
      /* Same seller condition as getCategories, for the same reason. */
      LEFT JOIN products p
        ON p.category_id = c.id
       AND p.status = 'active'
       AND EXISTS (SELECT 1 FROM sellers s
                    WHERE s.id = p.seller_id AND s.status = 'active')
     WHERE c.slug = ${slug}
     GROUP BY c.id, c.slug, c.name
  `);

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    productCount: Number(row.product_count),
  };
}

export async function getProductsByCategory(categorySlug: string): Promise<ProductRow[]> {
  return runProductQuery(dsql`
    ${PRODUCT_SELECT}
    WHERE c.slug = ${categorySlug} AND p.status = 'active'
    ORDER BY p.created_at DESC
  `);
}

export async function getRelatedProducts(
  categoryId: string,
  excludeProductId: string,
  limit = 5,
): Promise<ProductRow[]> {
  return runProductQuery(dsql`
    ${PRODUCT_SELECT}
    WHERE p.category_id = ${categoryId}
      AND p.id <> ${excludeProductId}
      AND p.status = 'active'
    ORDER BY p.rating DESC
    LIMIT ${limit}
  `);
}

export async function getSellerBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(sellers)
    .where(eq(sellers.slug, slug))
    .limit(1);
  return row ?? null;
}

export { desc, eq, ilike, and };
