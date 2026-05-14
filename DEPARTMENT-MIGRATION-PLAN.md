# Department Migration Investigation & Plan

## Problem Statement

The ZKTeco `DEPARTMENTS` table (30 records) does NOT represent organizational departments.
It represents **access control groups / door groups**. The actual organizational department
information is embedded in the `USERINFO.street` field as free-text.

---

## Investigation Findings

### 1. ZKTeco `DEPARTMENTS` Table Analysis

The 30 records in `DEPARTMENTS` are structured as:

```
DEPTID=1   SUPDEPTID=0   NAME=الامانة العامة للعتبة العسكرية     (root)
├── DEPTID=91   SUPDEPTID=1   NAME=اياد                           (person)
├── DEPTID=92   SUPDEPTID=1   NAME=المنطقة A                      (area A)
├── DEPTID=94   SUPDEPTID=1   NAME=المنطقة C                      (area C)
├── DEPTID=95   SUPDEPTID=1   NAME=المنطقة B                      (area B)
├── DEPTID=96   SUPDEPTID=1   NAME=المنطقة D                      (area D)
├── DEPTID=100  SUPDEPTID=1   NAME=جهاز الورشة                    (workshop device)
├── DEPTID=102  SUPDEPTID=1   NAME=حساب دخول برنامج ZKTecno       (ZKTeco account)
├── DEPTID=105  SUPDEPTID=1   NAME=مؤقت                           (temporary)
│   ├── DEPTID=131  SUPDEPTID=105  NAME=مؤقت لواء 36
│   ├── DEPTID=132  SUPDEPTID=105  NAME=مؤقت شرطة اتحادية
│   └── DEPTID=134  SUPDEPTID=105  NAME=موقت عتبة عسكرية
├── DEPTID=106  SUPDEPTID=1   NAME=استثناء الابواب                 (door exceptions)
│   ├── DEPTID=112  SUPDEPTID=106  NAME=كل الابواب
│   ├── DEPTID=115  SUPDEPTID=106  NAME=باب صحن الجوادين
│   ├── DEPTID=116  SUPDEPTID=106  NAME=باب خلف الملعب
│   ├── DEPTID=117  SUPDEPTID=106  NAME=باب صحن صاحب الامر
│   ├── DEPTID=118  SUPDEPTID=106  NAME=باب الشروق
│   │   └── DEPTID=124  SUPDEPTID=118  NAME=شرطة اتحادية
│   ├── DEPTID=119  SUPDEPTID=106  NAME=باب الحارة القديم والجديد
│   └── DEPTID=120  SUPDEPTID=106  NAME=لواء 36
├── DEPTID=121  SUPDEPTID=94   NAME=باب الشروق (under area C)
├── DEPTID=122  SUPDEPTID=96   NAME=باب الشروق (under area D)
├── DEPTID=123  SUPDEPTID=1    NAME=موقتة وتحذف
├── DEPTID=126  SUPDEPTID=1    NAME=جديد
├── DEPTID=127  SUPDEPTID=96   NAME=باب صاحب الامر
├── DEPTID=128  SUPDEPTID=1    NAME=اكثر من باب
├── DEPTID=129  SUPDEPTID=94   NAME=باب الملعب
├── DEPTID=135  SUPDEPTID=1    NAME=بصمات الروضة والحضانة
└── DEPTID=140  SUPDEPTID=1    NAME=بصمات محذوفة
```

**Conclusion**: This is NOT a department hierarchy. It is a **door/area grouping system** for access control.

### 2. `USERINFO.TITLE` Field Analysis

The `TITLE` field contains **access control/door assignments**, NOT job titles:

| Category | Count | Examples |
|---|---|---|
| **Door assignments** | 1,455 | "أ" (area A), "ب" (area B), "باب رقم 3", "باب الشروق", "باب الجوادين" |
| **Shift/Work type** | 146 | "الدوام الشهري", "وجبة أ", "وجبة ب" |
| **Residents** | 73 | "سكنة", "لغرض السكن", "غير ساكن" |
| **Empty** | 233 | (no value) |
| **Other** | 1,364 | Misc notes, personal names, exceptions |

**Conclusion**: `TITLE` maps to access permissions, not departments.

### 3. `USERINFO.street` Field Analysis (THE REAL DEPARTMENTS)

The `street` field contains **organizational department/section names** as free-text.

Top 30 department values found (2,908 out of 3,271 users = 89%):

| Department (street field) | Users | Cleaned Name | Backend Mapping |
|---|---|---|---|
| قسم الخدمات | 224 | قسم الخدمات | Department: "الخدمات" |
| قسم الضيافة | 132 | قسم الضيافة | Department: "الضيافة" |
| قسم الشؤون النسوية | 130 | قسم الشؤون النسوية | Department: "الشؤون النسوية" |
| حفظ النظام | 108 | حفظ النظام | Department: "حفظ النظام" |
| الشؤون النسوية | 93 | قسم الشؤون النسوية | (merge with above) |
| قسم الصيانة الهندسية | 92 | قسم الصيانة الهندسية | Department: "الصيانة الهندسية" |
| لواء 36 | 79 | لواء 36 | Department: "لواء 36" |
| قسم الاستثمار والسياحة الدينية | 73 | قسم الاستثمار والسياحة الدينية | Department: "الاستثمار والسياحة الدينية" |
| قسم حفظ النظام | 65 | حفظ النظام | (merge with above) |
| التربية والتعليم | 61 | التربية والتعليم | Division under "الشؤون الدينية" |
| قسم العلاقات | 46 | قسم العلاقات العامة | Department: "العلاقات العامة" |
| قسم الكهرباء والتبريد | 45 | قسم الكهرباء والتبريد | Division under "الصيانة الهندسية" |
| قسم الاليات | 42 | قسم الآليات | Department: "الآليات" |
| مكتب الامين العام | 39 | مكتب الامين العام | Department: "مكتب الأمين العام" |
| طالب | 39 | طالب | (not a department - person type) |
| طالبة | 35 | طالبة | (not a department - person type) |
| الخدمات | 33 | قسم الخدمات | (merge with above) |
| الشؤون الادارية | 29 | الشؤون الإدارية | Department: "الشؤون الإدارية" |
| قسم المخازن | 26 | قسم المخازن | Department: "المخازن" |
| الشؤون الخدمية | 26 | قسم الخدمات | (merge with above) |
| قسم الشؤون الهندسية | 25 | قسم الصيانة الهندسية | (merge with above) |
| قسم المشاريع الهندسية | 25 | قسم المشاريع الهندسية | Division under "الصيانة الهندسية" |
| العلاقات | 24 | قسم العلاقات العامة | (merge with above) |
| شرطة اتحادية | 24 | الشرطة الاتحادية | Department: "الشرطة الاتحادية" |
| ربة بيت | 24 | ربة بيت | (not a department - person type) |
| قسم الشؤون الدينية | 23 | قسم الشؤون الدينية | Department: "الشؤون الدينية" |
| الشرطة الاتحادية | 23 | الشرطة الاتحادية | (merge with above) |
| قسم الاعلام | 21 | قسم الإعلام | Department: "الإعلام" |
| الضيافة | 21 | قسم الضيافة | (merge with above) |
| قسم الشؤون المالية | 21 | قسم الشؤون المالية | Department: "الشؤون المالية" |

### 4. `DEFAULTDEPTID` Distribution

This field links users to the ZKTeco "departments" (which are actually door groups):

| DEFAULTDEPTID | Users | Corresponding ZKTeco Group |
|---|---|---|
| 1 | 1,290 | الامانة العامة (root/general) |
| 95 | 569 | المنطقة B |
| 118 | 217 | باب الشروق |
| 128 | 186 | اكثر من باب (multiple doors) |
| 92 | 112 | المنطقة A |
| 112 | 155 | كل الابواب (all doors) |
| 115 | 141 | باب صحن الجوادين |
| 91 | 67 | اياد |
| 127 | 63 | باب صاحب الامر |
| 131 | 63 | مؤقت لواء 36 |
| 129 | 48 | باب الملعب |
| 94 | 28 | المنطقة C |
| 124 | 43 | شرطة اتحادية |
| 119 | 53 | باب الحارة |
| 140 | 24 | بصمات محذوفة |
| ... | ... | ... |

**Conclusion**: `DEFAULTDEPTID` is the user's default access group, not their department.

---

## Clean Department Extraction Plan

### Phase 1: Identify Unique Clean Departments

From `street` field, extract and normalize department names:

```
Step 1: Read all USERINFO.street values
Step 2: Strip prefixes: "قسم ", "شعبة ", "وحدة ", "منتسب ", "منتسب ", "منتسبة "
Step 3: Strip suffixes: " عامة", " العامة"
Step 4: Normalize Arabic: "الشوؤن" → "الشؤون", "الضيافه" → "الضيافة"
Step 5: Group similar names (fuzzy matching)
Step 6: Build hierarchy from "/" separators (e.g., "حفظ النظام / امن الداخل")
```

### Phase 2: Build 3-Level Hierarchy

Based on the data analysis, the hierarchy pattern is:

```
Level 1 (Department / قسم):
├── مكتب الامين العام
├── الشؤون الدينية
├── الشؤون الهندسية
├── الشؤون الإدارية
├── الشؤون المالية
├── الشؤون النسوية
├── الخدمات / الشؤون الخدمية
├── الضيافة
├── حفظ النظام
├── العلاقات العامة
├── الآليات
├── الإعلام
├── الاستثمار والسياحة الدينية
├── المخازن
├── الرقابة والتدقيق
├── التخطيط والمتابعة
├── القانونية / الشؤون القانونية
├── الهدايا والنذور
├── الصيانة / الصيانة الهندسية
├── لواء 36
├── الشرطة الاتحادية
├── المدرسة الجعفرية
└── السلامة المهنية

Level 2 (Division / شعبة) - extracted from "/" in street:
├── الشؤون الدينية / التربية والتعليم
├── حفظ النظام / امن الداخل
├── حفظ النظام / المعلومات والتصاريح
├── حفظ النظام / المتطوعين
├── الشؤون الهندسية / الكهرباء والتبريد
├── الشؤون الهندسية / المشاريع
├── الشؤون الهندسية / التنفيذ
├── الشؤون المالية / الاستثمار
├── مكتب الامين / المتابعة
├── مكتب الامين / التربية والتعليم
├── ...

Level 3 (Unit / وحدة) - extracted from second "/":
├── حفظ النظام / شعبة المعلومات / المعرفين
├── حفظ النظام / الاتصالات / الشبكات
├── ...
```

### Phase 3: Handle Non-Department Values

These values should NOT become departments - they are person types:

| Value | Action | Backend Field |
|---|---|---|
| طالب | Tag as `STUDENT` | `AccessPerson.personType` or new field |
| طالبة | Tag as `STUDENT` | same |
| ربة بيت | Tag as `RESIDENT` | `AccessPerson.personType: RESIDENT` |
| ربه بيت | Merge to RESIDENT | same |
| سكنة | Tag as `RESIDENT` | same |
| لايوجد | No department | null |
| (phone numbers) | Invalid data | Skip |

### Phase 4: Map to Backend Structure

Backend uses `Department → Division → Unit` hierarchy:

```prisma
// Existing backend model:
model Department {
  id        String        @id @default(cuid())
  name      String        @unique
  divisions Division[]
  persons   AccessPerson[]
}

model Division {
  id           String     @id @default(cuid())
  name         String
  department   Department @relation(...)
  departmentId String
  units        Unit[]
  persons      AccessPerson[]
}

model Unit {
  id          String             @id @default(cuid())
  name        String
  division    Division           @relation(...)
  divisionId  String
  assignments DeviceAssignment[]
  persons     AccessPerson[]
}
```

---

## Migration Strategy

### What to Migrate from ZKTeco DEPARTMENTS

The ZKTeco `DEPARTMENTS` table should be mapped to **AccessDoor groups**, NOT organizational departments:

| ZKTeco DEPTID | Backend Target | Notes |
|---|---|---|
| DEPTID=1 (الامانة العامة) | Default door access group | Root - no specific door |
| DEPTID=92,94,95,96 (المناطق) | `AccessDoor.group` | Area A/B/C/D |
| DEPTID=106+children (أبواب) | `AccessDoor` records | Individual doors |
| DEPTID=105+children (مؤقت) | Temporary access groups | Time-limited permissions |
| DEPTID=120 (لواء 36) | Special access group | Military unit access |

### What to Extract as Real Departments

From `USERINFO.street` field:

```
Total users: 3,271
Users with department info in street: 2,908 (89%)
Users with no department info: 363 (11%)

Expected clean departments (Level 1): ~25
Expected clean divisions (Level 2): ~40
Expected clean units (Level 3): ~15
```

### Migration Script Logic

```
1. Extract all unique street values
2. Clean and normalize Arabic text
3. Parse hierarchy from "/" separator
4. Create Department records (Level 1)
5. Create Division records (Level 2)
6. Create Unit records (Level 3)
7. Map each USERINFO record:
   - Look up department from cleaned street
   - Assign to Department → Division → Unit
   - Map DEFAULTDEPTID to AccessDoor/AccessPermission
8. Create door access from DEPARTMENTS table
9. Assign door permissions based on DEFAULTDEPTID
```

---

## Updated Migration Plan for Departments

### Step 1: Create Department Extraction Script

A script that:
1. Reads `USERINFO.json` from MongoDB exports
2. Extracts and cleans `street` field values
3. Groups similar names
4. Outputs a clean department hierarchy JSON

### Step 2: Review & Approve Hierarchy

Present the extracted hierarchy for manual review before importing.

### Step 3: Create Doors from ZKTeco DEPARTMENTS

Map ZKTeco `DEPARTMENTS` → `AccessDoor` + `AccessDevice`:
- Area groups (A/B/C/D) → Door groups
- Door entries → Individual `AccessDoor` records
- Link `DEFAULTDEPTID` → `AccessPermission`

### Step 4: Assign Departments to Persons

For each `AccessPerson`:
- Extract department from `USERINFO.street`
- Link to the correct `Department` → `Division` → `Unit`
- Separately assign door permissions from `DEFAULTDEPTID`

---

## Summary of Changes from Original Plan

| Original Plan | Updated Plan | Reason |
|---|---|---|
| Migrate `DEPARTMENTS` → Backend `Department` | Migrate `DEPARTMENTS` → Backend `AccessDoor` groups | ZKTeco departments are door groups, not org departments |
| `DEFAULTDEPTID` → Department assignment | `DEFAULTDEPTID` → Door access permissions | Same reason |
| No department extraction needed | Extract from `USERINFO.street` | Real departments are in free-text field |
| Simple 1:1 mapping | Need cleaning + normalization | Arabic text inconsistencies, typos, duplicates |

## Files to Create

1. `scripts/extract-departments.js` - Extract and clean departments from street field
2. `scripts/migrate-doors.js` - Migrate ZKTeco departments as door groups
3. `scripts/migrate-person-departments.js` - Assign cleaned departments to persons
4. `output/department-hierarchy.json` - Clean hierarchy for review
5. `output/door-mapping.json` - Door group mapping
