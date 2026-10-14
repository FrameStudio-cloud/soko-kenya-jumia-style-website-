-- Phase 2: carts, cart_items, and a reservation model that survives a race.
--
-- Hand-written for the same reason as 0002-0004: drizzle-kit prompts
-- interactively when it cannot classify a diff.
--
-- The important change is stock_reservations. Previously it was keyed on a
-- bare session_id and could not distinguish a cart hold from an order's
-- claim. That model has a specific failure: a reservation converted at
-- checkout must not also be swept later as an abandoned cart hold, and with
-- one owner column there is no way to tell them apart. So the owner is now
-- split into cart_id and order_id, with a CHECK enforcing that exactly one is
-- set. A cart hold cannot be mistaken for an order.

CREATE TABLE IF NOT EXISTS "carts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" text NOT NULL,
  "user_id" text,
  "status" text NOT NULL DEFAULT 'active'
    CHECK ("status" IN ('active', 'converted', 'abandoned')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- One ACTIVE cart per session. Partial, so a converted cart does not block a
-- new one for the same session.
CREATE UNIQUE INDEX IF NOT EXISTS "carts_active_session_key"
  ON "carts" ("session_id")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "carts_user_idx" ON "carts" ("user_id");

CREATE TABLE IF NOT EXISTS "cart_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cart_id" uuid NOT NULL REFERENCES "carts" ("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products" ("id") ON DELETE CASCADE,
  "quantity" integer NOT NULL DEFAULT 1 CHECK ("quantity" > 0),
  -- Display-only: lets the cart say "was KSh 8,490" if the seller repriced.
  -- Checkout always charges the CURRENT price; this never feeds a total.
  "added_price" numeric(12,2) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Re-adding a product increments one line instead of creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_product_key"
  ON "cart_items" ("cart_id", "product_id");

-- ---------------------------------------------------------------- reservations

ALTER TABLE "stock_reservations" ADD COLUMN IF NOT EXISTS "cart_id" uuid
  REFERENCES "carts" ("id") ON DELETE CASCADE;

-- session_id is superseded by cart_id. Dropped rather than left nullable so
-- nothing new can be written against the ambiguous owner model.
ALTER TABLE "stock_reservations" DROP COLUMN IF EXISTS "session_id";

ALTER TABLE "stock_reservations"
  DROP CONSTRAINT IF EXISTS "stock_reservations_exactly_one_owner";

-- The core invariant: a reservation is held by a cart OR claimed by an order,
-- never both and never neither. Without this, a converted reservation is
-- indistinguishable from an abandoned cart hold.
ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_exactly_one_owner"
  CHECK (num_nonnulls("cart_id", "order_id") = 1);

-- Availability reads only live holds, so this partial index stays small
-- regardless of how much expired history piles up.
CREATE INDEX IF NOT EXISTS "stock_reservations_live_idx"
  ON "stock_reservations" ("product_id")
  WHERE "released_at" IS NULL;

COMMENT ON TABLE "stock_reservations" IS
  'Stock held for a cart, then claimed by an order at checkout. '
  'Availability = stock - sum(quantity WHERE released_at IS NULL AND expires_at > now()). '
  'Correctness does not depend on the expiry sweep running: the availability '
  'query filters on expires_at itself, so a lapsed row stops counting the '
  'moment it expires. The sweep only keeps the table from growing.';

COMMENT ON COLUMN "stock_reservations"."expires_at" IS
  'Abandoned carts release at this time. Read by the availability query, not '
  'just by the sweeper — that is what makes an unswept row harmless.';
