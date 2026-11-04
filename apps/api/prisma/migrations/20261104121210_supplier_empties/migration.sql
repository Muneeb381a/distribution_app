-- CreateTable
CREATE TABLE "SupplierEmptiesLedger" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "qtyIn" INTEGER NOT NULL DEFAULT 0,
    "qtyOut" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "SupplierEmptiesLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierEmptiesLedger_supplierId_productId_idx" ON "SupplierEmptiesLedger"("supplierId", "productId");

-- AddForeignKey
ALTER TABLE "SupplierEmptiesLedger" ADD CONSTRAINT "SupplierEmptiesLedger_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierEmptiesLedger" ADD CONSTRAINT "SupplierEmptiesLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
