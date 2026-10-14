# Admin console

How `/admin` is protected, what an admin is allowed to do to an order, how
customer data is handled, and what is deliberately not done yet.

Built across all four planned phases: identity (1), orders (2), catalogue (3),
moderation (4).

- Page inventory: [pages.md](./pages.md)
- Controls and chains: [interactions.md](./interactions.md)

## Access

### There is no accounts system

The whole app identifies shoppers by cookie: `soko_cart` for the basket,
`soko_prefs` for settings, `soko_rater` for product ratings. There are no users,
no sessions and no roles.

The admin console therefore has its own sign-in — one shared password, exchanged
for a signed cookie. It is a single-operator model, and it is deliberately dull.

| Setting | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | The password. In `.env.local`, which is gitignored. |
| `ADMIN_SESSION_SECRET` | Signs the cookie. Rotating it signs every operator out at once, which is the correct response to a suspected compromise. |

Both are **required**. A missing one throws rather than defaulting — a console
that silently disables itself looks identical to a locked-out operator, and
guessing a default is the worse failure of the two.

### What is different from every other cookie here

`soko_cart` and `soko_rater` are bare random UUIDs, documented as not
tamper-evident. Losing one costs you a cart or a rating. Forging the admin
cookie would hand over stock control and every customer's name, phone and street
address, so:

- the token is **HMAC-SHA256 signed**
- the password and the signature are compared with `crypto.timingSafeEqual`,
  never `===`
- the cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, and scoped
  to `path=/admin` so it is sent to exactly one area of the site

### Where the guard lives, and why not middleware

Two places, deliberately:

1. `src/app/admin/(protected)/layout.tsx` calls `requireAdmin()` — covers every
   admin page.
2. **Every** admin server action calls `requireAdminAction()` as its first
   statement.

A guard on the page protects nothing on its own. The actions are the attack
surface: a page can be guarded perfectly while a POST to the action behind it
still works. `scripts/smoke-admin-pages.ts` drives a real server and asserts the
first; the second is covered by construction and review.

Actions **throw** when unauthenticated rather than returning
`{ ok: false }`. A typed failure returns 200 with a message, which reads to a
scraper like a working endpoint.

`middleware.ts` is not used. A second enforcement path that must be kept in sync
with the first is a liability, not defence in depth. Revisit if the surface
grows.

### Lockout

Eight failed attempts lock an IP out for ten minutes, counted in memory. Honest
about its limits: it resets when the process restarts, and Next.js dev reloads
modules constantly, so in development a lockout lasts seconds. It exists to slow
someone typing a password repeatedly, not to survive a determined attacker. A
shared store would be needed for that, and is not worth building for one
operator yet.

## Orders

### Allowed transitions

```
pending_payment → confirmed | cancelled
confirmed       → dispatched | cancelled
dispatched      → delivered | refunded
delivered       → refunded
cancelled       → terminal
refunded        → terminal
```

Enforced in SQL, inside the same transaction as the write. The buttons in
`OrderStatusControls` are generated from the same map, but hiding a button is
presentation — the map is the control.

`dispatched → cancelled` is deliberately absent. The parcel has left; the only
honest move is a refund. An operator who tries it gets an error, not a silent
no-op.

### Cancelling returns stock — and nothing else

`placeOrder()` runs:

```sql
UPDATE products SET stock = stock - qty, stock_reserved = stock_reserved - qty
```

**Both** columns already moved. So the inverse is a single increment on
`stock`. Touching `stock_reserved` again would decrement it a second time for a
hold that no longer exists, and availability would inflate past the true figure.

The order row is locked `FOR UPDATE` first, or two admins cancelling the same
order would both read `confirmed`, both see the move as legal, and the stock
would be returned twice.

### Every change is recorded

Each transition writes an `order_status_history` row with `from_status`,
`to_status`, `changed_by` and a note. `changed_by` is free text by design — it
may hold a shopper, a seller, the admin console or a future sweep, and none of
those is yet one table of identities.

## Catalogue

`/admin/products` lists the whole catalogue — every status, not just the live
ones — and `/admin/products/[id]` edits one.

### Editable fields

Title, slug, description, brand, price, was-price, stock, delivery fee,
delivery estimate, category, seller and status.

Not editable here: `stock_reserved`, `rating`, `rating_count` and `specs`. The
first is maintained by carts, the next two are computed from reviews, and specs
are not managed by sellers yet. Exposing them as inputs would invite someone to
type a number the application then overwrites.

### There is no delete, and there cannot be one

`order_items.product_id` is `onDelete: restrict`, so a product that has ever
been ordered cannot be removed at all — `DELETE` fails outright. The schema
already forbids the destructive option, which is why the console offers a button
the database would reject: **`archived` is the removal path, and it is soft.**
The row, its images and every order line that references it survive.

`scripts/test-admin-products.ts` proves both halves: the row is still there
after archiving, and a hard `DELETE` of an ordered product fails on the foreign
key.

### Archiving needs no special query work

Every public read in `src/lib/queries.ts` already filters `p.status = 'active'`.
Setting a product to `archived` therefore unpublishes it from search, the
category page, the home page and direct `/product/[slug]` visits at once — with
no new filter added anywhere. The test proves it through `getProductBySlug()`,
the real read path, rather than a `WHERE` clause written to agree with the test.

| Status | Effect |
| --- | --- |
| `draft` | Hidden from the catalogue and search |
| `active` | Visible, purchasable, appears in search |
| `archived` | Removed from the catalogue; kept with its orders |

### Validation runs inside a locked transaction

`products.stock_reserved` is maintained by every other shopper's cart. The form
was rendered seconds ago, so validating against the value the operator *saw*
and writing later leaves a gap exactly where it matters.

`updateProduct()` locks the row `FOR UPDATE`, reads `stock_reserved` again, and
validates against that. The three rules that most often surprise an operator:

| Rule | Message instead of the constraint name |
| --- | --- |
| `products_reserved_not_over_stock` | "7 units are held in live carts. You cannot drop stock below 7 until those carts expire or are checked out." |
| `products_compare_at_greater` | "The old price must be higher than what you are charging now — otherwise it is a 0% discount." |
| `products_slug_key` | "That slug is already used by another product." |

A CHECK constraint tells you *that* the database refused; it does not tell you
what to do. The messages live in `admin-product-rules.ts`, which has no
database import — `ProductEditForm` is a client component, and importing a
module that pulls in `@/db` puts `pg` (and its `dns` require) in the browser
bundle. Phase 2 learned that from a failed build.

### Changing the slug changes the public URL

The form shows `/product/{slug}` under the field and warns, while it is being
typed, that a change breaks existing links. Old product URLs become 404s; there
is no redirect table. This is stated in the UI rather than discovered by a
customer.

### What is audited, and what is not

A **status change** writes an `admin_audit_log` row (`product_status_change`,
target = the new slug, note = `draft → active`). Publishing and unpublishing are
worth attributing.

Ordinary edits — a price, a typo — are not logged. They are visible on the row
itself, and a log of every save is noise that gets ignored, which defeats the
point of keeping one.

## Moderation

| Screen | Actions |
| --- | --- |
| `/admin/sellers` | verify, unverify, suspend (reason required), unsuspend |
| `/admin/reviews` | search, filter by rating, delete |
| `/admin/categories` | rename, re-slug |
| `/admin/delivery-areas` | fee, free-delivery threshold, ETA min/max, on or off |

### Suspension is one column, and that is the whole design

A suspended seller's products are not edited, archived or hidden individually.
`sellers.status` moves, and the catalogue filters do the rest — so reinstating
brings the entire catalogue back exactly as it was, with no inverse operation
to get wrong.

The condition lives in three places, because three different query shapes need
it:

| Where | Why there |
| --- | --- |
| `PRODUCT_SELECT`'s join in `src/lib/queries.ts` | Every product query selects this fragment — home, deals, search, category, related, direct product URL. One condition, and the next query written against it is correct for free. |
| `filterProducts`' `basePredicates` | The count, both facets and the price bounds build their own joins and never see that fragment. Without this the header would say 48 products while the list showed 41. |
| The two category counts (`getCategories`, `getCategoryBySlug`) | They `LEFT JOIN products` with no seller join at all, so they need an `EXISTS` subquery to agree with the list behind them. |

**A basket assembled before the suspension can still be checked out** unless
checkout re-checks, which is why `placeOrder()` now joins `sellers` and refuses
any line whose product or seller is not `active`. It reports the existing
`unavailable_item` reason, so the shopper is pointed at the cart with "no longer
available — remove it to continue". The wording is deliberate: naming the
suspension would leak an internal moderation decision to somebody who only ever
chose a product.

This is the last line of defence rather than the first. `RESERVE_SQL` already
refuses to hold a unit for a non-active product and every read path filters on
the seller, so only a stale cart reaches it.

> The same check closes the older gap for **archived** products, which had the
> same hole: archive was enforced everywhere except at the final commit.

### Verified and suspended are separate facts

`is_verified` says "we have checked them". `status` says "we are refusing to
serve them right now". Neither derives from the other: suspending a verified
seller does not quietly un-verify them, and reinstating does not hand back a
badge nobody earned twice.

### The suspension reason is staff-only

Required — a suspension with no reason is a decision nobody can review later,
and the audit row is the only record of who made it. It is stored on
`sellers.suspension_reason`, rendered in the console, written into the audit
note, and **never sent to a shopper**: the storefront queries select named
columns and none of them include it. Unsupending clears it, because an
accusation left beside a name follows somebody into the next moderator's shift.

### No phone number appears on the seller screen

`sellers.phone` is deliberately not selected for the list. That keeps the
console's rule blunt — no phone number on any admin screen, audited or not —
rather than making each screen argue about whether a seller's number counts as
the same class of data as a buyer's. `scripts/smoke-admin-pages.ts` asserts the
absence, so pasting the column in later fails a test.

### Review deletion is the only destructive action in the console

Every other control moves a column and can be moved back. A deleted review is
gone, which is why it needs a two-click confirm and why the audit row keeps the
review id, the product, the rating and the first 200 characters of the text —
that is what makes an over-eager deletion recoverable by hand.

`reviews` has no `status` column, so there is no hide. Adding one would mean
filtering it out of the public reads **and** out of the rating average in two
places; the audit record is the cheaper safety net.

Deleting a review also moves `products.rating` and `products.rating_count`,
inside the same transaction. The aggregate is the same `round(avg(rating), 2)`
that `rateProduct()` writes, and the subquery is ungrouped so a product's last
review takes it back to 0 rather than leaving a number pointing at nothing.

Review bodies are **not** masked. A review is public content the buyer chose to
publish, and `user_id` is the random id from the rater cookie, not anything
that identifies a person — so this screen needs no audited reveal, and the
absence is deliberate.

### Categories can be renamed but not created or deleted

`products.category_id` is `onDelete: restrict`, so a category holding products
cannot be removed at all, and adding one is a content decision rather than a
moderation one. The slug is the risk: it is the URL, linked from the header
rail, the footer and every product page, so changing it breaks links that are
already in the wild. The success message says so out loud rather than reporting
a quiet "Saved.".

The per-row product count counts active products from active sellers, so it
agrees with what the category page shows.

### Delivery areas cannot be renamed, and switching one off is immediate

The county name is both the unique key and the value the checkout form matches
against — renaming it would detach every order already addressed to it and turn
a working county into `unsupported_county`. It is shown read-only.

The on/off flag needs no query work at all: both delivery-estimate reads and
the `placeOrder()` lookup already filter `is_active`. So switching a county off
removes it from the estimate, unselects it at checkout, and refuses any order
still addressed there. The banner above the list says exactly that, because the
third consequence is the one that surprises people.

An empty free-delivery threshold is `NULL`, which is a different fact from `0`
(meaning every basket ships free). The parser reads the empty string as `NULL`,
never as zero.

## Customer data

Orders contain a real person's name, phone, town and street, in
`orders.delivery_address` (an immutable JSONB snapshot taken at checkout) and
`orders.delivery_phone`.

> The `addresses` table cannot be used for this. Its `userId` is `NOT NULL` and
> no auth exists yet, so the row can never be created. The checkout snapshot is
> the only place an order's address lives, which is also why it is immutable: a
> shopper editing a saved address must not rewrite where a parcel was sent.

### Masked by default

`maskAddress()` is applied in `getAdminOrderDetail`, so the unmasked values are
not reachable from a page render at all:

| Field | List / detail | Why |
| --- | --- | --- |
| County, town | shown | An operator sanity-checks a delivery zone at a glance; neither identifies a household alone. |
| Recipient name | first name + `…` | A surname plus a street is enough to identify someone. |
| Street | `••••••` | Even a partial reveal like "K4" from "Karen Blk 4" identifies a house. |
| Phone | `••••••678` | Enough to recognise your own number, useless to a stranger. |

### Reveal is a server action, and it is audited

`revealDeliveryAction` exists so the access can be recorded at the moment it
happens. The `admin_audit_log` row is written **before** the data is returned,
so there is no path that hands over an address without also recording that
someone asked.

The audit note deliberately does **not** contain the address. The log is read
more often than the orders table, and copying the PII into it would defeat the
masking it exists to prove was honoured.

Revealed state is local component state and does not survive a reload —
deliberately, because a page left open on a monitor is the most likely way this
data reaches the wrong person.

## The admin audit log

| Column | Meaning |
| --- | --- |
| `actor` | Who acted. Free text — there is no identities table yet, so this is a label (`admin`), not an id. |
| `action` | `reveal_delivery`, `order_status_change`, `product_status_change`, `login`, `seller_verify`, `seller_unverify`, `seller_suspend`, `seller_unsuspend`, `review_delete`, `category_update`, `delivery_area_update`. |
| `target` | What was acted on: an order reference, a product slug. **Null for `login`** — a sign-in acts on nothing, so the address it came from goes in `note`. |
| `note` | Free text. Never the revealed data. |

### Why only successful sign-ins are recorded

`login` writes one row per successful sign-in, with the client address in
`note`. Failed attempts are deliberately **not** written.

An attacker could otherwise grow this table at will: the address comes from
`x-forwarded-for`, which is caller-supplied, so the in-memory lockout's per-IP
cap is bypassable by simply lying about it. A log an outsider can expand without
limit is a liability rather than an audit trail. Brute-force attempts are still
visible — eight failures engage the lockout — they are just not persisted
forever.

The address is bound as a SQL parameter, so a forged header cannot become an
injection.

It is a separate table from `order_status_history` on purpose. That table is
about an order's state and keyed by `order_id`; a reveal changes no status, so
logging one there would invent a transition that never happened and corrupt the
sequence a dispute depends on.

Masking without an audit trail is only obfuscation, since anyone with database
access can read `orders` directly. The log is what makes it a control.

## Known gaps

- **The guard inside admin actions is not asserted at runtime.**
  `requireAdminAction()` reads `cookies()`, which throws outside a Next request
  scope, so a script cannot prove it refuses — only that it would crash. The
  page guard is covered end to end over HTTP; the action guard is covered by
  construction (every action's first statement). Worth a browser test that
  clicks a button while logged out.
- **`sweepExpiredReservations()` still double-decrements order-bound holds.**
  It matches `released_at IS NULL AND expires_at <= now()` with no exclusion for
  rows already handed to an order, so it would release them and decrement
  `stock_reserved` a second time. Latent only because the sweeper is never
  scheduled, and `scripts/test-checkout.ts` asserts that order-bound rows stay
  `released_at IS NULL` — so it is a deliberate, tested invariant, not an
  oversight. **The admin console never invokes the sweep.** Cancelling marks the
  cancelled order's own reservations released, which is safe, but the general
  case is untouched and needs its own decision.
- **One operator, one password.** No roles, no per-person attribution, no
  revocation other than rotating the secret. Fine for a single admin; it is not
  a model for a team.
- **No product or seller creation.** The catalogue can be edited, archived and
  suspended and sellers can be verified, but new rows of either kind still only
  arrive from the seed script. The plan scoped Phase 3 to edit + status and
  Phase 4 to moderation, neither of which adds rows.
- **The moderation lists do not paginate.** `listAdminSellers` and
  `listAdminReviews` take a limit and stop at 100 rows; `listAdminCategories`
  and `listAdminDeliveryAreas` load everything. At seed scale that is 3 sellers,
  8 categories and 47 counties, but a moderator searching reviews would not be
  told there were more than 100 — the count in the header says how many matched,
  the list silently does not show them all.
- **`getSellerBySlug()` does not filter on `sellers.status`.** It is still the
  one exported query in the file that never was — nothing calls it, because the
  seller page it was written for does not exist (see [pages.md](./pages.md)).
  Whoever builds `/seller/[slug]` has to add the condition; every other read
  path has it.
- **Deleting a review cannot be undone from the console.** Only from the audit
  row, by hand. A `hidden` status would fix it properly and is a schema change
  rather than a code change.
