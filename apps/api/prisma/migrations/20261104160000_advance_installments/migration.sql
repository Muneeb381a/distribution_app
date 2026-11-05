-- Advances are now recovered in parts: each cut (from a payroll run, or a cash repayment) is a row.

-- AlterTable
ALTER TABLE "SalaryAdvance" ADD COLUMN "installment" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "AdvanceRecovery" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "payrollRunId" TEXT,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvanceRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdvanceRecovery_advanceId_idx" ON "AdvanceRecovery"("advanceId");
CREATE INDEX "AdvanceRecovery_payrollRunId_idx" ON "AdvanceRecovery"("payrollRunId");

-- AddForeignKey
ALTER TABLE "AdvanceRecovery" ADD CONSTRAINT "AdvanceRecovery_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "SalaryAdvance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdvanceRecovery" ADD CONSTRAINT "AdvanceRecovery_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Advances already deducted in full by a payroll run become one recovery of the whole amount.
INSERT INTO "AdvanceRecovery" ("id", "advanceId", "payrollRunId", "date", "amount", "note", "status", "createdById", "createdAt")
SELECT gen_random_uuid()::text, a."id", a."payrollRunId", r."paidOn", a."amount", NULL, 'ACTIVE', r."createdById", r."createdAt"
FROM "SalaryAdvance" a JOIN "PayrollRun" r ON r."id" = a."payrollRunId";

-- DropForeignKey / column
ALTER TABLE "SalaryAdvance" DROP CONSTRAINT "SalaryAdvance_payrollRunId_fkey";
ALTER TABLE "SalaryAdvance" DROP COLUMN "payrollRunId";
