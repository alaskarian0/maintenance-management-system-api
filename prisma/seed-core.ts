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
  await prisma.deviceAssignment.deleteMany();
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

  // --- Links (merged: url = frontend, apiUrl = backend) ---
  await prisma.link.createMany({
    data: [
      { name: 'الرقيب', url: 'http://10.10.10.180:9512/' },
      { name: 'إسكان الموظفين', url: 'http://10.10.10.180:22266/' },
      { name: 'استمارات', url: 'http://10.10.10.180:22244/', apiUrl: 'http://10.10.10.180:22243/' },
      { name: 'نظام العلاوات', url: 'http://10.10.10.180:22238/', apiUrl: 'http://10.10.10.180:22237/' },
      { name: 'الجوار', url: 'http://10.10.10.180:22268/', apiUrl: 'http://10.10.10.180:22267/' },
      { name: 'لوحة تحكم الإسكان', url: 'http://10.10.10.180:22240/', apiUrl: 'http://10.10.10.180:22239/' },
      { name: 'الموارد البشرية', url: 'http://10.10.10.180:22246/', apiUrl: 'http://10.10.10.180:22245/' },
      { name: 'نظام الإدارة المالية', url: 'http://10.10.10.180:22248/', apiUrl: 'http://10.10.10.180:22247/' },
      { name: 'المؤتمن', url: 'http://10.10.10.180:22234/' },
      { name: 'سكنة الخدم', url: 'http://10.10.10.180:22266/', apiUrl: 'http://10.10.10.180:22265/' },
      { name: 'الميزانية', url: 'http://10.10.10.180:22256/' },
      { name: 'التصدير', url: 'http://10.10.10.180:22258/', apiUrl: 'http://10.10.10.180:22257/' },
      { name: 'عيادة الأسنان', url: 'http://10.10.10.180:22282/' },
      { name: 'عيادة العيون', url: 'http://10.10.10.180:22281/' },
      { name: 'المستشفى', url: 'http://10.10.10.180:22280/' },
      { name: 'إدارة المخزون', url: 'http://10.10.10.180:22252/', apiUrl: 'http://10.10.10.180:22251/' },
      { name: 'الشؤون القانونية', url: 'http://10.10.10.180:22260/', apiUrl: 'http://10.10.10.180:22259/' },
      { name: 'الأشخاص المفقودين', url: 'http://10.10.10.180:22264/', apiUrl: 'http://10.10.10.180:22263/' },
      { name: 'البوابة الإسلامية', url: 'http://10.10.10.180:22254/' },
      { name: 'المتحف', url: 'http://10.10.10.180:22270/', apiUrl: 'http://10.10.10.180:22269/' },
      { name: 'الرواتب', url: 'http://10.10.10.180:22236/', apiUrl: 'http://10.10.10.180:22235/' },
      { name: 'المشتريات', url: 'http://10.10.10.180:22262/', apiUrl: 'http://10.10.10.180:22261/' },
      { name: 'السكرتارية', url: 'http://10.10.10.180:22272/' },
      { name: 'مركز الأدوات', url: 'http://10.10.10.180:22292/' },
      { name: 'التطوع', url: 'http://10.10.10.180:22242/', apiUrl: 'http://10.10.10.180:22241/' },
      { name: 'الصيانة', url: 'http://10.10.10.180:22274/', apiUrl: 'http://10.10.10.180:22273/' },
      { name: 'الدورات التدريبية', url: 'http://10.10.10.180:22284/' },
      { name: 'الضيافة', url: 'http://10.10.10.180:22286/', apiUrl: 'http://10.10.10.180:22285/' },
      { name: 'العمل اليومي', url: 'http://10.10.10.180:1120/' },
      { name: 'CCTV', url: 'http://10.10.10.180:22236/', apiUrl: 'http://10.10.10.180:22235/' },
    ],
  });
  console.log('[seed:core] Links seeded');

  return allUnits;
}
