-- Low-stock alert level per product, in base units (bottles / kg), across all locations.
ALTER TABLE "Product" ADD COLUMN "reorderLevel" DECIMAL(14,3);
