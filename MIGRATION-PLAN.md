# ZKTeco Data Migration Plan
## From `data.mdb` (Access) → `maintenance-management-system-api` (NestJS + Prisma + PostgreSQL)

---

## Current State

### Source: `data.mdb` (ZKTeco Fingerprint Backup)
- **37 tables**, 243,809 records, 561 MB
- MongoDB temp: `zkteco_fingerprint_backup` (19 collections, 345,859 docs)
- Extracted media: 376 photos + 2,196 face templates (530 MB)

### Target: `maintenance-management-system-api`
- **NestJS 10** + **Prisma 5** + **PostgreSQL**
- **25+ Prisma models** already exist
- **Access Control module** already has ZKTeco integration (`zk-attendance-sdk`, `zklib-ts`)

---

## Mapping: ZKTeco Tables → Backend Models

### Core Entities (Direct Match)

| ZKTeco Table | Backend Model | Status | Notes |
|---|---|---|---|
| `USERINFO` (3,271) | `AccessPerson` | **MIGRATE** | Users → Access persons with `personType: EMPLOYEE` |
| `CHECKINOUT` (70,853) | `AccessLog` | **MIGRATE** | Attendance records → Access logs |
| `DEPARTMENTS` (30) | `Department` → `Division` → `Unit` | **MIGRATE** | Departments hierarchy (3-level) |
| `Machines` (13) | `AccessDevice` | **MIGRATE** | Biometric devices → Access devices |
| `TEMPLATE` (4,371) | *(none yet)* | **NEW MODEL** | Fingerprint templates |
| `FaceTemp` (2,196) | *(none yet)* | **NEW MODEL** | Face recognition templates |
| `SystemLog` (21,266) | `ActivityLog` | **MIGRATE** | System operations → Activity log |

### Access Control Entities

| ZKTeco Table | Backend Model | Status | Notes |
|---|---|---|---|
| `ACGroup` (5) | *(partial)* | **EXTEND** | Backend has doors, not groups |
| `ACUnlockComb` (10) | *(none)* | **SKIP** | Unlock combinations (not in backend) |
| `UserACPrivilege` (799) | `AccessPermission` | **MIGRATE** | Door access permissions |
| `AUTHDEVICE` (0) | *(none)* | **SKIP** | Empty table |
| `UserACMachines` (0) | *(none)* | **SKIP** | Empty table |
| `SECURITYDETAILS` (133) | `User.permissions` | **MIGRATE** | Security roles → User permissions |

### Schedule & Shift Entities

| ZKTeco Table | Backend Model | Status | Notes |
|---|---|---|---|
| `SchClass` (3) | *(none)* | **NEW MODEL** | Shift definitions |
| `NUM_RUN` (3) | *(none)* | **NEW MODEL** | Work cycles |
| `NUM_RUN_DEIL` (0) | *(none)* | **SKIP** | Empty |
| `USER_OF_RUN` (3,182) | *(none)* | **NEW MODEL** | User-cycle assignments |
| `USER_TEMP_SCH` (137,635) | *(none)* | **NEW MODEL** | Temporary schedules |
| `SHIFT` (0) | *(none)* | **SKIP** | Empty |
| `ACTimeZones` (0) | *(none)* | **SKIP** | Empty |

### Leave & Holiday Entities

| ZKTeco Table | Backend Model | Status | Notes |
|---|---|---|---|
| `LeaveClass` (3) | *(none)* | **NEW MODEL** | Leave types |
| `LeaveClass1` (15) | *(none)* | **NEW MODEL** | Extended leave types |
| `HOLIDAYS` (0) | *(none)* | **SKIP** | Empty |
| `acholiday` (0) | *(none)* | **SKIP** | Empty |
| `USER_SPEDAY` (0) | *(none)* | **SKIP** | Empty |

### Config & Metadata Entities

| ZKTeco Table | Backend Model | Status | Notes |
|---|---|---|---|
| `AttParam` (18) | *(none)* | **SKIP/MIGRATE** | System params (can be config) |
| `TBKEY` (3) | *(none)* | **SKIP** | Badge prefixes (config) |
| `ReportItem` (0) | *(none)* | **SKIP** | Empty |
| `CHECKEXACT` (0) | *(none)* | **SKIP** | Empty |
| `AuditedExc` (0) | *(none)* | **SKIP** | Empty |
| `AlarmLog` (0) | *(none)* | **SKIP** | Empty |
| `ServerLog` (0) | *(none)* | **SKIP** | Empty |
| `TBSMSALLOT` (0) | *(none)* | **SKIP** | Empty |
| `TBSMSINFO` (0) | *(none)* | **SKIP** | Empty |
| `EmOpLog` (0) | *(none)* | **SKIP** | Empty |
| `EXCNOTES` (0) | *(none)* | **SKIP** | Empty |
| `DeptUsedSchs` (0) | *(none)* | **SKIP** | Empty |
| `UserUpdates` (0) | *(none)* | **SKIP** | Empty |
| `UserUsedSClasses` (0) | *(none)* | **SKIP** | Empty |
| `UsersMachines` (0) | *(none)* | **SKIP** | Empty |

### Existing Backend Models (No ZKTeco Equivalent)

These already exist in the backend and have NO data in `data.mdb`:
- `User` (admin users) — separate from `AccessPerson`
- `Device`, `DeviceItem`, `DeviceAssignment` (inventory)
- `Category`, `DeviceType` (device classification)
- `MaintenanceRecord`, `MaintenanceRequest` (maintenance workflow)
- `SparePart`, `SparePartUsage` (spare parts)
- `Workshop` (workshops)
- `AdminLetter`, `AdminLetterPerson` (admin letters)
- `Notification` (notifications)
- `Link`, `LinkStatusLog` (link monitoring)
- `FingerprintRecord` (backend's own fingerprint tracking)
- `PendingDeviceOp` (device operation queue)
- `Admin` (legacy admin auth)

---

## New Prisma Models Required

### 1. `FingerprintTemplate`
```prisma
model FingerprintTemplate {
  id              String   @id @default(cuid())
  userId          Int      // ZKTeco USERID (maps to AccessPerson.personId)
  fingerId        Int      // Finger index (0-9)
  templateData    Bytes?   // Raw template (BLOB from TEMPLATE field)
  templateData1   Bytes?   // TEMPLATE1
  templateData2   Bytes?   // TEMPLATE2
  templateData3   Bytes?   // TEMPLATE3
  templateData4   Bytes?   // TEMPLATE4
  bitmapPicture   Bytes?   // BITMAPPICTURE
  bitmapPicture2  Bytes?   // BITMAPPICTURE2
  bitmapPicture3  Bytes?   // BITMAPPICTURE3
  bitmapPicture4  Bytes?   // BITMAPPICTURE4
  zkTemplateId    Int      @unique // TEMPLATEID from ZKTeco
  flag            Int      @default(0)
  useType         Int      @default(1)
  machineNumber   String?  // EMACHINENUM
  divisionFP      Int      @default(0)
  person          AccessPerson? @relation(fields: [personId], references: [id])
  personId        String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### 2. `FaceTemplate`
```prisma
model FaceTemplate {
  id            String   @id @default(cuid())
  zkFaceId      Int      @unique // FACEID from ZKTeco
  userId        Int      // ZKTeco UserID
  templateData  Bytes    // TEMPLATE blob
  size          Int      // SIZE field
  valid         Int      @default(1)
  vfCount       Int      @default(0)
  activeTime    Int      @default(0)
  reserve       Int      @default(0)
  pin           Int?
  userNo        String?
  zkTemplateId  Int?
  person        AccessPerson? @relation(fields: [personId], references: [id])
  personId      String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### 3. `ShiftClass`
```prisma
model ShiftClass {
  id            String   @id @default(cuid())
  zkSchClassId  Int      @unique // schClassid from ZKTeco
  name          String
  startTime     DateTime
  endTime       DateTime
  lateMinutes   Int      @default(0)
  earlyMinutes  Int      @default(0)
  checkIn       Int      @default(1)
  checkOut      Int      @default(1)
  checkInTime1  DateTime?
  checkInTime2  DateTime?
  checkOutTime1 DateTime?
  checkOutTime2 DateTime?
  workDay       Float    @default(0)
  workMins      Float    @default(0)
  color         Int      @default(0)
  autoBind      Int      @default(0)
  sensorId      String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### 4. `WorkCycle`
```prisma
model WorkCycle {
  id          String   @id @default(cuid())
  zkRunId     Int      @unique // NUM_RUNID from ZKTeco
  name        String
  startDate   DateTime
  endDate     DateTime
  cycle       Int      @default(1)
  units       Int      @default(1)
  oldId       Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  assignments UserCycleAssignment[]
}
```

### 5. `UserCycleAssignment`
```prisma
model UserCycleAssignment {
  id          String    @id @default(cuid())
  userId      Int       // ZKTeco USERID
  runId       Int       // NUM_OF_RUN_ID
  startDate   DateTime
  endDate     DateTime
  orderRun    Int       @default(0)
  isNotOfRun  Int       @default(0)
  person      AccessPerson? @relation(fields: [personId], references: [id])
  personId    String?
  cycle       WorkCycle @relation(fields: [cycleId], references: [id])
  cycleId     String
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

### 6. `UserTempSchedule`
```prisma
model UserTempSchedule {
  id          String   @id @default(cuid())
  userId      Int      // ZKTeco USERID
  schClassId  Int      // FK to ShiftClass
  comeTime    DateTime
  leaveTime   DateTime
  flag        Int      @default(0)
  type        Int      @default(0)
  overTime    Int      @default(0)
  person      AccessPerson? @relation(fields: [personId], references: [id])
  personId    String?
  shift       ShiftClass?   @relation(fields: [shiftId], references: [id])
  shiftId     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### 7. `LeaveType`
```prisma
model LeaveType {
  id            String   @id @default(cuid())
  zkLeaveId     Int      @unique // LeaveId from ZKTeco
  name          String
  code          String?
  classify      Int      @default(0)
  leaveType     Int      @default(0)
  color         Int      @default(0)
  unit          Int      @default(0)
  minUnit       Float    @default(0.5)
  deduct        Float    @default(0)
  reportSymbol  String?
  remaindCount  Int      @default(0)
  remaindProc   Int      @default(0)
  calc          String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

---

## Field Mapping Details

### `USERINFO` → `AccessPerson`

| ZKTeco Field | Backend Field | Transform |
|---|---|---|
| `USERID` | `personId` (Int) | Direct |
| `Name` | `name` (String) | Direct |
| `Badgenumber` | `empCode` (String) | Direct |
| `DEFAULTDEPTID` | `departmentId` (String) | Lookup department by DEPTID → cuid |
| `PHOTO` | photo file path | Link to extracted image |
| `Gender` | *(new field needed)* | String |
| `CardNo` | *(new field needed)* | RFID card number |
| `PASSWORD` | *(skip or encrypt)* | Device password |
| `privilege` | `personType` / role mapping | 3=admin, 0=employee |
| `BIRTHDAY` | *(new field needed)* | Date |
| `HIREDDAY` | *(new field needed)* | Date |

### `CHECKINOUT` → `AccessLog`

| ZKTeco Field | Backend Field | Transform |
|---|---|---|
| `USERID` | `personId` | Lookup AccessPerson by personId |
| `CHECKTIME` | `punchTime` | Direct DateTime |
| `CHECKTYPE` | `punchState` | I=0, O=1 mapping |
| `VERIFYCODE` | `verifyType` | Direct (15=fingerprint, 1=password, 4=card) |
| `SENSORID` | `doorId` | Lookup by device serial |
| `sn` | *(door device)* | Lookup AccessDevice by sn |

### `DEPARTMENTS` → `Department` / `Division` / `Unit`

| ZKTeco | Backend | Notes |
|---|---|---|
| `DEPTID` + `SUPDEPTID=0` | `Department` | Top-level departments |
| `DEPTID` + `SUPDEPTID>0` | `Division` or `Unit` | Based on hierarchy depth |

### `Machines` → `AccessDevice`

| ZKTeco Field | Backend Field | Notes |
|---|---|---|
| `ID` | `zkTerminalId` | ZKTeco device ID |
| `MachineAlias` | `name` | Device name |
| `sn` | `serialNumber` | Serial number |
| `IP` | `ipAddress` | IP address |
| `Port` | *(port in connection)* | Port number |
| `ProductType` | *(new field)* | Device model |

---

## Migration Steps

### Phase 1: Schema Updates (Prisma)
1. Add 7 new models to `prisma/schema.prisma`
2. Add new fields to `AccessPerson` (gender, cardNo, birthday, hireDay, photo, password)
3. Add new fields to `AccessDevice` (productType, firmwareVersion, connectType)
4. Run `npx prisma migrate dev` to create migration

### Phase 2: Department Hierarchy Migration
1. Read `DEPARTMENTS` from MongoDB
2. Create `Department` records for top-level (SUPDEPTID=0)
3. Create `Division` records for mid-level
4. Create `Unit` records for leaf-level
5. Store mapping: ZKTeco DEPTID → Prisma cuid

### Phase 3: Person Migration (USERINFO)
1. Read `USERINFO` from MongoDB
2. For each user, create `AccessPerson` with:
   - `personType: EMPLOYEE`
   - `personId` = ZKTeco USERID
   - `empCode` = Badgenumber
   - `name` = Name
   - `departmentId` = mapped cuid
   - Link photo from extracted files
3. Store mapping: USERID → AccessPerson.id

### Phase 4: Device Migration (Machines)
1. Read `Machines` from MongoDB
2. Create `AccessDoor` for each machine location
3. Create `AccessDevice` linked to door:
   - `zkTerminalId` = Machines.ID
   - `serialNumber` = Machines.sn
   - `ipAddress` = Machines.IP
   - `isAttendance` = true

### Phase 5: Access Log Migration (CHECKINOUT)
1. Read `CHECKINOUT` from MongoDB (70,853 records)
2. Batch insert into `AccessLog`:
   - `personId` = mapped AccessPerson.id
   - `doorId` = mapped AccessDoor.id
   - `punchTime` = CHECKTIME
   - `punchState` = CHECKTYPE mapping
   - `verifyType` = VERIFYCODE
   - `syncedFromZKBio` = true

### Phase 6: Biometric Template Migration
1. `TEMPLATE` (4,371) → `FingerprintTemplate` records
2. `FaceTemp` (2,196) → `FaceTemplate` records
3. Link each to the corresponding `AccessPerson`

### Phase 7: Schedule & Shift Migration
1. `SchClass` → `ShiftClass`
2. `NUM_RUN` → `WorkCycle`
3. `USER_OF_RUN` → `UserCycleAssignment`
4. `USER_TEMP_SCH` (137,635) → `UserTempSchedule`
5. `LeaveClass` + `LeaveClass1` → `LeaveType`

### Phase 8: Permissions & Security
1. `UserACPrivilege` → `AccessPermission`
2. `SECURITYDETAILS` → `User.permissions` (JSON mapping)
3. `SystemLog` → `ActivityLog`

---

## What Exists vs What's New

### Already Exists in Backend (Match Found)
- [x] Users/Persons (`AccessPerson` ← `USERINFO`)
- [x] Attendance Logs (`AccessLog` ← `CHECKINOUT`)
- [x] Departments hierarchy (`Department/Division/Unit` ← `DEPARTMENTS`)
- [x] Devices (`AccessDevice` ← `Machines`)
- [x] Access Permissions (`AccessPermission` ← `UserACPrivilege`)
- [x] Activity Log (`ActivityLog` ← `SystemLog`)
- [x] Doors (`AccessDoor` ← implied from machines)

### Needs New Model (Does NOT Exist)
- [ ] `FingerprintTemplate` ← `TEMPLATE` (4,371 records)
- [ ] `FaceTemplate` ← `FaceTemp` (2,196 records)
- [ ] `ShiftClass` ← `SchClass` (3 records)
- [ ] `WorkCycle` ← `NUM_RUN` (3 records)
- [ ] `UserCycleAssignment` ← `USER_OF_RUN` (3,182 records)
- [ ] `UserTempSchedule` ← `USER_TEMP_SCH` (137,635 records)
- [ ] `LeaveType` ← `LeaveClass/LeaveClass1` (18 records)

### Needs New Fields on Existing Model
- [ ] `AccessPerson`: add `gender`, `cardNo`, `birthday`, `hireDay`, `photoPath`, `devicePassword`
- [ ] `AccessDevice`: add `productType`, `firmwareVersion`, `connectType`

### Skipped (Empty or Not Relevant)
- 18 empty tables (ACTimeZones, AUTHDEVICE, AlarmLog, etc.)
- ZKAttendanceMonthStatistics (empty)
- TBSMSALLOT / TBSMSINFO (SMS features, empty)

---

## Data Volume Summary

| Phase | Records | Estimated Time |
|---|---|---|
| Departments | 30 | < 1s |
| Persons (USERINFO) | 3,271 | ~5s |
| Devices (Machines) | 13 | < 1s |
| Access Logs (CHECKINOUT) | 70,853 | ~30s |
| Fingerprint Templates | 4,371 | ~10s |
| Face Templates | 2,196 | ~5s |
| Shifts & Schedules | 140,824 | ~60s |
| Permissions | 799 | ~2s |
| System Logs | 21,266 | ~10s |
| **Total** | **243,633** | **~2 min** |

---

## Files to Create/Modify

### New Files
1. `prisma/migrations/YYYYMMDDHHMMSS_add_zkteco_models/migration.sql` — auto-generated
2. `src/migration/migration.module.ts` — Migration module
3. `src/migration/migration.service.ts` — Migration logic
4. `src/migration/migration.controller.ts` — Migration API endpoint
5. `src/migration/dto/migration.dto.ts` — DTOs

### Modified Files
1. `prisma/schema.prisma` — Add 7 new models + extend existing
2. `src/app.module.ts` — Register MigrationModule
3. `src/access-control/access-control.module.ts` — Updated relations

---

## Risk Assessment

| Risk | Level | Mitigation |
|---|---|---|
| Data loss during migration | LOW | MongoDB backup exists; migration is additive |
| ID mapping conflicts | MEDIUM | Store mapping table; use transactions |
| Large table performance | LOW | Batch inserts (1000/batch); PostgreSQL handles well |
| Schema migration conflicts | LOW | New tables only; existing tables get additive columns |
| Photo file linking | LOW | Files already extracted; store path references |
