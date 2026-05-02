-- AlterTable
ALTER TABLE "Link" ADD COLUMN "isMaintenance" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LinkStatusLog" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "isUp" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "responseTimeMs" INTEGER,
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkStatusLog_linkId_checkedAt_idx" ON "LinkStatusLog"("linkId", "checkedAt" DESC);

-- AddForeignKey
ALTER TABLE "LinkStatusLog" ADD CONSTRAINT "LinkStatusLog_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;
