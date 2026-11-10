-- CreateTable
CREATE TABLE "PlatformAudit" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "adminName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tenantId" TEXT,
    "tenantName" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformAudit_createdAt_idx" ON "PlatformAudit"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformAudit_tenantId_createdAt_idx" ON "PlatformAudit"("tenantId", "createdAt");
