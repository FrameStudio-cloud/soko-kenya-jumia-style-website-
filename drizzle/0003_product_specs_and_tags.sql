-- Add products.specs (jsonb) and products.tags (text[]).
--
-- Hand-written for the same reason as 0002: drizzle-kit prompts
-- interactively when it cannot classify a diff, which cannot work in CI.
--
-- Both columns are additive with defaults, so this is safe to run against a
-- branch that already has rows. `specs` defaults to an empty object rather
-- than NULL so components can read product.specs without a null guard, which
-- is the same reason the fixture type had it non-optional.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "specs" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "tags" text[] NOT NULL DEFAULT ARRAY[]::text[];

COMMENT ON COLUMN "products"."specs" IS
  'Seller-supplied key/value spec sheet. JSONB for phase 1 since specs are '
  'always read in full; promote to a spec table when sellers manage them individually.';

COMMENT ON COLUMN "products"."tags" IS
  'Exact short search keywords. Queried with ILIKE, NOT the tsvector, because '
  '"usb-c" is a literal token that tsquery stemming can alter.';
