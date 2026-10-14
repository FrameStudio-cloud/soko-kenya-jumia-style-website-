-- Rename products.searchVector to search_vector.
--
-- Written by hand, not generated: drizzle-kit treats a column rename as
-- ambiguous and prompts interactively, which cannot work in CI. The intent
-- is unambiguous here because the column is GENERATED ALWAYS AS STORED, so
-- it holds no data worth preserving and only needs the index rebuilt.
--
-- The snake_case name matches every other column in this schema. The
-- camelCase version came from omitting the explicit db name in the Drizzle
-- column definition, which silently defaults to the TS property name.

ALTER TABLE "products" RENAME COLUMN "searchVector" TO "search_vector";

DROP INDEX IF EXISTS "products_search_idx";

CREATE INDEX "products_search_idx" ON "products" USING gin ("search_vector");
