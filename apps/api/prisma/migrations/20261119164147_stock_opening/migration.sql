-- CreateTable
CREATE TABLE "StockOpening" (
    "id" TEXT NOT NULL,
    "openingNo" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "note" TEXT,
    "totalValue" DECIMAL(14,2) NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,

    CONSTRAINT "StockOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOpeningLine" (
    "id" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtyBase" DECIMAL(14,3) NOT NULL,
    "openingAfter" DECIMAL(14,3) NOT NULL,
    "unitCostBase" DECIMAL(14,4),
    "previousCost" DECIMAL(14,4),
    "costChanged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StockOpeningLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockOpening_openingNo_key" ON "StockOpening"("openingNo");

-- CreateIndex
CREATE INDEX "StockOpening_locationId_createdAt_idx" ON "StockOpening"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockOpeningLine_openingId_idx" ON "StockOpeningLine"("openingId");

-- CreateIndex
CREATE INDEX "StockOpeningLine_productId_idx" ON "StockOpeningLine"("productId");

-- AddForeignKey
ALTER TABLE "StockOpening" ADD CONSTRAINT "StockOpening_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOpeningLine" ADD CONSTRAINT "StockOpeningLine_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "StockOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOpeningLine" ADD CONSTRAINT "StockOpeningLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
