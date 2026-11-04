-- Expenses belong to a godown or shop (or nowhere in particular); business line is no longer used for them.
ALTER TABLE "Expense" ADD COLUMN "locationId" TEXT;
CREATE INDEX "Expense_locationId_idx" ON "Expense"("locationId");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
