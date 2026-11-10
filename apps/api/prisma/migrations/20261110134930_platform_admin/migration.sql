-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "expiresAt" TIMESTAMP(3),
    "maxUsers" INTEGER,
    "notes" TEXT,
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "tenantId" TEXT,
    "tenantCode" TEXT,
    "username" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "device" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantUserSeen" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "device" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TenantUserSeen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageDaily" (
    "tenantId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "writes" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "modules" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "UsageDaily_pkey" PRIMARY KEY ("tenantId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_code_key" ON "Tenant"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_schemaName_key" ON "Tenant"("schemaName");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_username_key" ON "PlatformAdmin"("username");

-- CreateIndex
CREATE INDEX "LoginEvent_tenantId_createdAt_idx" ON "LoginEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_ip_createdAt_idx" ON "LoginEvent"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_scope_username_createdAt_idx" ON "LoginEvent"("scope", "username", "createdAt");

-- CreateIndex
CREATE INDEX "TenantUserSeen_tenantId_lastSeen_idx" ON "TenantUserSeen"("tenantId", "lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "TenantUserSeen_tenantId_username_fingerprint_key" ON "TenantUserSeen"("tenantId", "username", "fingerprint");

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantUserSeen" ADD CONSTRAINT "TenantUserSeen_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageDaily" ADD CONSTRAINT "UsageDaily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
