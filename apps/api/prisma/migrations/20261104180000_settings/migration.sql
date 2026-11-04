-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- The Owner role always has every permission, including the new "Business settings".
INSERT INTO "RolePermission" ("roleId", "permissionCode")
SELECT "id", 'SETTINGS_EDIT' FROM "Role" WHERE "name" = 'Owner'
ON CONFLICT DO NOTHING;
