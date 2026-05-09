/**
 * Database seed entry point.
 *
 * Runs core seed (admin, users, departments, links) by default.
 * Add SEED_DEMO=1 to also seed demo data (devices, device types, maintenance records).
 *
 * Usage:
 *   npx prisma db seed                        # core only
 *   SEED_DEMO=1 npx prisma db seed            # core + demo
 *   SEED_DEMO=1 SEED_CONFIRM=yes npx prisma db seed  # non-interactive
 *
 * PowerShell:
 *   $env:SEED_DEMO="1"; npx prisma db seed
 *
 * npm scripts:
 *   npm run db:seed          # core only
 *   npm run db:seed:demo     # core + demo
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { confirmDestructiveSeed } from './seedGuard';
import { seedCore } from './seed-core';
import { seedDemo } from './seed-demo';

const prisma = new PrismaClient();

async function main() {
  await confirmDestructiveSeed();

  const includeDemo =
    process.env.SEED_DEMO === '1' ||
    process.env.SEED_DEMO === 'true' ||
    process.env.SEED_DEMO === 'yes';

  console.log(includeDemo
    ? '\n[seed] Running CORE + DEMO seed...'
    : '\n[seed] Running CORE seed only (set SEED_DEMO=1 to include demo data)...');

  const allUnits = await seedCore(prisma);

  if (includeDemo) {
    await seedDemo(prisma, allUnits);
  }

  console.log('\n[seed] Done.');
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
