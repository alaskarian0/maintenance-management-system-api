import * as readline from 'readline';

/**
 * Destructive seed: wipes maintenance data, org tree, categories, links (see seed.ts).
 *
 * - Interactive terminal: you must type YES when prompted.
 * - Non-interactive (CI, scripts, some Prisma subprocesses): set SEED_CONFIRM=yes
 */
export async function confirmDestructiveSeed(): Promise<void> {
  const confirmed =
    process.env.SEED_CONFIRM === 'yes' || process.env.SEED_CONFIRM === 'YES';

  if (confirmed) {
    return;
  }

  if (!process.stdin.isTTY) {
    console.error(
      '\n[seed] Refusing to run: no TTY and SEED_CONFIRM is not set.\n' +
        'This seed deletes existing maintenance/org/category/link rows.\n' +
        'Run:  SEED_CONFIRM=yes  npx prisma db seed\n' +
        'Or from PowerShell:  $env:SEED_CONFIRM="yes"; npx prisma db seed\n',
    );
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const line = await new Promise<string>((resolve) => {
    rl.question(
      'سيتم حذف سجلات الصيانة والأجهزة والأقسام/الشعب/الوحدات والتصنيفات والروابط ثم إعادة التعبئة. اكتب YES للمتابعة: ',
      resolve,
    );
  });
  rl.close();

  if (line.trim() !== 'YES') {
    console.log('تم الإلغاء. لم يُنفَّذ أي تغيير.');
    process.exit(0);
  }
}
