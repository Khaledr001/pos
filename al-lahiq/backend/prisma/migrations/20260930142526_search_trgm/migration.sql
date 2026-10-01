-- Typo-tolerant product search (see SearchModule). Requires the pg_trgm extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);
CREATE INDEX "variants_sku_trgm_idx" ON "variants" USING gin ("sku" gin_trgm_ops);
CREATE INDEX "variants_name_trgm_idx" ON "variants" USING gin ("name" gin_trgm_ops);
CREATE INDEX "brands_name_trgm_idx" ON "brands" USING gin ("name" gin_trgm_ops);
