-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- The starting list, plus every category already used on an expense.
INSERT INTO "ExpenseCategory" ("id", "name", "isSystem")
SELECT gen_random_uuid()::text, n, n = 'Salaries'
FROM (SELECT unnest(ARRAY['Utility bills', 'Rent', 'Salaries', 'Fuel', 'Vehicle maintenance', 'Other']) AS n
      UNION SELECT DISTINCT "category" FROM "Expense") AS names
ON CONFLICT ("name") DO NOTHING;
