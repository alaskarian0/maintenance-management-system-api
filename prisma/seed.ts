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
  SystemType,
  Prisma,
  type Prisma as PrismaJson,
} from '@prisma/client';
import { seedDepartmentsFromHierarchy } from './hierarchyFromJson';
import { confirmDestructiveSeed } from './seedGuard';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

async function wipeSeedScope(tx: Prisma.TransactionClient) {
  await tx.maintenanceRecord.deleteMany();
  await tx.deviceAssignment.deleteMany();
  await tx.deviceItem.deleteMany();
  await tx.device.deleteMany();
  await tx.unit.deleteMany();
  await tx.division.deleteMany();
  await tx.department.deleteMany();
  await tx.category.deleteMany();
  await tx.deviceType.deleteMany();
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

  const allUnits = await seedDepartmentsFromHierarchy(prisma);

  const deviceTypes = await Promise.all([
    prisma.deviceType.create({
      data: {
        name: 'معدات ميكانيكية',
        categories: {
          create: [
            { name: 'مضخات ومحركات' },
            { name: 'توربينات وضواغط' },
            { name: 'معدات لحام' },
          ],
        },
      },
      include: { categories: true },
    }),
    prisma.deviceType.create({
      data: {
        name: 'تكييف وتبريد',
        categories: {
          create: [
            { name: 'وحدات تكييف' },
            { name: 'أبراج تبريد' },
            { name: 'مبردات مياه' },
          ],
        },
      },
      include: { categories: true },
    }),
    prisma.deviceType.create({
      data: {
        name: 'أنظمة تحكم وPLC',
        categories: {
          create: [
            { name: 'وحدات PLC' },
            { name: 'حساسات ومقاييس' },
            { name: 'لوحات تحكم' },
          ],
        },
      },
      include: { categories: true },
    }),
    prisma.deviceType.create({
      data: {
        name: 'معدات ثقيلة',
        categories: {
          create: [
            { name: 'رافعات وشواحن' },
            { name: 'معدات نقل' },
            { name: 'معدات حفريات' },
          ],
        },
      },
      include: { categories: true },
    }),
    prisma.deviceType.create({
      data: {
        name: 'شبكات وتقنية معلومات',
        categories: {
          create: [
            { name: 'خوادم وتخزين' },
            { name: 'معدات شبكات' },
            { name: 'أجهزة حاسب' },
            { name: 'كاميرات مراقبة' },
          ],
        },
      },
      include: { categories: true },
    }),
  ]);

  // Flatten all categories for device seeding
  const categories = deviceTypes.flatMap((dt) => dt.categories);

  const pick = <T>(arr: T[], i: number) => arr[i % arr.length];

  // Seed devices as products with multiple items each
  const deviceSpecs: Array<{
    name: string;
    categoryIndex: number;
    nature: 'FIXED' | 'CONSUMABLE';
    notes: string;
    serials: string[];
    assignToUnitIndex?: number; // first serial gets assigned to this unit
  }> = [
    {
      name: 'مضخة دوران رئيسية',
      categoryIndex: 0,
      nature: 'FIXED',
      notes: 'صيانة دورية كل 90 يومًا',
      serials: ['MECH-ASM-2024-001', 'MECH-ASM-2024-002', 'MECH-ASM-2024-003'],
      assignToUnitIndex: 0,
    },
    {
      name: 'رافعة شوكية',
      categoryIndex: 3,
      nature: 'FIXED',
      notes: 'بطارية ليثيوم',
      serials: ['MECH-HEV-2024-001', 'MECH-HEV-2024-002'],
      assignToUnitIndex: 1,
    },
    {
      name: 'وحدة تحكم تعبئة',
      categoryIndex: 2,
      nature: 'FIXED',
      notes: 'وحدة تحكم تعبئة أوتوماتيكية',
      serials: ['PLC-CTL-2023-018'],
      assignToUnitIndex: 2,
    },
    {
      name: 'مروحة برج تبريد',
      categoryIndex: 1,
      nature: 'FIXED',
      notes: 'اهتزاز خفيف تحت المراقبة',
      serials: ['HVAC-CT-2024-007', 'HVAC-CT-2024-008'],
      assignToUnitIndex: 3,
    },
    {
      name: 'مضخة تدوير مياه التبريد',
      categoryIndex: 0,
      nature: 'FIXED',
      notes: 'مضخة تدوير مياه التبريد',
      serials: ['HVAC-PMP-2024-003'],
      assignToUnitIndex: 4,
    },
    {
      name: 'خادم تخزين',
      categoryIndex: 4,
      nature: 'FIXED',
      notes: 'RAID صحي',
      serials: ['IT-SRV-2022-041', 'IT-SRV-2022-042', 'IT-SRV-2022-043'],
      assignToUnitIndex: 5,
    },
    {
      name: 'محول شبكة لب',
      categoryIndex: 4,
      nature: 'FIXED',
      notes: 'تحديث برنامج مجدول',
      serials: ['IT-NET-2023-012'],
      assignToUnitIndex: 6,
    },
    {
      name: 'منظم غاز لحام',
      categoryIndex: 2,
      nature: 'CONSUMABLE',
      notes: 'فحص تسرب ربع سنوي',
      serials: ['MECH-WLD-2024-005', 'MECH-WLD-2024-006'],
      assignToUnitIndex: 1,
    },
  ];

  const devices = [];
  const allItems: { id: string; serialNumber: string }[] = [];

  for (const spec of deviceSpecs) {
    const device = await prisma.device.create({
      data: {
        name: spec.name,
        categoryId: pick(categories, spec.categoryIndex).id,
        nature: spec.nature,
        notes: spec.notes,
        items: {
          create: spec.serials.map((s) => ({ serialNumber: s })),
        },
      },
      include: { items: true },
    });
    devices.push(device);
    allItems.push(...device.items);
  }

  // Assign first items of some devices to units
  for (const spec of deviceSpecs) {
    if (spec.assignToUnitIndex !== undefined) {
      const device = devices.find(
        (d) => d.name === spec.name,
      );
      if (!device || device.items.length === 0) continue;
      const item = device.items[0];
      const unit = pick(allUnits, spec.assignToUnitIndex);
      await prisma.deviceAssignment.create({
        data: { itemId: item.id, unitId: unit.id },
      });
      await prisma.deviceItem.update({
        where: { id: item.id },
        data: { status: 'ASSIGNED' },
      });
    }
  }

  await prisma.link.createMany({
    data: [
      { name: 'الرقيب', url: 'http://10.10.10.180:9512/', systemType: 'API' },
      { name: 'إسكان الموظفين', url: 'http://10.10.10.181:22266/', systemType: 'FRONTEND' },
      { name: 'استمارات', url: 'http://10.10.10.181:22244/', systemType: 'FRONTEND' },
      { name: 'نظام العلاوات', url: 'http://10.10.10.181:22238/', systemType: 'FRONTEND' },
      { name: 'الجوار', url: 'http://10.10.10.181:22267/', systemType: 'FRONTEND' },
      { name: 'إيوان', url: 'http://10.10.10.181:22240/', systemType: 'FRONTEND' },
      { name: 'البرهان', url: 'http://10.10.10.181:22246/', systemType: 'FRONTEND' },
      { name: 'نظام الادارة المالية', url: 'http://10.10.10.181:22248/', systemType: 'FRONTEND' },
      { name: 'المؤتمن', url: 'http://10.10.10.181:22234/', systemType: 'FRONTEND' },
      { name: 'سكنة الخدم', url: 'http://10.10.10.181:22265/', systemType: 'API' },
      { name: 'المحاسبة API', url: 'http://10.10.10.181:22247/', systemType: 'API' },
      { name: 'الميزانية', url: 'http://10.10.10.181:22256/', systemType: 'FRONTEND' },
      { name: 'التصدير API', url: 'http://10.10.10.181:22257/', systemType: 'API' },
      { name: 'التصدير', url: 'http://10.10.10.181:22258/', systemType: 'FRONTEND' },
      { name: 'عيادة الأسنان', url: 'http://10.10.10.181:22282/', systemType: 'FRONTEND' },
      { name: 'عيادة العيون', url: 'http://10.10.10.181:22281/', systemType: 'FRONTEND' },
      { name: 'استمارات API', url: 'http://10.10.10.181:22243/', systemType: 'API' },
      { name: 'المستشفى', url: 'http://10.10.10.181:22280/', systemType: 'FRONTEND' },
      { name: 'لوحة تحكم الإسكان', url: 'http://10.10.10.181:22240/', systemType: 'FRONTEND' },
      { name: 'الموارد البشرية', url: 'http://10.10.10.181:22246/', systemType: 'FRONTEND' },
      { name: 'الموارد البشرية API', url: 'http://10.10.10.181:22245/', systemType: 'API' },
      { name: 'المخزون API', url: 'http://10.10.10.181:22251/', systemType: 'API' },
      { name: 'إدارة المخزون', url: 'http://10.10.10.181:22252/', systemType: 'FRONTEND' },
      { name: 'الشؤون القانونية API', url: 'http://10.10.10.181:22259/', systemType: 'API' },
      { name: 'الشؤون القانونية', url: 'http://10.10.10.181:22260/', systemType: 'FRONTEND' },
      { name: 'الأشخاص المفقودين', url: 'http://10.10.10.181:4000/', systemType: 'FRONTEND' },
      { name: 'الصيانة API', url: 'http://10.10.10.181:22273/', systemType: 'API' },
      { name: 'الصيانة', url: 'http://10.10.10.181:22274/', systemType: 'FRONTEND' },
      { name: 'البوابة الإسلامية', url: 'http://10.10.10.181:22254/', systemType: 'FRONTEND' },
      { name: 'المتحف API', url: 'http://10.10.10.181:22269/', systemType: 'API' },
      { name: 'المتحف', url: 'http://10.10.10.181:22270/', systemType: 'FRONTEND' },
      { name: 'الرواتب API', url: 'http://10.10.10.181:22235/', systemType: 'API' },
      { name: 'الرواتب', url: 'http://10.10.10.181:22236/', systemType: 'FRONTEND' },
      { name: 'المشتريات API', url: 'http://10.10.10.181:22261/', systemType: 'API' },
      { name: 'المشتريات', url: 'http://10.10.10.181:22262/', systemType: 'FRONTEND' },
      { name: 'الترقيات API', url: 'http://10.10.10.181:22237/', systemType: 'API' },
      { name: 'السكرتارية', url: 'http://10.10.10.181:22272/', systemType: 'FRONTEND' },
      { name: 'مركز الأدوات', url: 'http://10.10.10.181:22292/', systemType: 'FRONTEND' },
      { name: 'التطوع API', url: 'http://10.10.10.181:22241/', systemType: 'API' },
      { name: 'التطوع', url: 'http://10.10.10.181:22242/', systemType: 'FRONTEND' },
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
    const item = pick(allItems, i);
    const dayOffset = 3 + i * 7 + (i % 5);
    const date = new Date(baseDate);
    date.setDate(date.getDate() + dayOffset);

    await prisma.maintenanceRecord.create({
      data: {
        itemId: item.id,
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
