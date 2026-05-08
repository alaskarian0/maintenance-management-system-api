-- DropIndex
DROP INDEX IF EXISTS "AccessLog_doorId_punchTime_idx";

-- CreateIndex
CREATE UNIQUE INDEX "AccessLog_doorId_punchTime_key" ON "AccessLog"("doorId", "punchTime");
