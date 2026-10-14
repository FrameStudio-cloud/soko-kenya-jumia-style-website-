# Interactions

When you press this, what happens.

Each entry gives the same three things: the control, the chain it triggers, and
what the shopper sees. The chain is the useful part — it is what to read when a
control misbehaves, and what to update when one changes.

- Which page the control lives on: [pages.md](./pages.md).
- Status legend and maintenance rules: [README.md](./README.md).

**Chain notation:** `component → server action → lib function → SQL → visible
result`. A control with no server action navigates with `<a href>` instead, and
says so.

---

## 1. Global shell — every page

| Press | Chain | You see |
| --- | --- | --- |
| Brand "SokoKenya" | `<Link href="/">` | Home |
| Search box, Enter | `GET /search?q=…` (plain form) | `/search` filtered by `q`. Empty box also works — `/search` with no params is the full catalogue, not an empty state. |
| Search button | same as Enter | same |
| Cart icon/link | `<Link href="/cart">` | Cart. Badge shows item count from `getCartCount()`; hidden at 0. |
| Category in the rail | `<Link href="/category/[slug]">` | That category's products |
| "Skip to main content" | fragment `#main` | Focus moves past the header |

The header search form and the cart badge are the only shell elements that
depend on data: `layout.tsx` fetches categories (for the rail) and the cart
count on every request.

---

## 2. Browsing and filtering — `/search`, `/category/[slug]`

**Every control in this section is a link, not a fetch.** No JavaScript, no
component state, no client round trip. `FilterPanel.buildUrl()` merges the
change into the current query string and returns `/search?…`.

| Press | Chain | You see |
| --- | --- | --- |
| A category in the sidebar | `<Link>` → `/search?category=<slug>&<rest>` → `parseFilters` → `filterProducts` | Grid narrows; its row is highlighted; its count is the number it just produced |
| Click the active category again | `<Link>` with `category: null` | Filter removed, others kept |
| A price band | `<Link>` → `minPrice`/`maxPrice` | Grid narrows to the band |
| "Under KSh X" / "Over KSh Y" | `<Link>` → one bound set, the other cleared | Grid narrows to one side of the current range |
| A rating floor | `<Link>` → `minRating` | Grid narrows to `rating >= n` |
| A seller | `<Link>` → `sellerId=<uuid>` | Grid narrows to that seller |
| "In stock only" | `<Link>` → `inStock=1` | `stock - stock_reserved > 0` only; held units disappear |
| "Official stores only" | `<Link>` → `official=1` | Official-store products only |
| A sort option | `<Link>` → `sort=<value>` | Order changes. `relevance` without a search term degrades to newest |
| A chip's × | `<Link>` to that param set to null | That one filter drops, the rest survive |
| "Clear all" | `<Link>` dropping every param except `q` | Back to the search term alone |
| "Filters" disclosure (phone) | native `<details>` | Panel expands. Desktop always shows it |

**Facet counts** are computed *without* the category predicate, so selecting a
category does not collapse every other category to 0 — the sidebar shows what
clicking each option would give, not what the current filter left behind.

**Sorting is links, not a `<select>`**, because a select that navigates needs a
client component. As links they announce as a set of choices and work with
JavaScript off.

---

## 3. Product page — `/product/[slug]`

| Press | Chain | You see |
| --- | --- | --- |
| − / + on the stepper | `useState` in `AddToCartPanel`. Client only, no server call. | Quantity changes. `+` disables at `min(10, available)`; − disables at 1. |
| Add to cart | `AddToCartButton` → `addToCartAction(productId, quantity)` → `addToCart()` | Button reads "Adding…", then the shell badge increments and a polite live region announces the result. **No navigation.** |
| Add to cart on a card | same action, `quantity` defaults to 1 | same |
| Card overlay click | `<a href="/product/[slug]">` covering the card, under the button (`z-10` vs `z-20`) | Product page |
| A star | `ProductRating` → `rateProductAction(productId, stars)` → `rateProduct()` | Star fills at once. When the action resolves, the average and count update in place. Second tap on a different star **replaces** the vote, it does not add one. |

### What `rateProduct` does

1. Rejects anything that is not an integer 1–5. The number arrives from a
   browser, so it is checked, not trusted.
2. Reads the `soko_rater` cookie, minting it in the action if absent — a render
   may not set cookies, and a first-time rater has none.
3. `BEGIN` → `SELECT … FOR UPDATE` on the product. This both rejects an
   unknown or inactive product and **serialises concurrent raters**: without
   the lock, two simultaneous votes can each rebuild the average from a set that
   does not contain the other's row.
4. Upserts on the unique `(user_id, product_id)` index, so re-rating is an
   `UPDATE` and `rating_count` cannot double-count.
5. **Rebuilds** `products.rating` / `rating_count` from the review rows rather
   than incrementing them — an increment needs the previous sum and count, which
   are not stored, so it is wrong from the first write.
6. `COMMIT`.

Two consequences worth stating:

- **The seeded aggregates are fiction.** Products ship with averages like 4.8
  from 2.2k ratings that no review row backs. The first real vote on such a
  product replaces them with the true average and a count of 1. Correct, but
  surprising on a product that looked busy — seed real review rows if that
  matters.
- **A device is not a person.** Clearing cookies yields a new rater id and
  therefore a second vote. The database unique index is the real guard; the
  cookie only makes re-rating an update. When accounts land, key on the account
  and drop the cookie.

**Cards stay read-only.** A product card is wrapped in one overlay `<a>`
covering the whole card, so an interactive control inside it would either sit
beneath that link or become a nested interactive element. Rating happens on the
product page only.

### What `addToCart` does

1. Mints the `soko_cart` cookie if this shopper has none — a server action may
   set cookies, a page render may not.
2. `BEGIN` → `RESERVE_SQL` increments `products.stock_reserved` only where
   `stock - stock_reserved >= wanted`.
3. Upserts `cart_items`, incrementing an existing line rather than replacing it.
4. Pushes the hold's `expires_at` to now + 30 minutes — an active shopper keeps
   their units, an abandoned one lapses.
5. `COMMIT`, then returns the **new total line quantity**, not the increment.

### Failure messages, and why each is different

| Reason | Message | Why not one generic error |
| --- | --- | --- |
| `not_found` | "That product is no longer listed." | The seller delisted it. Sending them hunting for a discount that does not exist is worse than saying so. |
| `sold_out` | "Sold out. We will not take your order for it." | Distinct from below: `stock` is genuinely 0. |
| `quantity_limit` | "You can order at most 10 of one item." | A policy limit, not a stock limit. |
| `insufficient_stock` | "Only N left. Someone else may have got there first." | Another shopper took the hold between page load and tap. |

All four return `{ ok: false, message }`. Nothing throws — a thrown server
action opens an error boundary over the whole page.

---

## 4. Cart — `/cart`

| Press | Chain | You see |
| --- | --- | --- |
| Line − / + | `CartItemRow` → `setQuantityAction` → `setCartItemQuantity()` | Optimistic: the number moves immediately and reverts if the action fails. Disabled while pending. |
| Remove | `CartItemRow` → `removeItemAction` → `removeFromCart()` | Line disappears; badge decrements |
| Line title | `<a href="/product/[slug]">` | Product page |
| Proceed to checkout | `<Link href="/checkout">` | Checkout |
| Empty cart: "Browse products" / "Search instead" | `<Link>` | `/` or `/search` |

Quantity and Remove revalidate **both** `/cart` and the layout: the badge is
rendered in `layout.tsx`, so leaving it stale would show the wrong count on
every page at once.

The line ceiling is `min(10, item.available)`. Offering a quantity the
reservation would refuse just converts a control into an error message.

---

## 5. Checkout — `/checkout`

| Press | Chain | You see |
| --- | --- | --- |
| Change county | `useState` in `CheckoutForm` | Delivery fee shown in the option text |
| Place order | `CheckoutForm` → `submitCheckoutAction(input)` → `placeOrder()` | On success: redirect to `/order/<ref>`. On failure: stays put, inline `role="alert"` above the form, badge written to `localStorage`. |
| Empty cart on arrival | `redirect("/cart")` in the page | Never renders a dead form |

### `placeOrder` — one transaction, all sellers

Cart with items from three sellers produces three orders. All or nothing: if
the second fails, the first must not stay placed, because the shopper paid once.

```
BEGIN
  SELECT id FROM carts WHERE session_id = $1 AND status='active' FOR UPDATE
    ← the lock is what stops a double-submit racing: the second blocks here,
      finds the cart already converted, and returns the existing orders
  read cart lines + current holds (released_at IS NULL)
  if any hold < quantity        → ROLLBACK, "your hold on X expired"
  read delivery_areas for county → missing ⇒ ROLLBACK, "we don't deliver to X"
  group lines by seller
  for each line:  UPDATE products SET stock = stock - q, stock_reserved = stock_reserved - q
                  WHERE stock >= q AND stock_reserved >= q
                  ← row count 0 ⇒ ROLLBACK, sold out mid-checkout
  for each seller:
      delivery fee = 0 if seller subtotal >= county free-delivery threshold, else base fee
      INSERT orders          (reference SK…, status 'confirmed', payment 'cod'/'unpaid')
      INSERT order_items     (title_snapshot + unit_price frozen at this moment)
      UPDATE stock_reservations SET cart_id = NULL, order_id = …   ← holds move, not re-taken
      INSERT order_status_history ('confirmed', 'checkout', 'Order placed')
  UPDATE carts SET status = 'converted'
  DELETE FROM cart_items WHERE cart_id = $1
COMMIT
```

`stock` is decremented **here and only here**. That is precisely why the cart
could hold stock without owning it.

**Failure reasons:** `no_session`, `empty_cart`, `unavailable_item` (reported
against the cart, not a field — the address was fine, the product is gone),
`unsupported_county` (reported against the county field), input validation
(field-level), and anything else → generic "We could not place your order.
Nothing was charged." with `cartIntact` **omitted rather than claimed**, because
a rollback makes it probable, not verified.

---

## 6. Order badge — shell, all pages

Rendered in `layout.tsx`, above every page body, because a failed checkout never
navigates: there is no confirmation page to put it on.

Reads `localStorage.soko_last_order`. Client-only by necessity — a server action
cannot touch `localStorage`, and marking that module `"use client"` pulls
`next/headers` into the browser bundle.

| Press | Chain | You see |
| --- | --- | --- |
| View order | `<a href="/order/[ref]">` | Confirmation page |
| Back to cart | `<a href="/cart">` | Cart |
| Dismiss | `clearLastOrder()` + `setState(null)` | Badge gone, permanently |

Success writes the badge **from the client after the action returns** — but on
success the action redirects first, so the write only ever runs for failures,
which is exactly when it is needed.

---

## 7. Settings — `/settings`

| Press | Chain | You see |
| --- | --- | --- |
| Save settings | `SettingsForm` → `savePreferencesAction` → validate → `writePreferences()` (cookie) | Message naming what was saved: "Saved: delivery county, compact grid on." |
| Reset to defaults | `SettingsForm` → `resetPreferencesAction` → `writePreferences(DEFAULT_PREFERENCES)` | Form re-keys (`key={JSON.stringify(preferences)}`) so the reset is visible |

Reset is `type="button"` with its own action, **not** a native reset: a native
reset restores the DOM but never tells the server, so the cookie would restore
the old values on the next render and the button would appear to do nothing.

Both actions revalidate `/checkout`, `/settings`, `/cart`, `/search` and the
layout — checkout pre-fills from these values at render time.

---

## 8. Admin console — `/admin`

Not reachable from any public page. Everything below happens behind
`requireAdmin()` on the page **and** `requireAdminAction()` inside the action —
see [admin.md](./admin.md) for the auth model.

| Page | Control | What happens when it is pressed |
| --- | --- | --- |
| `/admin/login` | Password → Sign in | `loginAction`. Compared with `timingSafeEqual`. Success sets the `soko_admin` cookie and redirects to `/admin`; failure returns one message that never says whether the account is locked out. |
| Admin shell | Sign out | `logoutAction`. Clears the cookie, redirects to `/admin/login`. |
| `/admin` | Status tile | Link to `/admin/orders?status=…`. Counts only — this screen renders no order content. |
| `/admin/orders` | Filter tab, pagination | Links. Invalid or missing status values quietly show *all* orders rather than 400. |
| `/admin/orders/[reference]` | Mark dispatched / delivered / … | `updateOrderStatusAction`. Enforces the transition map in SQL inside a `FOR UPDATE` transaction, then writes `order_status_history`. |
| `/admin/orders/[reference]` | Cancel and return stock | `cancelOrderAction`. Requires a written reason; increments `products.stock` back, marks the order's holds released, writes history. Only reachable from `pending_payment` or `confirmed`. |
| `/admin/orders/[reference]` | Reveal full details | `revealDeliveryAction`. Writes the `admin_audit_log` row **before** returning the address, so there is no path that hands over PII without recording it. |
| `/admin/orders/[reference]` | Hide | Local component state only. A reload puts the mask back — deliberately, because a page left open on a monitor is how this data reaches the wrong person. |
| `/admin/products` | Status tabs | Links. Each preserves the current search text and seller. |
| `/admin/products` | Search + seller → Apply | A plain `GET` form, so it works with JavaScript off and produces a shareable URL. |
| `/admin/products/[id]` | Save changes | `updateProductAction`. Validation runs **inside** the transaction after a `FOR UPDATE` lock — see below. |
| `/admin/sellers` | Status tabs, search, verification → Apply | Plain `GET` forms. The status tabs are links that carry the search and verification values with them, and vice versa. |
| `/admin/sellers` | Verify / Remove verification | `verifySellerAction` / `unverifySellerAction`. Driven by `useTransition`, not a form action: a row offers four different actions and `useActionState` binds one action to one form. Result lands in `role="status"`. |
| `/admin/sellers` | Suspend… → Confirm suspension | The summary opens a `<details>` holding a required reason, so it works with JavaScript off. An empty reason comes back as `role="alert"` and writes nothing; a real one sets `status`, `suspended_at` and `suspension_reason`, then revalidates the sellers list, the category counts and the whole layout. |
| `/admin/sellers` | Unsuspend | `unsuspendSellerAction`. Clears `suspended_at` **and** `suspension_reason` alongside the status. |
| `/admin/reviews` | Rating filter, search → Apply | Plain `GET` form, so "every 1-star review" is a bookmarkable URL. |
| `/admin/reviews` | Delete… → "Yes, delete it" | `deleteReviewAction`, two clicks. The confirm states the effect rather than asking "are you sure?". The delete and the product's rating recompute happen in one transaction. Cancel is the escape hatch, since the action itself is irreversible. |
| `/admin/categories` | Save | `updateCategoryAction`. `useActionState` over a form with controlled inputs, so a rejected save keeps what was typed. The success message changes when the slug moved and says the old links will stop working. |
| `/admin/delivery-areas` | Save | `updateDeliveryAreaAction`. Same shape. The message changes when the active flag moved, because switching a county off refuses orders already addressed there. |
| Any admin page | Nav links | Overview, Orders, Products, Sellers, Reviews, Categories, Delivery, Sign out. |

### Why the product edit validates inside the transaction

`products.stock_reserved` is maintained by every other shopper's cart. The form
was rendered seconds ago, so validating against the value the operator *saw*
and writing later leaves a gap precisely where it matters: three units could
have been added to someone's basket while the price was being typed.

`updateProduct()` therefore locks the row, reads `stock_reserved` again, and
validates against that. The messages that come back are written in
`admin-product-rules.ts`, not taken from the CHECK constraint — a constraint
named `products_reserved_not_over_stock` is true and useless, where
"7 units are held in live carts. You cannot drop stock below 7" is actionable.

The form keeps what was typed on a failure and confirms on a success.
`ProductEditForm` holds its values in state and re-syncs from `initialUpdatedAt`
only when the server has revalidated — so a rejected save leaves the input
alone, while an accepted one adopts the stored rows *and* keeps the "Saved."
message. It was previously keyed on `updatedAt`, which looked equivalent but
reset `useActionState` and left a successful save with no confirmation at all.


### Why the moderation screens use two different feedback patterns

The console has both patterns in it, deliberately, and the split is by shape
rather than by taste:

- **Form-bound edits** — categories, delivery areas — use `useActionState` over
  a real `<form>`. One form, one action, per-field errors bound to the inputs
  that caused them, and it still submits with JavaScript off. Their values are
  controlled but never keyed, so the "Saved." message survives the revalidation
  that proves it — the same lesson `ProductEditForm` learned the hard way.
- **Row action buttons** — verify, unverify, suspend, unsuspend — use
  `useTransition`. A single row offers four actions, and `useActionState` binds
  one action to one form; four forms per row would be four sources of truth for
  one message. The cost is that these buttons need JavaScript, which the console
  already assumes everywhere else it mutates something.

Suspension's reason box is a `<details>` containing its own textarea and
confirm button, because the disclosure is the one part of that flow worth
having without JavaScript — an empty reason is refused by the rules module
before any write, so the failure arrives as `role="alert"` with the list
untouched.

One timing note for anyone testing this: the feedback renders when the action
**resolves**, not when the button is pressed. In development a first invocation
of an action can take several seconds while the module compiles, which is long
enough to conclude that nothing happened. It has not failed until the message
says so.

### Where state lives

| Store | Name | Written by | Read by | Lifetime |
| --- | --- | --- | --- | --- |
| Cookie | `soko_cart` | `addToCartAction`, `GET /cart/session` | every cart mutation, `getCartCount`, `getCartView` | session |
| Cookie | `soko_prefs` | `savePreferencesAction`, `resetPreferencesAction` | `/checkout`, `/settings`, `/search` (compact grid) | until cleared |
| localStorage | `soko_last_order` | `CheckoutForm` (client) | `OrderResultBadge` | until dismissed |
| DB | `stock_reservations` | `addToCart`, `setCartItemQuantity`, `placeOrder` | availability everywhere | 30 min hold, then logically expired |

### Server actions

| Action | File | Guard | Revalidates |
| --- | --- | --- | --- |
| `addToCartAction` | `app/actions/cart.ts` | mints cookie if absent | `/cart`, layout |
| `setQuantityAction` | `app/actions/cart.ts` | requires session | `/cart`, layout |
| `removeItemAction` | `app/actions/cart.ts` | requires session | `/cart`, layout |
| `submitCheckoutAction` | `app/actions/checkout.ts` | requires session | `/cart`, `/checkout`, layout |
| `savePreferencesAction` | `app/actions/settings.ts` | validation | 5 paths |
| `resetPreferencesAction` | `app/actions/settings.ts` | none | 5 paths |
| `rateProductAction` | `app/actions/reviews.ts` | integer 1–5, active product | none |
| `loginAction` | `app/actions/admin/auth.ts` | lockout counter, then password | — (redirects) |
| `logoutAction` | `app/actions/admin/auth.ts` | session | — (redirects) |
| `updateOrderStatusAction` | `app/actions/admin/orders.ts` | `requireAdminAction()` | `/admin/orders` |
| `cancelOrderAction` | `app/actions/admin/orders.ts` | `requireAdminAction()`, requires a reason | `/admin/orders` |
| `revealDeliveryAction` | `app/actions/admin/orders.ts` | `requireAdminAction()`, writes an audit row | none (returns data) |
| `updateProductAction` | `app/actions/admin/products.ts` | `requireAdminAction()` | `/admin/products` and the detail |
| `verifySellerAction` | `app/actions/admin/sellers.ts` | `requireAdminAction()` | `/admin/sellers` |
| `unverifySellerAction` | `app/actions/admin/sellers.ts` | `requireAdminAction()` | `/admin/sellers` |
| `suspendSellerAction` | `app/actions/admin/sellers.ts` | `requireAdminAction()`, reason required by the rules module | `/admin/sellers`, `/admin/categories`, layout |
| `unsuspendSellerAction` | `app/actions/admin/sellers.ts` | `requireAdminAction()` | `/admin/sellers`, `/admin/categories`, layout |
| `deleteReviewAction` | `app/actions/admin/reviews.ts` | `requireAdminAction()` | `/admin/reviews`, layout |
| `updateCategoryAction` | `app/actions/admin/categories.ts` | `requireAdminAction()`, parses `FormData` | `/admin/categories`, layout |
| `updateDeliveryAreaAction` | `app/actions/admin/delivery-areas.ts` | `requireAdminAction()`, parses `FormData` | `/admin/delivery-areas`, `/checkout` |

Every one returns a typed result object. None throws a string: a throw becomes
an error boundary over the whole page, which is the wrong failure shape for
"your cart is full".

**The admin actions are the exception, deliberately.** An unauthenticated call
to one *does* throw, rather than returning `{ ok: false }`. A typed failure
comes back as 200 with a message, which reads to a scraper like a working
endpoint — refusing loudly tells the caller nothing about whether the action
exists or what it does.

### Rules the UI enforces by construction

- **30-minute hold** (`RESERVATION_MINUTES`). Refreshed on every add, so an
  active shopper keeps their units.
- **10 per line** (`MAX_QUANTITY_PER_LINE`).
- **Available = `stock - stock_reserved`.** Cards, the stepper ceiling and the
  "only N left" line all use `available`, never `stock` — `stock` includes units
  other shoppers are holding and cannot be promised.
- **Optimistic UI always pairs with a pending state.** Optimism without one
  lets a shopper tap + three times during a slow request with no idea which
  landed.
- **Live regions are `aria-live="polite"`** and prefixed "Not added" on failure,
  so a failure never announces as a neutral success.

### Known gaps behind these controls

| Gap | Effect | Where |
| --- | --- | --- |
| `sweepExpiredReservations()` is written but never scheduled | Lapsed hold rows accumulate. **Availability is affected** — see the row below: `stock_reserved` is a counter, so a lapsed row keeps suppressing stock until a release path decrements it. | `src/lib/cart.ts` |
| `products.stock_reserved` is a denormalised counter with no trigger behind it | Availability is read as `stock - stock_reserved`, so **the counter is the source of truth** — the opposite of what the schema comment used to claim. Anything that deletes a reservation row without decrementing it corrupts availability permanently, and nothing detects the drift. `stock_reservations.cart_id` cascades, so `DELETE FROM carts` does exactly that. This was hit for real while preparing these screenshots: a product read `stock_reserved = 3` with **zero** reservation rows, understating availability by 3 with no error anywhere. Repaired by recomputing from the live rows; the hazard itself is still open. | `src/db/schema.ts`, `src/lib/cart.ts` |
| `/cart/session` is never linked from the UI | Fine today: `addToCartAction` mints the cookie itself. It remains the no-JavaScript path. | `src/app/cart/session/route.ts` |
| `getSellerBySlug()` exported, never called, and does not filter on `sellers.status` | The seller page it was written for does not exist. Every other read path now hides a suspended seller; whoever builds `/seller/[slug]` must add the condition too, and nothing in the code will remind them. | `src/lib/queries.ts` |
| `getProductsByCategory()` / `searchProducts()` imported but unused | Dead imports in the product page. | `src/app/product/[slug]/page.tsx` |
| No `favicon.ico` | 404 on every page load, visible in the console. | repo root |
| `reviews.title`, `reviews.body`, `reviews.order_id` never written | Ratings work; written reviews and "verified purchase" do not exist. A shopper can leave 1 star with no explanation and no way to show they actually bought the thing. | `src/lib/reviews.ts` |
| The guard *inside* admin actions is covered by construction, not by a test | `requireAdminAction()` reads `cookies()`, which throws outside a Next request scope, so no script can prove an action refuses — only that it would crash. Every action calls it first, and the page guard *is* asserted end to end over HTTP. A browser test clicking a button while logged out would close this. | `src/lib/admin.ts` |
| No way to create a product or a seller | The console edits, archives, verifies and suspends; rows still only arrive from the seed script. Matches the plan (edit + status, then moderation), but it is a gap in a real back office. | `src/app/admin/(protected)/products` |
| Moderation lists do not paginate | Sellers and reviews take a limit and stop at 100 rows without saying so — the header counts everything that matched, the list does not show it. Categories and delivery areas load every row. Fine at seed scale (3 / 8 / 47), not at volume. | `src/lib/admin-sellers.ts`, `src/lib/admin-reviews.ts` |
| Deleting a review is permanent | No `hidden` status on `reviews`, so the only recovery is the audit row, by hand. A schema change rather than a code change. | `src/lib/admin-reviews.ts` |
| `sweepExpiredReservations()` would double-decrement order-bound holds | It matches `released_at IS NULL AND expires_at <= now()` with no exclusion for rows already handed to an order, so **if it were ever scheduled** it would release a sold unit's hold and drop `stock_reserved` a second time. Latent today only because nothing schedules it, and `scripts/test-checkout.ts` asserts order-bound rows stay `released_at IS NULL` — so it is a deliberate, tested invariant, not an oversight. The admin console never invokes a sweep; cancelling marks only that order's own rows released. | `src/lib/cart.ts` |

**Recently closed:** the home page no longer claims checkout is missing. The
banner in `src/app/page.tsx` ("phase 2 / phase 4") and the old footer paragraph
in `layout.tsx` both described a state the app had already left behind — cart
and checkout are live. The banner is gone and the footer is now
`src/components/SiteFooter.tsx`. Neither carries phase or prototype status
anymore; the remaining limitation (M-Pesa) is stated on the checkout page,
beside the button it affects.
