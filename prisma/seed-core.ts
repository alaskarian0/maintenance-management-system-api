/**
 * Core seed — always runs. Creates admin, baseline users, departments, and links.
 * Destructive: clears departments/divisions/units and links before seeding.
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient, UserRole } from '@prisma/client';
import { seedDepartmentsFromHierarchy } from './hierarchyFromJson';

const SALT_ROUNDS = 10;

async function wipeCoreScope(prisma: PrismaClient) {
  await prisma.link.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.division.deleteMany();
  await prisma.department.deleteMany();
}

export async function seedCore(prisma: PrismaClient) {
  console.log('\n[seed:core] Wiping core scope (links, departments, divisions, units)...');
  await wipeCoreScope(prisma);

  // --- Admin ---
  const admin = await prisma.admin.findFirst();
  if (!admin) {
    const initial = process.env.ADMIN_INITIAL_PASSWORD?.trim() || 'admin';
    await prisma.admin.create({
      data: { passwordHash: await bcrypt.hash(initial, SALT_ROUNDS) },
    });
    console.log('[seed:core] Admin created');
  } else {
    console.log('[seed:core] Admin already exists — skipped');
  }

  // --- Baseline Users ---
  const userInitialPassword =
    process.env.USER_INITIAL_PASSWORD?.trim() || '123456';
  const userPasswordHash = await bcrypt.hash(userInitialPassword, SALT_ROUNDS);

  const seedUsers: Array<{
    userName: string;
    fullName: string;
    role: UserRole;
  }> = [
    { userName: 'admin', fullName: 'مدير النظام', role: UserRole.ADMIN },
    { userName: 'tech.ahmed', fullName: 'أحمد السيد', role: UserRole.TECHNICIAN },
    { userName: 'tech.fatima', fullName: 'فاطمة علي', role: UserRole.TECHNICIAN },
    { userName: 'muntasebeen', fullName: 'منتسبين', role: UserRole.USER },
  ];

  await Promise.all(
    seedUsers.map((u) =>
      prisma.user.upsert({
        where: { userName: u.userName },
        update: { fullName: u.fullName, role: u.role, isActive: true },
        create: {
          userName: u.userName,
          fullName: u.fullName,
          role: u.role,
          passwordHash: userPasswordHash,
          isActive: true,
        },
      }),
    ),
  );
  console.log(`[seed:core] Upserted ${seedUsers.length} users`);

  // --- Departments / Divisions / Units ---
  const allUnits = await seedDepartmentsFromHierarchy(prisma);
  console.log(`[seed:core] Departments seeded (${allUnits.length} units total)`);

  // --- Links ---
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
  console.log('[seed:core] Links seeded');

  return allUnits;
}
