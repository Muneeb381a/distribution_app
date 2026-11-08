-- Photos kept with a bill (the signed delivery slip).
CREATE TABLE "SaleProof" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleProof_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SaleProof_saleId_idx" ON "SaleProof"("saleId");

ALTER TABLE "SaleProof" ADD CONSTRAINT "SaleProof_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
