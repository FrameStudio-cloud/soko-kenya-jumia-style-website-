-- ---------------------------------------------------------------------------
-- Seller suspension
-- ---------------------------------------------------------------------------
--
-- Phase 4 of the admin plan needs to shut a seller down. `is_verified` is not
-- that control: unverified means "we have not checked them", which is a claim
-- about the past. Suspended means "we are refusing to serve them right now",
-- which is a decision with a date and a reason, and which someone will ask
-- about later.
--
-- Modelling suspension as `is_verified = false` would also silently unlist
-- nothing — the catalogue filters never looked at that column — so the
-- seller's products would keep selling under a "suspended" label in the admin
-- UI. The flag has to be its own column so the read paths can act on it.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the constraint is dropped before
-- being re-added, which is the pattern 0007 uses for orders_totals_consistent.
ALTER TABLE "sellers"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "sellers"
  ADD COLUMN IF NOT EXISTS "suspended_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "sellers"
  ADD COLUMN IF NOT EXISTS "suspension_reason" text;
--> statement-breakpoint
ALTER TABLE "sellers"
  DROP CONSTRAINT IF EXISTS "sellers_status_valid";
--> statement-breakpoint
ALTER TABLE "sellers"
  ADD CONSTRAINT "sellers_status_valid" CHECK ("status" IN ('active', 'suspended'));
--> statement-breakpoint

-- Partial: the catalogue joins sellers on every product query, and nearly every
-- seller is active. An index over two values where one dominates buys little.
CREATE INDEX IF NOT EXISTS "sellers_suspended_idx"
  ON "sellers" ("id")
  WHERE "status" = 'suspended';
--> statement-breakpoint

COMMENT ON COLUMN "sellers"."status" IS
  'active or suspended. NOT NULL with a default, so this migration cannot fail '
  'on a table with existing sellers and needs no backfill. Suspension hides the '
  'seller''s products from the catalogue; existing orders are untouched and '
  'still ship.';
--> statement-breakpoint
COMMENT ON COLUMN "sellers"."suspended_at" IS
  'When the suspension took effect. NULL while active. Kept after reactivation '
  'so "why was this seller off the site in March" stays answerable.';
--> statement-breakpoint
COMMENT ON COLUMN "sellers"."suspension_reason" IS
  'Why an admin suspended this seller. Shown to staff, never to shoppers.';