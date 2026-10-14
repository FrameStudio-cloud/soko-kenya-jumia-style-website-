ALTER TABLE "products" ADD COLUMN "searchVector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english',
            coalesce(title, '') || ' ' ||
            coalesce(brand, '') || ' ' ||
            coalesce(category_id::text, '')
          )) STORED;--> statement-breakpoint
CREATE INDEX "products_search_idx" ON "products" USING gin ("searchVector");