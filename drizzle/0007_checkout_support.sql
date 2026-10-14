-- Phase 3: checkout support.
--
-- Hand-written: drizzle-kit prompts interactively on this diff.
--
-- Every statement below is separated by a statement-breakpoint marker. That
-- marker is how drizzle-kit splits a migration file into individually applied
-- chunks; a file without them is treated as ONE statement, which fails
-- SILENTLY on a multi-statement file — `drizzle-kit migrate` exits 0 having
-- applied nothing.
--
-- Note for future editors: do not write the marker's own text inside a SQL
-- comment. Splitting on it shreds the comment mid-line and produces
-- unparseable fragments. That trap cost real time here.
--
-- Everything here supports the cart -> order conversion, which is the first
-- place stock actually leaves inventory.

-- ---------------------------------------------------------------------------
-- orders: delivery address snapshot
-- ---------------------------------------------------------------------------
--
-- JSONB, not a FK to addresses. The address an order shipped to must never
-- change: a shopper may edit their saved address the moment the parcel ships,
-- and the seller still needs to deliver to where it actually went. A reference
-- would be a pointer to a moving target.
--
-- county stays a separate indexed column because routing, fees and reporting
-- all filter on it, and JSONB is not cheap to index for that.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "delivery_address" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "delivery_phone" text;
--> statement-breakpoint
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "delivery_notes" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_county_status_idx"
  ON "orders" ("county", "status");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- order_status_history
-- ---------------------------------------------------------------------------
--
-- Append-only audit trail. Without it, "where is my order" can only be
-- answered from the current row, and every status change becomes invisible.
-- Disputes need the sequence, not just the endpoint.
--
-- changed_by is text, not a FK: the actor may be a shopper, a seller, or the
-- expiry sweep, and none of those is yet one table of identities.
CREATE TABLE IF NOT EXISTS "order_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders" ("id") ON DELETE CASCADE,
  "from_status" text,
  "to_status" text NOT NULL,
  "changed_by" text,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_status_history_order_idx"
  ON "order_status_history" ("order_id", "created_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Unpaid-order expiry
-- ---------------------------------------------------------------------------
--
-- A placed order awaiting payment holds real stock. If payment never arrives,
-- that stock is gone until someone notices. expires_at is when the sweeper
-- returns it.
--
-- Set only for orders that actually await payment. Cash on delivery has no
-- such window: the shopper owes nothing, so there is nothing to time out.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_expiry_idx"
  ON "orders" ("expires_at")
  WHERE "expires_at" IS NOT NULL;
--> statement-breakpoint

COMMENT ON COLUMN "orders"."expires_at" IS
  'When an UNPAID order is voided and its stock returned. NULL for orders '
  'requiring no payment (cash on delivery). The partial index keeps this to '
  'the handful of rows actually waiting on money.';
--> statement-breakpoint
COMMENT ON COLUMN "orders"."delivery_address" IS
  'Immutable JSONB snapshot of the delivery address at checkout. Never a FK '
  'to addresses: the shopper may edit that row, and a reference would then '
  'point somewhere the parcel was not sent.';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Conversion must not double-spend stock
-- ---------------------------------------------------------------------------
--
-- Two concurrent checkouts of the same last unit each read stock=1, each
-- proceed, each decrement to 0. The product guard stock_reserved <= stock
-- does not stop it: 1-1=0 is legal for both. The order's own arithmetic is
-- what must hold, so it is enforced here.
--
-- Cannot subquery in a CHECK, so this guards grand_total =
-- subtotal + delivery_total. The line-sum check lives in the conversion
-- transaction, where line rows are visible.
ALTER TABLE "orders"
  DROP CONSTRAINT IF EXISTS "orders_totals_consistent";
--> statement-breakpoint
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_totals_consistent"
  CHECK (grand_total = subtotal + delivery_total);
--> statement-breakpoint
COMMENT ON CONSTRAINT "orders_totals_consistent" ON "orders" IS
  'grand_total must equal subtotal + delivery_total. Catches a conversion '
  'that computed its totals from different snapshots of the cart.';
