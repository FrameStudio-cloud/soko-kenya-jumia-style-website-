# Product imagery

Where a product picture comes from, why the database stores a key instead of a
URL, and what is on disk until real photography arrives.

Read [pages.md](./pages.md) for the route map first — this file is one layer
below it, describing the asset pipeline that every product surface shares.

## The chain

```
product_images.object_key          a KEY: "products/sony-wh-1000xm5-headphones.svg"
        │
        ├─ PRODUCT_SELECT          src/lib/queries.ts  ─▶ ProductRow.imageKey
        │   (catalogue reads)                             ProductRow.imageAlt
        │
        └─ getCartView             src/lib/cart.ts     ─▶ item.imageKey
            (cart lines)
        │
        ▼
  imageUrl(key)                    src/lib/format.ts — THE ONLY PLACE that
        │                           knows where product bytes live
        ▼
     <img src>                     ProductCard · product page · CartItemRow ·
                                   checkout summary
```

A `null` key never reaches an `<img>`. Each of the four surfaces has its own
placeholder for that case, so a product with no image row degrades to an honest
label rather than a broken-image icon.

**Two readers, not one.** Catalogue pages and the cart are different queries, so
each resolves the image independently — `PRODUCT_SELECT` for products,
`getCartView` for cart lines. They deliberately use the same LATERAL shape:

```sql
LEFT JOIN LATERAL (
  SELECT object_key, alt_text
    FROM product_images pi
   WHERE pi.product_id = p.id
   ORDER BY pi.position
   LIMIT 1
) img ON true
```

Lowest-position image, or none. Not `WHERE position = 0`: an image set is
allowed to start at 1, and pinning to 0 would show nothing for a valid row. The
`(product_id, position)` index makes the `LIMIT 1` a single index probe.

## Why a key, not a URL

`product_images.object_key` is the one column that must never hold a full URL.
The S3 endpoint is branch-scoped, so a stored URL breaks the moment a preview
branch is created — it would point at a dead endpoint and every image on that
branch would vanish.

That is also why `imageUrl()` exists as a single function rather than inline
string building in four components: when imagery moves to Neon Object Storage,
the bucket goes into that one function and the keys, the queries and every
`<img>` tag stay exactly as they are.

```ts
imageUrl("products/x.svg")        // "/products/x.svg"  — today, files in public/
imageUrl("https://…/x.webp")      // returned as-is      — absolute is honoured
imageUrl(null)                    // null                — caller falls back
```

Null in, null out, so no component is ever handed `src=""` (a browser resolves
that to the page URL and logs an error).

## What is on disk today

`public/products/` holds one 600×600 SVG per product — 48 files, generated:

```sh
npx tsx scripts/generate-product-images.ts     # also: npm run db:images
```

The script does both halves of the pipeline in one pass, because the files and
the rows pointing at them go stale together: it writes the artwork **and**
replaces the `product_images` rows it owns. It is idempotent and reports the
row count when it finishes.

**The design of a tile.** A card shows this at ~200px and a grid shows it at
96px, so each tile is full-bleed category colour with one large wordmark:

- **Mark** — the brand when there is one, the first two words of the title when
  there is not (`SONY`, `CAR AIR`, `FORTIFIED MAIZE`).
- **Caption** — always the category, so a row is consistent about where to look
  for "what kind of thing is this".
- **Colour** — one per category, so a grid reads as a grid. None of them is the
  brand orange `#c2410c`: that colour means *primary action* everywhere else in
  the UI and must not start meaning *kitchen* here.

Anything finer than that — a corner pill, the product title, a hairline frame —
turns to mush at card size and reads as a rendering fault rather than as
artwork. The product title is not repeated inside the image; the card prints it
directly underneath.

**Retired artwork.** `public/products/` also holds seven earlier hand-made SVGs
(`a15-black`, `a15-blue`, `air-max`, `anker-20000`, `cookware`, `dyson-v12`,
`jbl-flip6`). They were never wired to anything, and they were unfinished: each
printed the word *placeholder* in large type where the product should be, so
using them would have made the catalogue look more broken, not less. They also
use a different visual language (grey card, centred circle) that fights the
colour-coded tiles.

They are left on disk — not deleted, they cost nothing. The generator does not
reference them, and it lists them under `superseded files still present (safe to
delete)` on every run. Delete them once you agree they are superseded.

## Where images appear

| Surface | Component | Fallback when `imageKey` is null | Alt text |
| --- | --- | --- | --- |
| Home, search, category, related products | `ProductCard` | brand / category, grey | `imageAlt ?? title` |
| Product detail | `product/[slug]/page.tsx` | "Product image pending" + brand · category | `imageAlt ?? title` |
| Cart line | `CartItemRow` | aspect-ratio block reading "image" | `alt=""` |
| Checkout order summary | `checkout/page.tsx` | aspect-ratio block reading "img" | `alt=""` |

**Alt text on the cart and checkout is empty on purpose.** The product title is
the very next element in both rows, so a descriptive alt would announce the
product twice to a screen-reader user. On the two surfaces where the title is
*not* adjacent, alt falls back from the stored `imageAlt` to the product title —
an unlabelled image is announced as its filename, which is worse than saying
what the product is.

## Sold out

Sold-out images are **desaturated, never faded**:

```tsx
className={`… ${outOfStock ? "grayscale" : ""}`}
```

`opacity-40 grayscale` was correct when the image was grey text on white — it
just dimmed it. Against a full-bleed colour tile it drops the panel to 40% over
the white card, so the white wordmark ends up floating on nothing: the tile
reads as an empty box, which is the exact bug this pipeline replaced. The
no-image placeholder keeps the old fade, because fading grey-on-white is
harmless.

## Gaps

- **No real photography yet.** The tiles are artwork, not photos. They are a
  stand-in that makes the catalogue legible while the pipeline is proven.
- **Object Storage is not configured.** `.env.local` has an S3 endpoint,
  region and credentials, but no bucket name, and no AWS SDK is a dependency.
  Nothing can upload yet.
- **When real photos land**, the steps are: upload to the bucket, store the
  returned key in `product_images.object_key`, and point `imageUrl()` at the
  endpoint. The keys, the queries and the components do not change — and this
  script is no longer run.
