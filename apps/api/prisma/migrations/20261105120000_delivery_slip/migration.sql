-- A delivery bill can be dispatched from the godown with a vehicle as the carrier, and tracked until the customer signs for it.
ALTER TABLE "Sale" ADD COLUMN "vehicleId" TEXT,
ADD COLUMN "deliveryStatus" TEXT,
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "deliveredById" TEXT,
ADD COLUMN "receivedBy" TEXT;

-- Existing deliveries were all from a loaded vehicle: the vehicle is the location.
UPDATE "Sale" SET "vehicleId" = "locationId" WHERE "saleType" = 'DELIVERY';

CREATE INDEX "Sale_deliveryStatus_idx" ON "Sale"("deliveryStatus");
CREATE INDEX "Sale_vehicleId_createdAt_idx" ON "Sale"("vehicleId", "createdAt");
