# Pages

Every page in the site, what it is for, what it links to, and what is left to
build.

- Status legend and maintenance rules: [README.md](./README.md).
- What happens when someone presses a control on these pages:
  [interactions.md](./interactions.md).

---

## 1. Built today — 19 pages + 1 route handler

| # | Route | File | What it is | Reads from |
| --- | --- | --- | --- | --- |
| 1 | `/` | `src/app/page.tsx` | Home: hero, category rail, deals, recently added. | `getCategories`, `getDeals`, `getActiveProducts` |
| 2 | `/search` | `src/app/search/page.tsx` | The catalogue. Search, filter and sort in one route. `/search` with no params is the full list, not an empty search. | `parseFilters`, `filterProducts` |
| 3 | `/category/[slug]` | `src/app/category/[slug]/page.tsx` | One category, with the same sidebar as `/search`. | `getCategoryBySlug`, `filterProducts` |
| 4 | `/product/[slug]` | `src/app/product/[slug]/page.tsx` | Product detail: price, delivery, seller, specs, related, and the one place a visitor can rate. | `getProductBySlug`, `getRelatedProducts`, `getMyRating` |
| 5 | `/cart` | `src/app/cart/page.tsx` | The cart, with per-line quantity control and an order summary. | `getCartView` |
| 6 | `/checkout` | `src/app/checkout/page.tsx` | Address and payment form. Redirects to `/cart` when empty. | `getCartView`, `quoteDelivery`, `readPreferences` |
| 7 | `/order/[reference]` | `src/app/order/[reference]/page.tsx` | Order confirmation, plus sibling orders from the same checkout. | `getOrderByReference` |
| 8 | `/settings` | `src/app/settings/page.tsx` | Device-local preferences: default address, display toggles. | `readPreferences`, `quoteDelivery` |
| 9 | `*` | `src/app/not-found.tsx` | 404. One link, back to `/`. | — |
| 10 | `/admin/login` | `src/app/admin/login/page.tsx` | Admin sign-in. The **only** admin route outside the guard — a guard here would redirect it to itself forever. | `isAdmin`, `loginAction` |
| 11 | `/admin` | `src/app/admin/(protected)/page.tsx` | Overview: order counts by status. Counts only, deliberately — an overview that renders customer detail is a screen that leaks it to anyone past a logged-in browser. | `getOrderStatusCounts` |
| 12 | `/admin/orders` | `src/app/admin/(protected)/orders/page.tsx` | Order list: status filter, pagination. | `listAdminOrders` |
| 13 | `/admin/orders/[reference]` | `src/app/admin/(protected)/orders/[reference]/page.tsx` | One order: lines, history, **masked** delivery details, status controls. | `getAdminOrderDetail` |
| 14 | `/admin/products` | `src/app/admin/(protected)/products/page.tsx` | Catalogue list: status tabs, text search, seller filter, live-hold counts. | `listAdminProducts`, `getProductStatusCounts`, `getAdminChoices` |
| 15 | `/admin/products/[id]` | `src/app/admin/(protected)/products/[id]/page.tsx` | Product editor: title, slug, price, stock, brand, category, seller, status. | `getAdminProductDetail`, `getAdminChoices` |
| 16 | `/admin/sellers` | `src/app/admin/(protected)/sellers/page.tsx` | Seller moderation: status tabs, search, verify / unverify / suspend with a required reason. Renders the reason when suspended, never a phone number. | `listAdminSellers`, `getSellerStatusCounts` |
| 17 | `/admin/reviews` | `src/app/admin/(protected)/reviews/page.tsx` | Review moderation: search, rating filter, two-click delete. Nothing masked — a review is already public content. | `listAdminReviews`, `countAdminReviews` |
| 18 | `/admin/categories` | `src/app/admin/(protected)/categories/page.tsx` | Rename and re-slug categories, each with the public URL printed beneath the slug field. | `listAdminCategories` |
| 19 | `/admin/delivery-areas` | `src/app/admin/(protected)/delivery-areas/page.tsx` | Fee, free-delivery threshold, ETA range and the on/off flag per county, with a county search. County name is read-only. | `listAdminDeliveryAreas` |
| — | `GET /cart/session` | `src/app/cart/session/route.ts` | Not a page. Mints the cart cookie, then redirects to `?next=`. | `issueCartSessionCookie` |

Routes 11–19 live in a **route group**, `src/app/admin/(protected)/`. The
parentheses are invisible in the URL, so the files are nested but the addresses
are not: `(protected)/page.tsx` serves `/admin`. Putting the guard in that
group's layout is what lets `/admin/login` sit beside it unguarded without a
path check.

Wrapping every page: `src/app/layout.tsx` — the header (search box, cart badge,
category rail), the order-result badge, and `SiteFooter`
(`src/components/SiteFooter.tsx`). The footer receives the same `categories`
the header rail already fetched, so rendering it costs no extra query.

**The admin routes are not linked from the public shell.** They are reachable
by URL and by the admin nav inside the guard; nothing on a shopper's page
points at them.

**Shell links available on every page:** brand → `/`, search form → `GET
/search?q=…`, settings → `/settings`, cart → `/cart`, category rail →
`/category/[slug]`, plus the footer's own set. All of them are listed once in
§2.

---

## 2. What each page connects to

Outbound links only. Inbound is the reverse, so it is not repeated.

### Shell — header and footer (every page)

Listed once here rather than repeated under each of the nine routes below.

**Header:** brand → `/`, search form → `GET /search?q=…`, settings → `/settings`,
cart → `/cart`, category rail → `/category/[slug]` (all 8).

The settings button sits beside the cart because settings set the default
address that pre-fills checkout — a shopper who wants to change where things
are delivered should not have to know the URL. Both icon links carry an
explicit `aria-label`: their visible labels are `hidden` under `sm`, which
takes them out of the accessibility tree, so without one an icon-only link
announces as nothing at all. The cart's label includes the item count, since
that is the one fact worth knowing before pressing.

**Footer** (`SiteFooter`, `src/components/SiteFooter.tsx`):

| Column | Links to |
| --- | --- |
| Brand | `/` |
| Shop by category | `/category/[slug]` — all 8 |
| Popular | `/search?sort=discount`, `…?sort=newest`, `…?sort=rating_desc`, `…?sort=price_asc` |
| Quick links | `/search`, `/cart`, `/settings` |

15 links, every one verified to return 200.

Two rules the footer encodes, both worth keeping:

- **Sort values are copied from `SORT_OPTIONS` in `src/lib/queries.ts`** and
  must stay in step. A typo in a sort value does **not** 404 — search silently
  falls back to best match and returns the wrong products, which is worse than
  a broken link because nothing looks wrong.
- **It links nowhere that is not built.** No `/help`, `/about`, `/legal/*` or
  `/sell`. Those are §4 rows, and each moves into the footer in the change that
  ships the page. A footer full of 404s is worse than a short honest one.

The footer carries no phase or prototype status. It used to, and so did the
home page — both described a state the app had left behind. See the
"Recently closed" note in [interactions.md](./interactions.md).

### `/admin` — the admin console (behind the guard)

Its own nav, in `src/app/admin/(protected)/layout.tsx`. It does not use the
public header's search or cart, because an operator is not shopping.

| From | Outbound links |
| --- | --- |
| Admin shell (every admin page) | `/admin` (Overview), `/admin/orders`, `/admin/products`, `/admin/sellers`, `/admin/reviews`, `/admin/categories`, `/admin/delivery-areas`, sign-out → `/admin/login` |
| `/admin` overview | `/admin/orders?status=…` — one per status, including the statuses with zero orders |
| `/admin/orders` | `/admin/orders?status=…` filter tabs, `/admin/products?…` — none; the reference → `/admin/orders/[reference]`, pagination keeps the current filter |
| `/admin/orders/[reference]` | ← `/admin/orders` |
| `/admin/products` | `/admin/products?status=…` tabs (each preserves the search text and seller), the title → `/admin/products/[id]`, pagination, "Clear" → `/admin/products` |
| `/admin/products/[id]` | ← `/admin/products`, and the live URL → `/product/[slug]` |
| `/admin/sellers` | `/admin/sellers?status=…` tabs and `?verified=…` (both preserved together), "Clear" → `/admin/sellers` |
| `/admin/reviews` | `?rating=…` and `?q=…` (GET form, so a moderator can bookmark "every 1-star review"), the product title → `/product/[slug]`, "Clear" → `/admin/reviews` |
| `/admin/categories` | "Clear"-style navigation is a form post, not a link — each row saves in place and prints its own `/category/[slug]` |
| `/admin/delivery-areas` | `?q=…` county search, "Clear" → `/admin/delivery-areas` |
| `/admin/login` | none — the form posts to `loginAction`, which redirects to `/admin` |

Two deliberate differences from the public pages:

- **No link to `/search`.** The public rule is "if it links to a filter, it
  links to `/search`". Admin filters are their own URLs because they filter the
  *admin* list, and reusing `/search` would drop the operator out of the
  console.
- **`/admin/products/[id]` shows the public `/product/[slug]` URL but only
  renders it as a link when the product is `active`.** A dead link rendered as
  a normal one generates a support call about a page that is working as
  intended.

### `/` — Home
- `CategoryRail` → `/category/[slug]` (all 8 categories)
- Each `ProductGrid` heading "See all" → `/search`
- Each product card → `/product/[slug]`
- Header → `/search`, `/cart`

### `/search` — Catalogue
- Sidebar and sort controls → `/search?<merged params>` — same route, never
  another page. This is deliberate: every filter is a plain `<a href>`, so a
  filtered URL is shareable and works with JavaScript disabled.
- Product cards → `/product/[slug]`
- Empty state → `/search` (clear), `/` (back)

### `/category/[slug]`
- Breadcrumb → `/`, `/search`
- Sidebar filters → `/search?category=<slug>&…` — **leaves the category route.**
  The category stays applied as a query param, which resolves to the same
  product set; only the URL shape changes.
- Product cards → `/product/[slug]`
- Unknown slug → in-place "No such category" panel with a link to `/search`.
  It does not 404.

### `/product/[slug]`
- Breadcrumb → `/`, `/category/[slug]`
- Related cards → `/product/[slug]` (same category, current product excluded)
- Add to cart → server action, no navigation
- Stars → `rateProductAction`, no navigation; the summary above the stars
  updates in place
- Unknown or inactive slug → `notFound()` → the 404 page

### `/cart`
- Line title → `/product/[slug]`
- Quantity and Remove → server actions, no navigation
- "Proceed to checkout" → `/checkout`
- Empty state → `/`, `/search`

### `/checkout`
- "Pre-filled from your settings" → `/settings`
- Success → `/order/<first-reference>?also=<rest>` (302 from the action)
- Empty cart → redirected to `/cart` before render
- Failure → stays on this page; the outcome is written to `localStorage` and
  shown by the badge in the shell

### `/order/[reference]`
- Item titles → `/product/[slug]`
- Sibling references → `/order/[reference]`
- "Keep shopping" → `/`, "Search more products" → `/search`
- Unknown reference → `notFound()` → the 404 page

### `/settings`
- "Your cart" → `/cart`, "Browse products" → `/search`
- Save and Reset → server actions, no navigation

### 404
- "Back to the marketplace" → `/`

---

## 3. Route rules worth knowing before adding a page

- **The category lives in the path, not the query.** `/category/groceries` is
  the shareable identity of a category. A `?category=` in the query is ignored
  there rather than merged, so a stale link cannot silently re-filter it.
- **`/search` is the filter surface.** Anything that narrows the catalogue —
  sidebar, chips, sort, clear — writes to `/search`, even when it was pressed
  on another page. Two places that build filter URLs would drift.
- **Repeated params collapse to the first value.** `?category=a&category=b`
  becomes `a`, before anything reaches SQL. A uuid comparison must never see
  `a,b`.
- **Every filter value is range-checked in `parseFilters`**, not trusted from
  the URL. `?minPrice=abc` must degrade to "no filter", not a 500.
- **Nothing is statically generated.** Each route sets `dynamic =
  "force-dynamic"` because the cart badge and settings read cookies.

---

## 4. Pages still to add — 11 planned

Count of pages this site still needs, and where each one plugs in. Ordered by
what unblocks the most.

| Priority | Route | Why it exists | Connects from | Connects to | Data readiness |
| --- | --- | --- | --- | --- | --- |
| 1 | `/seller/[slug]` | A marketplace with no seller page hides the half of the market that decides trust. `getSellerBySlug` already exists in `src/lib/queries.ts` and is **never called**. | Product page "Sold by" block, seller facet in the sidebar | `/search?sellerId=…`, `/product/[slug]` | **Ready** — query written, seller row has rating, on-time rate, verified flag |
| 2 | `/deals` | Home shows 5 deals via `getDeals(5)` and "See all" points at `/search`, which is not a deals page. | Home "Deals" grid | `/product/[slug]` | **Ready** — `getDeals(limit)` already takes a limit |
| 3 | `/order/lookup` | There are no accounts, so a reference is the only way to find an order again. Today `/order/[ref]` is reachable only from the redirect that placed it. | Footer, 404, order badge | `/order/[reference]` | **Ready** — `getOrderByReference` already takes a reference |
| 4 | `/help` | Delivery, returns, holds expiring, why there is no account. The 30-minute hold and COD rules are currently explained only in small print. | Footer, checkout footnote, cart empty state | `/`, `/legal/*` | Static |
| 5 | `/legal/terms` | Not linked anywhere yet. | Footer, checkout | `/`, `/help` | Static |
| 6 | `/legal/privacy` | Settings says settings stay on the device; that is a privacy claim with no page behind it. | Footer, `/settings` banner | `/`, `/help` | Static |
| 7 | `/legal/returns` | COD marketplace returns are the top support question. | `/help`, `/order/[reference]` | `/help` | Static |
| 8 | `/sell` | Supply side. Without it the only way a seller appears is the seed script. | Footer, 404 | `/help`, `/legal/terms` | **Needs backend** — no seller onboarding exists |
| 9 | `/account` | Sign-in. `/settings` states plainly that settings do not follow the shopper — that copy exists to make this gap obvious rather than silent. | Header, `/settings` | `/settings`, `/cart`, `/order/*` | **Needs backend** — no auth |
| 10 | `/checkout/payment` | M-Pesa. Checkout is hardcoded to `paymentMethod: "cod"`. | `/checkout` | `/order/[reference]` | **Needs backend** — payment provider not wired |
| 11 | `/wishlist` | Only if accounts land; a wishlist with no account is a second localStorage pile next to `soko_prefs`. | `/account`, product page | `/search`, `/product/[slug]` | Blocked on #9 |

Also planned, but they are generated routes rather than pages:
`app/sitemap.ts` and `app/robots.ts` for indexing, and a `favicon.ico` — the
latter is a live gap: the browser requests one on every page load and currently
gets a 404.

**Total once built: 30 routes** (19 today + 11 planned), plus 2 generated files.

---

## 5. Adding a page — checklist

1. Create the route under `src/app/`, set `export const dynamic =
   "force-dynamic"` if it reads a cookie, and give it a `metadata.title`.
2. Put all database access in `src/lib/queries.ts` (or a new
   `src/lib/<domain>.ts`). Do not import `@/db` from a page.
3. Add a row to §1 above, in the same change.
4. Add its outbound links to §2. If it links to a filter, it links to
   `/search` — do not add a second URL builder.
5. If it has controls, document them in
   [interactions.md](./interactions.md).
6. If it replaced a planned row from §4, move it up rather than deleting the
   plan: the count in §4 must always be the number of pages left to build.
