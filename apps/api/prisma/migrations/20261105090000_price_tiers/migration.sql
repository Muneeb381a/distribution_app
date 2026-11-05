-- Two price lists: every existing list rate is retail; customers start on retail.
ALTER TABLE "ProductPrice" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'RETAIL';
ALTER TABLE "ProductPrice" DROP CONSTRAINT "ProductPrice_pkey";
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("productId", "unitName", "tier");

ALTER TABLE "Customer" ADD COLUMN "priceTier" TEXT NOT NULL DEFAULT 'RETAIL';
