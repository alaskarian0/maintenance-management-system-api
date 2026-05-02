-- Keep only the Arabic segment before '|' for seeded bilingual labels (reference tables + links).
-- SPLIT_PART with no pipe returns the full string unchanged.

UPDATE "Category" SET "name" = TRIM(BOTH ' ' FROM SPLIT_PART("name", '|', 1));
UPDATE "Department" SET "name" = TRIM(BOTH ' ' FROM SPLIT_PART("name", '|', 1));
UPDATE "Division" SET "name" = TRIM(BOTH ' ' FROM SPLIT_PART("name", '|', 1));
UPDATE "Unit" SET "name" = TRIM(BOTH ' ' FROM SPLIT_PART("name", '|', 1));
UPDATE "Link" SET "name" = TRIM(BOTH ' ' FROM SPLIT_PART("name", '|', 1));

UPDATE "MaintenanceRecord"
SET "technicianName" = TRIM(BOTH ' ' FROM SPLIT_PART("technicianName", '|', 1))
WHERE "technicianName" LIKE '%|%';
