-- The end-of-day cash count.
CREATE TABLE "DayClose" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "openingCash" DECIMAL(14,2) NOT NULL,
    "cashIn" DECIMAL(14,2) NOT NULL,
    "cashOut" DECIMAL(14,2) NOT NULL,
    "expected" DECIMAL(14,2) NOT NULL,
    "counted" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "summary" JSONB,
    "closedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayClose_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DayClose_date_key" ON "DayClose"("date");
