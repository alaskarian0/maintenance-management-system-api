-- RemoveSystemTypeMergeLinks: drop systemType enum and column

-- 1. Drop the column that references the enum
ALTER TABLE "Link" DROP COLUMN IF EXISTS "systemType";

-- 2. Drop the enum type
DROP TYPE IF EXISTS "SystemType";
