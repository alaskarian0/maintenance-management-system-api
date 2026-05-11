-- CreateEnum
CREATE TYPE "DoorGroup" AS ENUM ('INSIDE', 'OUTSIDE');

-- CreateEnum
CREATE TYPE "DeviceSide" AS ENUM ('INSIDE', 'OUTSIDE');

-- CreateEnum
CREATE TYPE "FingerprintPersonType" AS ENUM ('EMPLOYEE', 'RESIDENT');

-- CreateTable
CREATE TABLE "FingerprintRecord" (
    "id" TEXT NOT NULL,
    "personType" "FingerprintPersonType" NOT NULL DEFAULT 'EMPLOYEE',
    "name" TEXT NOT NULL,
    "personId" INTEGER,
    "region" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FingerprintRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessDoor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "group" "DoorGroup",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessDoor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessDevice" (
    "id" TEXT NOT NULL,
    "doorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "side" "DeviceSide" NOT NULL DEFAULT 'INSIDE',
    "serialNumber" TEXT,
    "ipAddress" TEXT,
    "zkTerminalId" INTEGER,
    "state" INTEGER NOT NULL DEFAULT 3,
    "lastActivity" TIMESTAMP(3),
    "isAttendance" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessPerson" (
    "id" TEXT NOT NULL,
    "personType" "FingerprintPersonType" NOT NULL DEFAULT 'EMPLOYEE',
    "name" TEXT NOT NULL,
    "personId" INTEGER,
    "empCode" TEXT,
    "zkEmployeeId" INTEGER,
    "region" TEXT,
    "note" TEXT,
    "phone" TEXT,
    "accessType" TEXT NOT NULL DEFAULT 'permanent',
    "accessEndDate" TIMESTAMP(3),
    "fingerprintStatus" TEXT NOT NULL DEFAULT 'none',
    "faceStatus" TEXT NOT NULL DEFAULT 'none',
    "enrollDevice" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "fingerprintTemplates" JSONB,
    "faceTemplates" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "birthDate" TIMESTAMP(3),
    "courtNumber" TEXT,
    "departmentId" TEXT,
    "unitId" TEXT,
    "address" TEXT,
    "hireDate" TIMESTAMP(3),
    "role" TEXT NOT NULL DEFAULT 'user',
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessPermission" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "doorId" TEXT NOT NULL,
    "grantedBy" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "doorId" TEXT NOT NULL,
    "punchTime" TIMESTAMP(3) NOT NULL,
    "punchState" INTEGER NOT NULL DEFAULT 0,
    "verifyType" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'authorized',
    "syncedFromZKBio" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingDeviceOp" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "doorId" TEXT NOT NULL,
    "doorName" TEXT NOT NULL,
    "doorIp" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "empCode" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retries" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingDeviceOp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLetter" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "letterDate" TIMESTAMP(3) NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLetterPerson" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "personType" "FingerprintPersonType" NOT NULL DEFAULT 'EMPLOYEE',
    "personName" TEXT NOT NULL,
    "personId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLetterPerson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessDevice_doorId_idx" ON "AccessDevice"("doorId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessPermission_personId_doorId_key" ON "AccessPermission"("personId", "doorId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessLog_doorId_punchTime_key" ON "AccessLog"("doorId", "punchTime");

-- CreateIndex
CREATE INDEX "AccessLog_personId_punchTime_idx" ON "AccessLog"("personId", "punchTime" DESC);

-- CreateIndex
CREATE INDEX "PendingDeviceOp_status_createdAt_idx" ON "PendingDeviceOp"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AdminLetter_letterDate_idx" ON "AdminLetter"("letterDate" DESC);

-- CreateIndex
CREATE INDEX "AdminLetterPerson_letterId_idx" ON "AdminLetterPerson"("letterId");

-- CreateIndex
CREATE INDEX "AdminLetterPerson_personType_personId_idx" ON "AdminLetterPerson"("personType", "personId");

-- AddForeignKey
ALTER TABLE "AccessDevice" ADD CONSTRAINT "AccessDevice_doorId_fkey" FOREIGN KEY ("doorId") REFERENCES "AccessDoor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessPerson" ADD CONSTRAINT "AccessPerson_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessPerson" ADD CONSTRAINT "AccessPerson_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessPermission" ADD CONSTRAINT "AccessPermission_personId_fkey" FOREIGN KEY ("personId") REFERENCES "AccessPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessPermission" ADD CONSTRAINT "AccessPermission_doorId_fkey" FOREIGN KEY ("doorId") REFERENCES "AccessDoor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "AccessPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_doorId_fkey" FOREIGN KEY ("doorId") REFERENCES "AccessDoor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingDeviceOp" ADD CONSTRAINT "PendingDeviceOp_personId_fkey" FOREIGN KEY ("personId") REFERENCES "AccessPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingDeviceOp" ADD CONSTRAINT "PendingDeviceOp_doorId_fkey" FOREIGN KEY ("doorId") REFERENCES "AccessDoor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminLetterPerson" ADD CONSTRAINT "AdminLetterPerson_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "AdminLetter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
