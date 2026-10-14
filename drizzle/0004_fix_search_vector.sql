-- Replace products.search_vector with a correct expression.
--
-- Two bugs in the original generated column, both found by
-- scripts/debug-search.ts rather than by reading the code:
--
-- 1. It indexed category_id::text. A UUID tokenizes into meaningless lexemes
--    like '29a28c93' and '4f23', so the vector carried junk AND consumed
--    position slots that real words should occupy. Worse, 'usb-c' parses as a
--    phrase query ('usb-c' <-> 'usb' <-> 'c') which then matched nothing,
--    because the category UUID fragments could never satisfy it.
--
--    The intent was to make the category NAME searchable. That requires the
--    join, which a generated column cannot do — generated columns may only
--    reference columns of their own row.
--
-- 2. It ignored products.tags. 'usb-c' is a tag on the Anker and a real thing
--    shoppers search for, but tsquery stems and splits the hyphen so exact
--    tag matching still needs ILIKE. Tags stay a separate column and are
--    matched in the query layer instead of being forced into the vector.
--
-- Dropped the GIN index first: on a large table rebuilding in place can
--    briefly lock, and this table is small. On a big catalogue use
--    CREATE INDEX CONCURRENTLY outside the migration.

DROP INDEX IF EXISTS "products_search_idx";

ALTER TABLE "products"
  DROP COLUMN IF EXISTS "search_vector";

-- english config gives stemming, so 'chargers' finds 'charger'.
ALTER TABLE "products"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(brand, '')
    )
  ) STORED;

CREATE INDEX "products_search_idx" ON "products" USING gin ("search_vector");

COMMENT ON COLUMN "products"."search_vector" IS
  'Generated from title + brand only. Category names are joined at query time '
  'rather than indexed here, because a generated column cannot reference '
  'another table. Tags are matched with ILIKE, not this vector.';
