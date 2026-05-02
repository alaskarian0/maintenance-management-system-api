/**
 * Full database seed (demo + org from JSON). Destructive: clears listed tables first.
 *
 * Run when you choose:
 *   npx prisma db seed
 * Non-interactive / automation:
 *   SEED_CONFIRM=yes npx prisma db seed
 *
 * Optional env:
 *   SEED_INCLUDE_INACTIVE_HIERARCHY=1  — include "( المنقطعين عن العمل )" paths in org JSON
 *   ADMIN_INITIAL_PASSWORD           — only used if no Admin row exists yet
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import {
  PrismaClient,
  MaintenanceStatus,
  Prisma,
  type Prisma as PrismaJson,
} from '@prisma/client';
import { seedDepartmentsFromHierarchyJson } from './hierarchyFromJson';
import { confirmDestructiveSeed } from './seedGuard';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

async function wipeSeedScope(tx: Prisma.TransactionClient) {
  await tx.maintenanceRecord.deleteMany();
  await tx.device.deleteMany();
  await tx.unit.deleteMany();
  await tx.division.deleteMany();
  await tx.department.deleteMany();
  await tx.category.deleteMany();
  await tx.link.deleteMany();
}

async function main() {
  await confirmDestructiveSeed();

  await prisma.$transaction(async (tx) => {
    await wipeSeedScope(tx);
  });

  const admin = await prisma.admin.findFirst();
  if (!admin) {
    const initial =
      process.env.ADMIN_INITIAL_PASSWORD?.trim() || 'admin';
    await prisma.admin.create({
      data: {
        passwordHash: await bcrypt.hash(initial, SALT_ROUNDS),
      },
    });
  }

  /** أقسام / شعب / وحدات من prisma/data/employes2-unique-hierarchy.json. افتراضياً: استبعاد مسارات (المنقطعين عن العمل). لتضمينها: SEED_INCLUDE_INACTIVE_HIERARCHY=1 */
  const includeInactiveHierarchy =
    process.env.SEED_INCLUDE_INACTIVE_HIERARCHY === '1' ||
    process.env.SEED_INCLUDE_INACTIVE_HIERARCHY === 'true';
  const allUnits = await seedDepartmentsFromHierarchyJson(prisma, {
    excludeInactive: !includeInactiveHierarchy,
  });

  const categories = await Promise.all([
    prisma.category.create({
      data: { name: 'مضخات ومحركات' },
    }),
    prisma.category.create({
      data: { name: 'تكييف وتبريد' },
    }),
    prisma.category.create({
      data: { name: 'أنظمة تحكم وPLC' },
    }),
    prisma.category.create({
      data: { name: 'معدات ثقيلة' },
    }),
    prisma.category.create({
      data: { name: 'شبكات وأمن معلومات' },
    }),
  ]);

  const pick = <T>(arr: T[], i: number) => arr[i % arr.length];

  const deviceSpecs: Array<{
    serial: string;
    unitIndex: number;
    categoryIndex: number;
    notes: string;
  }> = [
    {
      serial: 'MECH-ASM-2024-001',
      unitIndex: 0,
      categoryIndex: 0,
      notes: 'مضخة دوران رئيسية — صيانة دورية كل 90 يومًا',
    },
    {
      serial: 'MECH-ASM-2024-002',
      unitIndex: 1,
      categoryIndex: 3,
      notes: 'رافعة شوكية — بطارية ليثيوم',
    },
    {
      serial: 'PKG-LINE-2023-018',
      unitIndex: 2,
      categoryIndex: 2,
      notes: 'وحدة تحكم تعبئة أوتوماتيكية',
    },
    {
      serial: 'HVAC-CT-2024-007',
      unitIndex: 3,
      categoryIndex: 1,
      notes: 'مروحة برج تبريد — اهتزاز خفيف تحت المراقبة',
    },
    {
      serial: 'HVAC-PMP-2024-003',
      unitIndex: 4,
      categoryIndex: 0,
      notes: 'مضخة تدوير مياه التبريد',
    },
    {
      serial: 'IT-SRV-2022-041',
      unitIndex: 5,
      categoryIndex: 4,
      notes: 'خادم تخزين — RAID صحي',
    },
    {
      serial: 'IT-NET-2023-012',
      unitIndex: 6,
      categoryIndex: 4,
      notes: 'محول لب — تحديث برنامج مجدول',
    },
    {
      serial: 'MECH-WLD-2024-005',
      unitIndex: 1,
      categoryIndex: 3,
      notes: 'منظم غاز لحام — فحص تسرب ربع سنوي',
    },
  ];

  const devices = await Promise.all(
    deviceSpecs.map((spec) =>
      prisma.device.create({
        data: {
          serialNumber: spec.serial,
          unitId: pick(allUnits, spec.unitIndex).id,
          categoryId: pick(categories, spec.categoryIndex).id,
          notes: spec.notes,
        },
      }),
    ),
  );

  await prisma.link.createMany({
    data: [
      { name: 'الرقيب', url: 'http://10.10.10.180:9512/' },
      { name: 'إسكان الموظفين', url: 'http://10.10.10.181:22266/' },
      { name: 'نظام الادارة المالية', url: 'http://10.10.10.181:22248/' },
      {
        name: 'نظام العلاوات والترفيعات',
        url: 'http://10.10.10.181:22238/',
      },
      { name: 'إيوان', url: 'http://10.10.10.181:22240/login' },
      { name: 'البرهان', url: 'http://10.10.10.181:22246/' },
      { name: 'الجوار', url: 'http://10.10.10.181:22268/' },
      { name: 'استمارات', url: 'http://10.10.10.180:22244/' },
      { name: 'المؤتمن', url: 'http://10.10.10.180:22234/' },
    ],
  });

  const technicians = [
    'أحمد السيد',
    'فاطمة علي',
    'محمود حسن',
    'نورا خالد',
    'يوسف عمر',
  ];

  const descriptions: string[] = [
    'تسرب زيت خفيف من محور المضخة — تم استبدال الحشية.',
    'اهتزاز غير طبيعي في المروحة — موازنة ديناميكية مجدولة.',
    'انقطاع مفاجئ للشبكة — استبدال كابل فايبر تالف.',
    'تحديث برنامج وحدة التحكم بعد خطأ إدخال/إخراج عابر.',
    'فحص دوري لبرج التبريد — تنظيف الحشو والشفرات.',
    'استبدال فلتر هواء في غرفة الخوادم.',
    'صيانة وقائية لمضخة التدوير — لا أعطال.',
    'إصلاح عطل في قاطع فرعي — إعادة ضبط الحماية.',
    'تنظيف مجمع أتربة على محرك المضخة.',
    'معايرة حساس ضغط في دائرة التبريد.',
    'استبدال رولمان تالف في محور المروحة.',
    'تحديث توقيع شهادة أمان الشبكة.',
    'فحص تسرب في خط التغذية للبرج.',
    'معايرة حساسات غرفة الخوادم.',
    'تجربة تشغيل طارئة بعد الصيانة.',
  ];

  const statuses: MaintenanceStatus[] = [
    MaintenanceStatus.OPEN,
    MaintenanceStatus.IN_PROGRESS,
    MaintenanceStatus.RESOLVED,
    MaintenanceStatus.OPEN,
    MaintenanceStatus.RESOLVED,
    MaintenanceStatus.IN_PROGRESS,
    MaintenanceStatus.RESOLVED,
    MaintenanceStatus.OPEN,
    MaintenanceStatus.RESOLVED,
    MaintenanceStatus.IN_PROGRESS,
    MaintenanceStatus.RESOLVED,
    MaintenanceStatus.OPEN,
    MaintenanceStatus.RESOLVED,
    MaintenanceStatus.IN_PROGRESS,
    MaintenanceStatus.RESOLVED,
  ];

  const partsVariants: Array<PrismaJson.InputJsonValue | null> = [
    [{ name: 'حشية مضخة 4 بوصة', quantity: 1 }],
    [{ name: 'فلتر زيت', quantity: 2 }],
    [{ name: 'كابل فايبر LC-LC 5م', quantity: 1 }],
    [
      { name: 'حشية مطاطية', quantity: 4 },
      { name: 'شحم عالي الحرارة', quantity: 1 },
    ],
    null,
    [{ name: 'فلتر هواء', quantity: 2 }],
    null,
    [{ name: 'صامولة تثبيت M12', quantity: 8 }],
    null,
    [{ name: 'مفاتيح قاطع فرعي', quantity: 1 }],
    [{ name: 'سائل تبريد', quantity: 3 }],
    null,
    [{ name: 'شريط عزل', quantity: 2 }],
    [{ name: 'حساس حرارة', quantity: 1 }],
  ];

  const baseDate = new Date();
  baseDate.setMonth(baseDate.getMonth() - 4);

  for (let i = 0; i < 15; i++) {
    const device = pick(devices, i);
    const dayOffset = 3 + i * 7 + (i % 5);
    const date = new Date(baseDate);
    date.setDate(date.getDate() + dayOffset);

    await prisma.maintenanceRecord.create({
      data: {
        deviceId: device.id,
        description: descriptions[i]!,
        technicianName: pick(technicians, i),
        status: statuses[i]!,
        date,
        partsUsed: partsVariants[i] ?? undefined,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
