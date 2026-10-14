/*
  Product imagery: generate the artwork, then record it in product_images.

  Two jobs, deliberately one script — generated files and the rows pointing at
  them go stale together, and a script that only did one of them would leave
  the table lying about what exists on disk.

    npx tsx scripts/generate-product-images.ts

  Idempotent. Re-running rewrites the files and replaces the rows it owns.

  ---------------------------------------------------------------------------
  Why generated artwork at all

  product_images stores an S3 object KEY, not a URL, because the endpoint is
  branch-scoped and a stored URL breaks the moment a preview branch is created.
  Nothing had ever written a row, so every card and product page rendered the
  honest "image pending" placeholder — correct, but it left the catalogue
  looking broken.

  These files stand in for real photography. They live in public/products/ and
  the keys point at them, so the whole pipeline — key -> URL -> <img> — is
  exercised end to end. When real photos land in Neon Object Storage, the keys
  change and this script is no longer run: imageUrl() in src/lib/format.ts is
  the only place that learns what a bucket URL looks like.

  ---------------------------------------------------------------------------
  On the seven older SVGs

  public/products/ also holds an earlier hand-made set — a15-black, air-max,
  cookware, dyson-v12, anker-20000, jbl-flip6, a15-blue — drawn per product
  before this script existed. They were never wired to anything, and they were
  not finished: each one printed the word "placeholder" in large type where
  the product should be, so wiring them in would have made the catalogue look
  MORE broken, not less. They also used a different visual language (grey card,
  centred circle) that fights the colour-coded tiles used by the other 42.

  They are left on disk rather than deleted — they are not mine to remove, and
  they cost nothing. The generator does not reference them; every one of the 48
  products gets a uniform, legible tile. Delete them once you agree they are
  superseded; the stale-file report below lists them by name.
*/
import { readdir, writeFile } from "node:fs/promises";
import { close, sql } from "./db";

const OUTPUT_DIR = "public/products";

/* --------------------------------------------------------------- artwork */

/*
  One colour per category, so a grid reads as a grid rather than as noise.
  Chosen to stay distinguishable at 96px, and none of them is the brand
  orange #c2410c — that colour means "primary action" everywhere else in the
  UI and must not start meaning "kitchen" here.
*/
const CATEGORY_COLOUR: Record<string, string> = {
  automotive: "#3f3f46",
  beauty: "#be185d",
  electronics: "#1d4ed8",
  fashion: "#6d28d9",
  groceries: "#15803d",
  "home-and-kitchen": "#b45309",
  "phones-and-tablets": "#0f766e",
  sports: "#7f1d1d",
};

const FALLBACK_COLOUR = "#52525b";

/** Scale an #rrggbb toward black. Used for the gradient's lower stop. */
function shade(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * factor)));
  const hex2 = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex2(channel(16))}${hex2(channel(8))}${hex2(channel(0))}`;
}

/** Escape for XML text. Titles contain apostrophes and ampersands. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Product = {
  slug: string;
  title: string;
  brand: string | null;
  categorySlug: string;
  categoryName: string;
};

/*
  A card shows this at roughly 200px, and a grid of them at 96px. So the tile
  is FULL BLEED colour with one large wordmark — anything finer than that (a
  corner pill, a product title, a hairline frame) turns to mush at card size
  and reads as a rendering fault rather than as artwork.

  The wordmark is the brand when there is one, and the first two words of the
  title when there is not: "CAR AIR" on a bottle of car freshener says more
  than an invented abbreviation would, and unbranded goods are most of this
  catalogue.

  No product title inside the image — the card prints the title directly
  underneath. Printing it twice is noise, not reinforcement.
*/
function draw(product: Product): string {
  const colour = CATEGORY_COLOUR[product.categorySlug] ?? FALLBACK_COLOUR;
  const isUnbranded = !product.brand || product.brand.toLowerCase() === "no brand";

  const mark = (
    isUnbranded ? product.title.split(" ").slice(0, 2).join(" ") : product.brand!
  ).toUpperCase();
  // Always the category. Branded tiles read BRAND / CATEGORY; unbranded ones
  // read TITLE-WORDS / CATEGORY. Either way the second line answers "what kind
  // of thing is this", and a row of tiles is consistent about where to look.
  const caption = product.categoryName.toUpperCase();

  // Fit the mark to the frame rather than truncating it.
  const fontSize = Math.min(68, 500 / (0.6 * mark.length));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${colour}"/>
      <stop offset="1" stop-color="${shade(colour, 0.72)}"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" fill="url(#g)"/>

  <text x="300" y="300" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${fontSize.toFixed(1)}" font-weight="700" letter-spacing="1" fill="#ffffff" text-anchor="middle">${esc(mark)}</text>
  <rect x="276" y="330" width="48" height="3" rx="1.5" fill="#ffffff" fill-opacity="0.45"/>
  <text x="300" y="372" font-family="ui-sans-serif, system-ui, sans-serif" font-size="17" font-weight="600" letter-spacing="3" fill="#ffffff" fill-opacity="0.8" text-anchor="middle">${esc(caption)}</text>
</svg>
`;
}

/* ------------------------------------------------------------------- main */

const products = await sql<Product>(
  `SELECT p.slug, p.title, p.brand,
          c.slug AS "categorySlug", c.name AS "categoryName"
     FROM products p JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'active'
    ORDER BY p.slug`,
);

let drawn = 0;

for (const product of products) {
  await writeFile(`${OUTPUT_DIR}/${product.slug}.svg`, draw(product), "utf8");
  drawn++;

  /*
    Scoped delete, not a blanket one: rows whose key does NOT start with
    "products/" are real object-storage keys, and re-running a placeholder
    generator must not silently delete the photography it was written to
    replace.
  */
  await sql(`DELETE FROM product_images WHERE product_id = (SELECT id FROM products WHERE slug = $1) AND object_key LIKE 'products/%'`, [product.slug]);
  await sql(
    `INSERT INTO product_images (product_id, object_key, position, alt_text)
     SELECT id, $2, 0, $3 FROM products WHERE slug = $1`,
    [product.slug, `products/${product.slug}.svg`, product.title],
  );
}

/*
  Files left over from the previous naming scheme, now superseded by the
  slug-named copies. Listed rather than deleted: an unrecognised file in a
  generated directory is worth a line of output, not a silent removal.
*/
const owned = new Set(products.map((p) => `${p.slug}.svg`));
const stale = (await readdir(OUTPUT_DIR)).filter((f) => f.endsWith(".svg") && !owned.has(f));

console.log(`images for ${products.length} products`);
console.log(`  ${drawn} generated`);
if (stale.length > 0) {
  console.log(`  superseded files still present (safe to delete): ${stale.join(", ")}`);
}

const check = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM product_images`);
console.log(`  product_images rows: ${check[0].n}`);

close();
