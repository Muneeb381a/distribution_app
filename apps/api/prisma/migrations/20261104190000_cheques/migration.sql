-- Cheque payments: number, bank, date on the cheque, and (for customers) whether it cleared or bounced.
ALTER TABLE "Payment" ADD COLUMN "chequeNo" TEXT,
ADD COLUMN "chequeBank" TEXT,
ADD COLUMN "chequeDate" DATE,
ADD COLUMN "chequeStatus" TEXT,
ADD COLUMN "chequeSettledAt" TIMESTAMP(3);

ALTER TABLE "SupplierPayment" ADD COLUMN "chequeNo" TEXT,
ADD COLUMN "chequeBank" TEXT,
ADD COLUMN "chequeDate" DATE;

CREATE INDEX "Payment_chequeStatus_chequeDate_idx" ON "Payment"("chequeStatus", "chequeDate");

-- A bounced cheque puts the amount back on the customer's khata.
ALTER TYPE "CustomerLedgerRef" ADD VALUE 'CHEQUE_BOUNCED';
