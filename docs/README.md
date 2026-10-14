# SokoKenya docs

Working documentation for this marketplace. These files are the plan and the
record: what pages exist, what connects to what, and what happens when someone
presses a control.

They are Markdown in the repo, not pages in the app — so they can be written
before the thing they describe exists, and read in a diff.

## Contents

| File | What it answers | Update it when… |
| --- | --- | --- |
| [pages.md](./pages.md) | How many pages does this site have, which are built, which are next, and what each one links to. | A route is added, removed, renamed, or a link between pages changes. |
| [interactions.md](./interactions.md) | When you press this, what actually happens — the component, the server action, the SQL, and what the shopper sees. | A control is added or its behaviour changes. |
| [imagery.md](./imagery.md) | Where a product picture comes from, why the database holds a key instead of a URL, and what is on disk until real photos arrive. | The image pipeline changes: a new surface renders images, `imageUrl()` gains a bucket, or the generated artwork is replaced. |
| [admin.md](./admin.md) | How `/admin` is protected, what an admin may do to an order or a seller, how customer data is masked and audited, and what suspension actually changes. | The auth model, the transition map, the PII policy, or any moderation screen changes. |

Read [pages.md](./pages.md) first if you are new: it is the map.
[interactions.md](./interactions.md) is the wiring diagram underneath it.

## Status legend

Both files use the same three states.

- **Built** — shipped and reachable in the running app.
- **Partial** — reachable, but part of what it should do is missing. The gap is
  stated on the line.
- **Planned** — not built. Listed so the count of pages still to add is a
  number rather than a feeling.

## Rules that keep these true

These exist because documentation rots faster than code.

1. **A page that is built gets a row in `pages.md` in the same change.** Not a
   follow-up. One row, in the same PR.
2. **A control that changes behaviour gets a row in `interactions.md`.** If you
   write the server action, you write its line.
3. **State the reason, not just the fact.** "Links to `/search` because the
   sidebar filters build plain hrefs and work without JavaScript" survives a
   redesign; "links to `/search`" does not.
4. **Planned pages stay in the file** until they are built, then move up to the
   built table. They are not a backlog to delete.
5. **A migration that adds a column declares it in `src/db/schema.ts` in the
   same change.** `scripts/verify-schema-sync.ts` fails the suite otherwise. This
   is not hypothetical: migration 0007 added four columns to `orders` plus the
   whole `order_status_history` table, and `placeOrder` wrote all of them for
   months while the schema model declared none of it. Nothing broke only because
   every query goes through raw `pg` rather than drizzle's builder — which is
   luck, not design, and the reason the check now exists.

## Current shape of the app

- **Framework**: Next.js App Router (16.4), React 19, Tailwind 4, TypeScript.
- **Data**: Drizzle + `pg` against Neon Postgres. Public reads go through
  `src/lib/queries.ts`; admin reads go through `src/lib/admin-orders.ts`,
  `src/lib/admin-products.ts` and the four moderation modules
  (`admin-sellers`, `admin-reviews`, `admin-categories`,
  `admin-delivery-areas`). Pages never import the database themselves, and no
  module a client component imports may either — validation lives in
  `admin-*-rules.ts` with no `@/db`, or `pg` reaches the browser bundle.
- **Rendering**: every route is `force-dynamic`. No page is cached, because
  they all read a per-shopper cookie.
- **State**: no shopper accounts. Cart lives in the `soko_cart` cookie,
  settings in `soko_prefs`, the last order outcome in `localStorage`.
  The **admin console** is separate: one shared password from `ADMIN_PASSWORD`,
  exchanged for an HMAC-signed HttpOnly cookie — see [admin.md](./admin.md).
- **Payments**: cash on delivery only. M-Pesa is not wired.
- **Seed data**: 48 active products, 8 categories, on the `dev-add-search`
  branch.
- **Imagery**: one generated SVG tile per product in `public/products/`,
  recorded in `product_images` as an object key and resolved through
  `imageUrl()`. Not photography yet — [imagery.md](./imagery.md) explains the
  pipeline and what changes when real photos arrive.

## Verification

Docs describe intent; these check it.

```sh
npm test                    # migrations, schema sync, cart, checkout, ratings, admin
SMOKE_BASE_URL=http://localhost:3131 npm test -- --http   # + HTTP suites (incl. the admin guard)
npx tsc --noEmit            # types
```

`scripts/test-filters.ts` covers every route and filter claim made in
`pages.md`. `scripts/test-admin-moderation.ts` drives every public product read
path three times — seller active, suspended, reinstated — so the claim that
suspension hides a catalogue is asserted against the real query functions
rather than re-stated SQL; it also proves a stale basket cannot be checked out
against a suspended seller, and that deleting a review recomputes the product's
rating. `scripts/smoke-admin-pages.ts` proves each `/admin` route refuses an
unauthenticated request, and that neither a customer's phone number and street
nor a seller's phone number appears in the admin HTML. If a doc makes a claim,
there is an assertion behind it.
