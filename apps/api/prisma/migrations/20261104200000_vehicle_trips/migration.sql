-- CreateTable
CREATE TABLE "VehicleTrip" (
    "id" TEXT NOT NULL,
    "tripNo" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "salesmanId" TEXT,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "cashExpected" DECIMAL(14,2),
    "cashReceived" DECIMAL(14,2),
    "note" TEXT,
    "advanceId" TEXT,

    CONSTRAINT "VehicleTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleTripLine" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "loaded" DECIMAL(14,3) NOT NULL,
    "sold" DECIMAL(14,3) NOT NULL,
    "expected" DECIMAL(14,3) NOT NULL,
    "counted" DECIMAL(14,3) NOT NULL,
    "diff" DECIMAL(14,3) NOT NULL,
    "unloaded" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "VehicleTripLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleTrip_tripNo_key" ON "VehicleTrip"("tripNo");

-- CreateIndex
CREATE INDEX "VehicleTrip_vehicleId_status_idx" ON "VehicleTrip"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "VehicleTrip_date_idx" ON "VehicleTrip"("date");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleTripLine_tripId_productId_key" ON "VehicleTripLine"("tripId", "productId");

-- AddForeignKey
ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_salesmanId_fkey" FOREIGN KEY ("salesmanId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleTripLine" ADD CONSTRAINT "VehicleTripLine_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "VehicleTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleTripLine" ADD CONSTRAINT "VehicleTripLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A vehicle has at most one trip on the road at a time.
CREATE UNIQUE INDEX "VehicleTrip_vehicle_open_key" ON "VehicleTrip"("vehicleId") WHERE "status" = 'OPEN';
