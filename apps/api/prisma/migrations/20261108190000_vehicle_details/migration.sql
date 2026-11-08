-- AlterTable
ALTER TABLE "Location" ADD COLUMN "regNo" TEXT,
ADD COLUMN "vehicleKind" TEXT,
ADD COLUMN "driverId" TEXT,
ADD COLUMN "note" TEXT;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
