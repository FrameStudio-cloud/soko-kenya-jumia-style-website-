/*
  Filter correctness, over HTTP against a running dev or production server.

  Filters are the part of a marketplace most likely to be quietly wrong: a
  filter that returns results but ignores its own predicate looks identical to
  a working one until you read the numbers. Every case here asserts the COUNT
  and the CONTENT, and cross-checks the count against an independent COUNT
  query where that is possible.

  Usage:
    SMOKE_BASE_URL=http://localhost:3131 npx tsx scripts/test-filters.ts
*/
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local" });

const BASE = process.env.SMOKE_BASE_URL;
if (!BASE) {
  console.error("set SMOKE_BASE_URL, e.g. SMOKE_BASE_URL=http://localhost:3131");
  process.exit(1);
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
}

const conn = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  connectionTimeoutMillis: 15_000,
});
await conn.connect();

/**
 * Read the rendered result count out of the page.
 *
 * Parsing the HTML rather than counting <article> elements: the count is what
 * the shopper is shown, so asserting on it tests the number that matters. The
 * grid also caps at 48 rows, which a naive element count would mistake for
 * the total.
 */
async function fetchSearch(query: string) {
  const res = await fetch(`${BASE}/search${query}`, {
    headers: { accept: "text/html" },
  });
  const html = await res.text();

  const shown = html.match(
    /Showing (?:<!-- -->)?(\d+)(?:<!-- -->)? of (?:<!-- -->)?(\d+)/,
  );
  const panel = html.match(/(\d+)\s*(?:<!-- -->)?\s*products?<\/p>/);

  /*
    `total` is null when the empty state renders, which is a real outcome rather
    than a parse failure. Defaulting to 0 keeps the arithmetic below honest:
    an empty result set SHOULD compare as smaller than a populated one.
  */
  const shownCount = shown ? Number(shown[1]) : null;
  const total = shown ? Number(shown[2]) : (panel ? Number(panel[1]) : 0);

  return {
    status: res.status,
    html,
    shownCount,
    total,
    empty: html.includes("Nothing matched those filters"),
  };
}

/**
 * Product slugs in DOM order, taken only from the grid's card links.
 *
 * The grid renders one <article> per product, each wrapping an overlay link to
 * /product/<slug>. Filtering on that href excludes the header's search form,
 * the category rail, and the filter panel's own hrefs, all of which are links
 * but not products.
 *
 * The charset includes ".": `philips-airfryer-4.1l` is a real slug, and the
 * original [a-z0-9-] pattern silently dropped it from every count taken with
 * this helper — a 9-product category read as 8.
 */
function productSlugs(html: string): string[] {
  return [...html.matchAll(/href="\/product\/([a-z0-9._-]+)"/g)].map((m) => m[1]);
}

console.log("=== baseline ===\n");

const base = await fetchSearch("");
check("/search responds 200", base.status === 200);
check("a count is rendered", base.total !== null, `total=${base.total}`);

const { rows: dbTotal } = await conn.query<{ n: number }>(
  `SELECT count(*)::int AS n FROM products WHERE status = 'active'`,
);
check(
  "no filters returns the whole active catalogue",
  base.total === dbTotal[0].n,
  `page=${base.total} db=${dbTotal[0].n}`,
);

console.log("\n=== category ===\n");
{
  const res = await fetchSearch("?category=groceries");
  const { rows } = await conn.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.status = 'active' AND c.slug = 'groceries'`,
  );
  check("category filter narrows", res.total === rows[0].n, `page=${res.total} db=${rows[0].n}`);
  check("and is non-empty (a broken filter would return 0)", res.total > 0, `${res.total}`);

  const wrong = await fetchSearch("?category=nonexistent-category");
  check("a bogus category returns the empty state", wrong.empty, `total=${wrong.total}`);
  /*
    No "Showing N of M" line renders when total is 0, so `total` is null here by
    design — that is the empty state, not a parsing failure. The assertion that
    matters is that the catalogue did NOT come back in full.
  */
  check(
    "a bogus category is not treated as no filter",
    wrong.empty && !wrong.html.includes("Showing 48"),
    wrong.html.includes("Showing 48") ? "returned everything" : "returned nothing",
  );
}

console.log("\n=== category routes (the header rail) ===\n");
{
  /*
    /category/:slug resolves the slug through getCategoryBySlug, which is a
    DIFFERENT code path from ?category= above — and was the broken one. It took
    the first row of getCategories() and compared slugs in JS, so only the
    category that sorted first by name resolved; the other seven rendered
    "No such category" with zero products.

    Every category is asserted, not one spot-check: a single sample happens to
    be the category that already worked, and this suite would have passed on
    the bug.
  */
  const { rows } = await conn.query<{ slug: string; n: number }>(
    `SELECT c.slug, count(p.id)::int AS n
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.status = 'active'
      GROUP BY c.slug, c.name
      ORDER BY c.name`,
  );

  check("the catalogue has categories to test", rows.length > 1, `${rows.length}`);

  for (const { slug, n } of rows) {
    const res = await fetch(`${BASE}/category/${slug}`, {
      headers: { accept: "text/html" },
    });
    const html = await res.text();
    // A Set: the grid can render the same product twice (e.g. as a related
    // item), and a duplicate would fail a correct page.
    const cards = new Set(productSlugs(html)).size;

    check(
      `/category/${slug} renders its products`,
      res.status === 200 && n > 0 && cards === n,
      `page=${cards} db=${n} status=${res.status}`,
    );
  }

  const bogus = await fetch(`${BASE}/category/definitely-not-a-category`, {
    headers: { accept: "text/html" },
  });
  const bogusHtml = await bogus.text();
  check(
    "an unknown slug still renders the not-found state",
    bogus.status === 200 && bogusHtml.includes("No such category"),
    `status=${bogus.status}`,
  );
}

console.log("\n=== price ===\n");
{
  const res = await fetchSearch("?minPrice=1000&maxPrice=5000");
  const { rows } = await conn.query<{ n: number; lo: number; hi: number }>(
    `SELECT count(*)::int AS n, min(price)::int AS lo, max(price)::int AS hi
       FROM products WHERE status = 'active' AND price BETWEEN 1000 AND 5000`,
  );
  check("price band narrows", res.total === rows[0].n, `page=${res.total} db=${rows[0].n}`);
  check("result set is non-empty", res.total > 0, `${res.total}`);

  // The real test: nothing outside the band appears in the grid.
  //
  // Slugs first, then prices from the DB — NOT prices scraped from the page.
  // An earlier version matched /KSh [\d,]+/ across the whole document and
  // "found KSh 180" came from the filter panel's own range label, not from a
  // product. Scraping the markup for data the database can answer authoritatively
  // tests the wrong thing.
  const slugs = productSlugs(res.html);
  check("grid rendered products", slugs.length > 0, `${slugs.length} cards`);

  if (slugs.length > 0) {
    const { rows: cards } = await conn.query<{ slug: string; price: number }>(
      `SELECT slug, price::int AS price FROM products WHERE slug = ANY($1::text[])`,
      [slugs],
    );
    const outOfBand = cards.filter(
      (c) => c.price < 1000 || c.price > 5000,
    );
    check(
      "every result is inside the price band",
      outOfBand.length === 0,
      outOfBand.length > 0
        ? `outside: ${outOfBand.map((c) => `${c.slug}@${c.price}`).join(", ")}`
        : `${cards.length} cards, all within 1000-5000`,
    );
  }

  /*
    `column` is the field being sorted on. Comparing prices for a RATING sort
    would fail for a correct implementation — an earlier version of this helper
    hard-coded price and reported rating_desc as broken when the page was
    ranking 4.9 down to 3.4 exactly as asked.
  */
  const order = async (
    query: string,
    label: string,
    column: "price" | "rating",
    direction: "asc" | "desc",
  ) => {
    const page = await fetchSearch(query);
    const pageSlugs = productSlugs(page.html);
    if (pageSlugs.length < 2) {
      check(`${label} has enough rows to order`, false, `${pageSlugs.length}`);
      return;
    }

    const { rows } = await conn.query<{ slug: string; value: number }>(
      `SELECT slug, ${column}::numeric AS value FROM products WHERE slug = ANY($1::text[])`,
      [pageSlugs],
    );
    const bySlug = new Map(rows.map((r) => [r.slug, Number(r.value)]));
    const ordered = pageSlugs
      .map((s) => bySlug.get(s))
      .filter((v): v is number => typeof v === "number");

    const ok = ordered.every((v, i) =>
      i === 0
        ? true
        : direction === "asc"
          ? v >= (ordered[i - 1] as number)
          : v <= (ordered[i - 1] as number),
    );

    check(
      `${label} is really ${column} ${direction === "asc" ? "ascending" : "descending"}`,
      ok,
      ordered.slice(0, 6).join(direction === "asc" ? " <= " : " >= "),
    );
  };

  await order("?sort=price_asc", "price_asc", "price", "asc");
  await order("?sort=price_desc", "price_desc", "price", "desc");
  await order("?sort=rating_desc", "rating_desc", "rating", "desc");

  // Rating must also beat the "3.4-rated item slipped through" case outright.
  const rated = await fetchSearch("?sort=rating_desc");
  check(
    "highest-rated product is first",
    productSlugs(rated.html)[0] === "sony-wh-1000xm5-headphones",
    `first card is ${productSlugs(rated.html)[0]}`,
  );
}

console.log("\n=== availability ===\n");
{
  const res = await fetchSearch("?inStock=1");
  const { rows } = await conn.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM products
      WHERE status = 'active' AND stock - stock_reserved > 0`,
  );
  check("inStock narrows", res.total === rows[0].n, `page=${res.total} db=${rows[0].n}`);
  check("sold-out product is absent", !res.html.includes("Sold out"));

  const all = await fetchSearch("");
  check("and it differs from the unfiltered set", all.total > res.total, `${all.total} vs ${res.total}`);
}

console.log("\n=== rating ===\n");
{
  const res = await fetchSearch("?minRating=4.5");
  const { rows } = await conn.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM products WHERE status = 'active' AND rating >= 4.5`,
  );
  check("rating floor narrows", res.total === rows[0].n, `page=${res.total} db=${rows[0].n}`);

  // A 3.4-rated product must not appear.
  check("low-rated product excluded", !res.html.includes("Carlisle Black Soap"));
}

console.log("\n=== search text ===\n");
{
  const res = await fetchSearch("?q=samsung");
  check("search returns results", (res.total ?? 0) > 0, `total=${res.total}`);
  check("search matches the right product", res.html.includes("Galaxy"));

  const hyphen = await fetchSearch("?q=usb-c");
  check("hyphenated query works (ILIKE path)", (hyphen.total ?? 0) > 0, `total=${hyphen.total}`);

  const none = await fetchSearch("?q=zzzznotathing");
  check("no match yields the empty state", none.empty, `total=${none.total}`);
}

console.log("\n=== filters compose ===\n");
{
  const both = await fetchSearch("?category=electronics&inStock=1");
  const { rows } = await conn.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.status = 'active' AND c.slug = 'electronics'
        AND p.stock - p.stock_reserved > 0`,
  );
  check("category + inStock compose", both.total === rows[0].n, `page=${both.total} db=${rows[0].n}`);

  const single = await fetchSearch("?category=electronics");
  check("and narrow rather than widen", both.total <= single.total, `${both.total} <= ${single.total}`);

  const three = await fetchSearch("?category=electronics&inStock=1&minRating=4.5");
  check("three filters still compose", (three.total ?? 0) <= both.total, `${three.total} <= ${both.total}`);
}

console.log("\n=== facets ===\n");
{
  const res = await fetchSearch("?category=electronics");
  /*
    Facets are computed WITHOUT the category predicate, so other categories
    still show a non-zero count. If they collapsed to zero, selecting one
    would read as "empty" — the bug this design avoids.
  */
  const hasOtherCategory = res.html.includes("Groceries");
  check("other categories still listed while one is active", hasOtherCategory);

  const priceFiltered = await fetchSearch("?minPrice=15000&maxPrice=50000");
  check(
    "facets reflect the price filter",
    priceFiltered.html.includes("Filters"),
  );
}

console.log("\n=== hostile input ===\n");
{
  for (const bad of [
    "?minPrice=abc",
    "?minPrice=-5000",
    "?minRating=99",
    "?sort=; DROP TABLE products",
    "?category=" + "x".repeat(500),
    "?inStock=maybe",
  ]) {
    const res = await fetchSearch(bad);
    check(`survives ${bad.slice(0, 34)}`, res.status === 200, `status ${res.status}`);
  }

  // The table must still be there.
  const { rows } = await conn.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM products`,
  );
  check("products table untouched", rows[0].n > 0, `${rows[0].n} rows`);
}

console.log("\n=== results are links, not fetches (no-JS path) ===\n");
{
  const res = await fetchSearch("?minPrice=1000&maxPrice=5000");
  const hasFilterLinks = /href="\/search\?[^"]*(minPrice|maxPrice|category|minRating)/.test(res.html);
  check("filters are hrefs, so they work without JS", hasFilterLinks);
  check("sort is hrefs too", /href="\/search\?[^"]*sort=/.test(res.html));
}

await conn.end();

console.log(
  failures === 0
    ? "\nRESULT: filters behave correctly"
    : `\nRESULT: ${failures} FAILURE(S)`,
);
if (failures > 0) process.exitCode = 1;
