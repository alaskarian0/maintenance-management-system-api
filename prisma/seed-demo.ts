/**
 * Demo seed — optional sample data for development/testing.
 * Creates device types, categories, devices, item assignments, and maintenance records.
 * Destructive: clears all demo-related tables before seeding.
 *
 * Set SEED_DEMO=1 (or run `npm run db:seed:demo`) to include this data.
 */
import {
  PrismaClient,
  MaintenanceStatus,
  type Prisma as PrismaJson,
  type Unit,
} from '@prisma/client';

async function wipeDemoScope(prisma: PrismaClient) {
  await prisma.maintenanceRecord.deleteMany();
  await prisma.deviceAssignment.deleteMany();
  await prisma.deviceItem.deleteMany();
  await prisma.device.deleteMany();
  await prisma.category.deleteMany();
  await prisma.deviceType.deleteMany();
}

export async function seedDemo(prisma: PrismaClient, allUnits: Unit[]) {
  console.log('\n[seed:demo] Wiping demo scope (devices, device types, categories, maintenance records)...');
  await wipeDemoScope(prisma);

  if (allUnits.length === 0) {
    console.warn('[seed:demo] No units available — skipping device assignments. Run core seed first.');
  }

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
  console.log(`[seed:demo] Created ${deviceTypes.length} device types with categories`);

  const categories = deviceTypes.flatMap((dt) => dt.categories);

  const pick = <T>(arr: T[], i: number) => arr[i % arr.length];

  const deviceSpecs: Array<{
    name: string;
    categoryIndex: number;
    nature: 'FIXED' | 'CONSUMABLE';
    notes: string;
    serials: string[];
    assignToUnitIndex?: number;
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
  console.log(`[seed:demo] Created ${devices.length} devices (${allItems.length} items)`);

  for (const spec of deviceSpecs) {
    if (spec.assignToUnitIndex !== undefined && allUnits.length > 0) {
      const device = devices.find((d) => d.name === spec.name);
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

  // --- Maintenance Records ---
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
  console.log('[seed:demo] Created 15 maintenance records');
}
