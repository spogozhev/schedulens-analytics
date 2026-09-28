-- CreateTable
CREATE TABLE "PlannedLoad" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "educatorId" INTEGER NOT NULL,
    "dateRangeId" INTEGER NOT NULL,
    "plannedMinutes" INTEGER NOT NULL,
    CONSTRAINT "PlannedLoad_educatorId_fkey" FOREIGN KEY ("educatorId") REFERENCES "Educator" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannedLoad_dateRangeId_fkey" FOREIGN KEY ("dateRangeId") REFERENCES "DateRange" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PlannedLoad_dateRangeId_idx" ON "PlannedLoad"("dateRangeId");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedLoad_educatorId_dateRangeId_key" ON "PlannedLoad"("educatorId", "dateRangeId");

