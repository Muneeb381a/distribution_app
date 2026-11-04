-- DropIndex
DROP INDEX "PayrollRun_employeeId_month_key";

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "PayrollRun_employeeId_month_idx" ON "PayrollRun"("employeeId", "month");

-- Only one ACTIVE payroll run per employee and month; cancelled runs may repeat so the month can be run again.
CREATE UNIQUE INDEX "PayrollRun_employeeId_month_active_key" ON "PayrollRun"("employeeId", "month") WHERE "status" = 'ACTIVE';
