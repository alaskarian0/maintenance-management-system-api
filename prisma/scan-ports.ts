/**
 * Port Scanner (Fast) — detects which IP each system is active on.
 * Usage:  npx tsx prisma/scan-ports.ts
 * 
 * All checks run in parallel. Expected time: ~2-3 seconds total.
 */

const IPS = ['10.10.10.180', '10.10.10.181'];
const TIMEOUT_MS = 2000;

interface PortCheck {
  name: string;
  port: number;
}

const SYSTEMS: PortCheck[] = [
  { name: 'الرقيب', port: 9512 },
  { name: 'إسكان الموظفين', port: 22266 },
  { name: 'استمارات (frontend)', port: 22244 },
  { name: 'استمارات (api)', port: 22243 },
  { name: 'نظام العلاوات (frontend)', port: 22238 },
  { name: 'نظام العلاوات (api)', port: 22237 },
  { name: 'الجوار (frontend)', port: 22268 },
  { name: 'الجوار (api)', port: 22267 },
  { name: 'لوحة تحكم الإسكان (frontend)', port: 22240 },
  { name: 'لوحة تحكم الإسكان (api)', port: 22239 },
  { name: 'الموارد البشرية (frontend)', port: 22246 },
  { name: 'الموارد البشرية (api)', port: 22245 },
  { name: 'نظام الإدارة المالية (frontend)', port: 22248 },
  { name: 'نظام الإدارة المالية (api)', port: 22247 },
  { name: 'المؤتمن', port: 22234 },
  { name: 'سكنة الخدم (frontend)', port: 22266 },
  { name: 'سكنة الخدم (api)', port: 22265 },
  { name: 'الميزانية', port: 22256 },
  { name: 'التصدير (frontend)', port: 22258 },
  { name: 'التصدير (api)', port: 22257 },
  { name: 'عيادة الأسنان', port: 22282 },
  { name: 'عيادة العيون', port: 22281 },
  { name: 'المستشفى', port: 22280 },
  { name: 'إدارة المخزون (frontend)', port: 22252 },
  { name: 'إدارة المخزون (api)', port: 22251 },
  { name: 'الشؤون القانونية (frontend)', port: 22260 },
  { name: 'الشؤون القانونية (api)', port: 22259 },
  { name: 'الأشخاص المفقودين (frontend)', port: 22264 },
  { name: 'الأشخاص المفقودين (api)', port: 22263 },
  { name: 'البوابة الإسلامية', port: 22254 },
  { name: 'المتحف (frontend)', port: 22270 },
  { name: 'المتحف (api)', port: 22269 },
  { name: 'الرواتب (frontend)', port: 22236 },
  { name: 'الرواتب (api)', port: 22235 },
  { name: 'المشتريات (frontend)', port: 22262 },
  { name: 'المشتريات (api)', port: 22261 },
  { name: 'السكرتارية', port: 22272 },
  { name: 'مركز الأدوات', port: 22292 },
  { name: 'التطوع (frontend)', port: 22242 },
  { name: 'التطوع (api)', port: 22241 },
  { name: 'الصيانة (frontend)', port: 22274 },
  { name: 'الصيانة (api)', port: 22273 },
  { name: 'الدورات التدريبية', port: 22284 },
  { name: 'الضيافة (frontend)', port: 22286 },
  { name: 'الضيافة (api)', port: 22285 },
  { name: 'العمل اليومي', port: 1120 },
  { name: 'CCTV (frontend)', port: 22236 },
  { name: 'CCTV (api)', port: 22235 },
];

async function checkHttp(ip: string, port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`http://${ip}:${port}/`, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'PortScanner/1.0' },
    });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

async function main() {
  const start = Date.now();
  console.log(`\n  Scanning ${SYSTEMS.length} ports on ${IPS.join(' & ')} ...`);

  // Fire ALL checks in parallel — 96 simultaneous requests
  const allPromises = SYSTEMS.map(async (sys) => {
    const [on180, on181] = await Promise.all([
      checkHttp('10.10.10.180', sys.port),
      checkHttp('10.10.10.181', sys.port),
    ]);
    return { name: sys.name, port: sys.port, on180, on181 };
  });

  const results = await Promise.all(allPromises);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // Table
  console.log(`\n  Done in ${elapsed}s\n`);
  const w = 40;
  console.log(`| ${'System'.padEnd(w)} | ${'Port'.padStart(6)} |  ${'180'.padEnd(4)} |  ${'181'.padEnd(4)} | ${'Use IP'.padEnd(16)} |`);
  console.log(`| ${'-'.repeat(w)} | ${'-'.repeat(6)} | ${'-'.repeat(6)} | ${'-'.repeat(6)} | ${'-'.repeat(16)} |`);

  for (const r of results) {
    const c180 = r.on180 ? ' OK ' : ' -- ';
    const c181 = r.on181 ? ' OK ' : ' -- ';
    const ip = r.on180 && r.on181 ? '180 & 181' : r.on180 ? '10.10.10.180' : r.on181 ? '10.10.10.181' : 'NOT FOUND';
    console.log(`| ${r.name.padEnd(w)} | ${String(r.port).padStart(6)} | ${c180} | ${c181} | ${ip.padEnd(16)} |`);
  }

  console.log(`| ${'-'.repeat(w)} | ${'-'.repeat(6)} | ${'-'.repeat(6)} | ${'-'.repeat(6)} | ${'-'.repeat(16)} |`);

  // Summary
  const on180 = results.filter((r) => r.on180 && !r.on181);
  const on181 = results.filter((r) => r.on181 && !r.on180);
  const onBoth = results.filter((r) => r.on180 && r.on181);
  const onNone = results.filter((r) => !r.on180 && !r.on181);

  console.log(`\n  SUMMARY (${elapsed}s)`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  10.10.10.180 only : ${on180.length}`);
  console.log(`  10.10.10.181 only : ${on181.length}`);
  console.log(`  Both IPs          : ${onBoth.length}`);
  console.log(`  Not found         : ${onNone.length}`);

  if (on181.length) {
    console.log(`\n  !! On 181 only (need seed fix):`);
    for (const r of on181) console.log(`     - ${r.name} :${r.port}`);
  }
  if (onNone.length) {
    console.log(`\n  xx Down on both:`);
    for (const r of onNone) console.log(`     - ${r.name} :${r.port}`);
  }

  console.log(`\n  Active: ${on180.length + on181.length + onBoth.length} / ${results.length}\n`);
}

main().catch(console.error);
