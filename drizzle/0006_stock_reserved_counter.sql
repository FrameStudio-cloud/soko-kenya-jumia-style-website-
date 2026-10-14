-- Add products.stock_reserved, the denormalised held-units counter.
--
-- Hand-written: drizzle-kit prompts interactively on this diff.
--
-- This is what makes the availability check race-free. The alternative,
-- computing `stock - sum(quantity WHERE released_at IS NULL)` on every add,
-- has to lock something before it can write the hold, so it needs a row lock
-- anyway — and then the aggregate is a scan for no gain. A counter lets one
-- atomic UPDATE both test and take the hold:
--
--   UPDATE products SET stock_reserved = stock_reserved + $qty
--    WHERE id = $id AND stock - stock_reserved >= $qty
--
-- The second concurrent transaction blocks on the row lock and, under READ
-- COMMITTED, re-evaluates its WHERE against the committed row. That
-- re-evaluation is the entire correctness argument.
--
-- Backfilling from existing reservations keeps the counter consistent with
-- any holds already on the branch. Without this, existing reservations would
-- become invisible to availability and stock could be oversold on day one.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "stock_reserved" integer NOT NULL DEFAULT 0;

-- Derive the counter from live reservations rather than trusting a default.
UPDATE "products" p
   SET "stock_reserved" = COALESCE(h.total, 0)
  FROM (
    SELECT "product_id", sum("quantity")::int AS total
      FROM "stock_reservations"
     WHERE "released_at" IS NULL AND "expires_at" > now()
     GROUP BY "product_id"
  ) h
 WHERE h."product_id" = p.id;

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_reserved_not_over_stock";
ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_stock_reserved_nonneg";

-- Database-level backstop for overselling. Even a miscounting application
-- cannot reserve past what is on hand.
ALTER TABLE "products"
  ADD CONSTRAINT "products_stock_reserved_nonneg" CHECK ("stock_reserved" >= 0);

ALTER TABLE "products"
  ADD CONSTRAINT "products_reserved_not_over_stock"
  CHECK ("stock_reserved" <= "stock");

-- The expression needs its own parentheses. In a column list, a bare
-- subtraction is parsed as the start of a new column name, so
-- ("status", "stock" - "stock_reserved") is a syntax error, not an index.
CREATE INDEX IF NOT EXISTS "products_availability_idx"
  ON "products" ("status", ("stock" - "stock_reserved"));

COMMENT ON COLUMN "products"."stock_reserved" IS
  'Units held by live reservations. Maintained by the atomic reserve UPDATE, '
  'which also enforces availability via its WHERE clause. stock is only '
  'decremented at checkout, never on add-to-cart.';
