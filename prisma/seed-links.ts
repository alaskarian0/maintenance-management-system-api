/**
 * Links-only seed — upserts links without touching any other data.
 * Safe to run anytime — does NOT drop departments, users, access control, etc.
 *
 * Usage:  npx tsx prisma/seed-links.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const LINKS = [
  // 10.10.10.180 only
  { name: 'الرقيب', url: 'http://10.10.10.180:9512/' },
  { name: 'المؤتمن', url: 'http://10.10.10.180:22234/' },
  { name: 'العمل اليومي', url: 'http://10.10.10.180:1120/' },

  // 10.10.10.181 only
  { name: 'إسكان الموظفين', url: 'http://10.10.10.181:22266/' },
  { name: 'استمارات', url: 'http://10.10.10.181:22244/', apiUrl: 'http://10.10.10.181:22243/' },
  { name: 'نظام العلاوات', url: 'http://10.10.10.181:22238/', apiUrl: 'http://10.10.10.181:22237/' },
  { name: 'الجوار', url: 'http://10.10.10.181:22268/', apiUrl: 'http://10.10.10.181:22267/' },
  { name: 'لوحة تحكم الإسكان', url: 'http://10.10.10.181:22240/', apiUrl: 'http://10.10.10.181:22239/' },
  { name: 'الموارد البشرية', url: 'http://10.10.10.181:22246/', apiUrl: 'http://10.10.10.181:22245/' },
  { name: 'نظام الإدارة المالية', url: 'http://10.10.10.181:22248/', apiUrl: 'http://10.10.10.181:22247/' },
  { name: 'سكنة الخدم', url: 'http://10.10.10.181:22266/', apiUrl: 'http://10.10.10.181:22265/' },
  { name: 'الميزانية', url: 'http://10.10.10.181:22256/' },
  { name: 'التصدير', url: 'http://10.10.10.181:22258/', apiUrl: 'http://10.10.10.181:22257/' },
  { name: 'عيادة الأسنان', url: 'http://10.10.10.181:22282/' },
  { name: 'عيادة العيون', url: 'http://10.10.10.181:22281/' },
  { name: 'المستشفى', url: 'http://10.10.10.181:22280/' },
  { name: 'إدارة المخزون', url: 'http://10.10.10.181:22252/', apiUrl: 'http://10.10.10.181:22251/' },
  { name: 'الشؤون القانونية', url: 'http://10.10.10.181:22260/', apiUrl: 'http://10.10.10.181:22259/' },
  { name: 'الأشخاص المفقودين', url: 'http://10.10.10.181:22264/', apiUrl: 'http://10.10.10.181:22263/' },
  { name: 'البوابة الإسلامية', url: 'http://10.10.10.181:22254/' },
  { name: 'المتحف', url: 'http://10.10.10.181:22270/', apiUrl: 'http://10.10.10.181:22269/' },
  { name: 'المشتريات', url: 'http://10.10.10.181:22262/', apiUrl: 'http://10.10.10.181:22261/' },
  { name: 'مركز الأدوات', url: 'http://10.10.10.181:22292/' },
  { name: 'الصيانة', url: 'http://10.10.10.181:22274/', apiUrl: 'http://10.10.10.181:22273/' },
  { name: 'الدورات التدريبية', url: 'http://10.10.10.181:22284/' },
  { name: 'الضيافة', url: 'http://10.10.10.181:22286/', apiUrl: 'http://10.10.10.181:22285/' },

  // Both IPs — using 180
  { name: 'الرواتب', url: 'http://10.10.10.180:22236/', apiUrl: 'http://10.10.10.180:22235/' },
  { name: 'التطوع', url: 'http://10.10.10.180:22242/', apiUrl: 'http://10.10.10.180:22241/' },
  { name: 'CCTV', url: 'http://10.10.10.180:22236/', apiUrl: 'http://10.10.10.180:22235/' },
];

const prisma = new PrismaClient();

async function main() {
  console.log('\n[seed:links] Upserting links (safe — no data deleted)...\n');

  const existing = await prisma.link.findMany();
  const byName = new Map(existing.map((l) => [l.name, l]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const link of LINKS) {
    const existingLink = byName.get(link.name);

    if (!existingLink) {
      // Create new
      await prisma.link.create({
        data: { name: link.name, url: link.url, apiUrl: link.apiUrl ?? null },
      });
      created++;
      console.log(`  + ${link.name} → ${link.url}`);
    } else {
      // Check if update needed
      const needsUpdate =
        existingLink.url !== link.url ||
        (existingLink.apiUrl ?? null) !== (link.apiUrl ?? null);

      if (needsUpdate) {
        await prisma.link.update({
          where: { id: existingLink.id },
          data: { url: link.url, apiUrl: link.apiUrl ?? null },
        });
        updated++;
        console.log(`  ~ ${link.name} → ${link.url} (updated)`);
      } else {
        unchanged++;
      }
    }
  }

  // Remove links that are no longer in the list
  const seedNames = new Set(LINKS.map((l) => l.name));
  const stale = existing.filter((l) => !seedNames.has(l.name));
  for (const s of stale) {
    await prisma.link.delete({ where: { id: s.id } });
    console.log(`  - ${s.name} (removed)`);
  }

  console.log(`\n[seed:links] Done: ${created} created, ${updated} updated, ${unchanged} unchanged, ${stale.length} removed\n`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
