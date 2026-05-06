import type { PrismaClient, Unit } from '@prisma/client';

interface HierarchyEntity {
  id: number;
  name: string;
  entityCode: string;
  type: 'DEPARTMENT' | 'DIVISION' | 'WORKSHOP' | 'UNIT';
  isTerminated: boolean;
  parentId: number | null;
  children: HierarchyEntity[];
}

interface HierarchyResponse {
  success: boolean;
  data: HierarchyEntity[];
}

async function fetchHierarchy(): Promise<HierarchyEntity[]> {
  const url =
    process.env.HIERARCHY_SYNC_URL ||
    'http://192.168.0.31:5000/job-information/hierarchy-entities/full';

  console.log(`[seed] Fetching hierarchy from ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`External API returned ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as HierarchyResponse;
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error('Invalid response format from external API');
  }
  console.log(
    `[seed] Fetched ${json.data.length} root entities from external API`,
  );
  return json.data;
}

function processEntity(
  entity: HierarchyEntity,
  departmentId: string | null,
  tree: Map<string, Map<string, Set<string>>>,
) {
  if (entity.isTerminated) return;

  if (entity.type === 'DEPARTMENT' && departmentId === null) {
    // Top-level department
    const deptName = entity.name.trim();
    if (!deptName) return;
    if (!tree.has(deptName)) tree.set(deptName, new Map());
    const divMap = tree.get(deptName)!;

    for (const child of entity.children) {
      processChild(child, divMap);
    }
  }
}

function processChild(
  entity: HierarchyEntity,
  divMap: Map<string, Set<string>>,
) {
  if (entity.isTerminated) return;

  if (entity.type === 'DIVISION' || entity.type === 'WORKSHOP') {
    const divName = entity.name.trim();
    if (!divName) return;
    if (!divMap.has(divName)) divMap.set(divName, new Set());
    const units = divMap.get(divName)!;

    for (const child of entity.children) {
      if (child.isTerminated) continue;
      const unitName = child.name.trim();
      if (unitName) units.add(unitName);

      // Process deeper nesting as units too
      if (child.children?.length) {
        collectUnitsDeep(child.children, units);
      }
    }
  } else if (entity.type === 'UNIT') {
    // Unit directly under department — create a "عام" division
    const divName = 'عام';
    if (!divMap.has(divName)) divMap.set(divName, new Set());
    const units = divMap.get(divName)!;
    const unitName = entity.name.trim();
    if (unitName) units.add(unitName);

    if (entity.children?.length) {
      collectUnitsDeep(entity.children, units);
    }
  } else if (entity.type === 'DEPARTMENT') {
    // Nested department under a department — treat as a division
    const divName = entity.name.trim();
    if (!divName) return;
    if (!divMap.has(divName)) divMap.set(divName, new Set());
    const units = divMap.get(divName)!;

    for (const child of entity.children) {
      if (child.isTerminated) continue;
      if (child.type === 'UNIT' || child.type === 'WORKSHOP' || child.type === 'DIVISION') {
        const unitName = child.name.trim();
        if (unitName) units.add(unitName);
      }
      if (child.children?.length) {
        collectUnitsDeep(child.children, units);
      }
    }
  }
}

function collectUnitsDeep(
  children: HierarchyEntity[],
  units: Set<string>,
) {
  for (const child of children) {
    if (child.isTerminated) continue;
    const name = child.name.trim();
    if (name) units.add(name);
    if (child.children?.length) {
      collectUnitsDeep(child.children, units);
    }
  }
}

export async function seedDepartmentsFromHierarchy(
  prisma: PrismaClient,
): Promise<Unit[]> {
  let rootEntities: HierarchyEntity[];
  try {
    rootEntities = await fetchHierarchy();
  } catch {
    console.log('[seed] External hierarchy API unreachable — creating fallback departments');
    return createFallbackDepartments(prisma);
  }

  // Build dept → division → set(units) tree
  const tree = new Map<string, Map<string, Set<string>>>();

  for (const entity of rootEntities) {
    processEntity(entity, null, tree);
  }

  // Create all departments, divisions, and units
  const allUnits: Unit[] = [];
  const sortedDepts = [...tree.keys()].sort((a, b) =>
    a.localeCompare(b, 'ar'),
  );

  console.log(
    `[seed] Creating ${sortedDepts.length} departments with divisions and units...`,
  );

  for (const deptName of sortedDepts) {
    const divMap = tree.get(deptName)!;
    const sortedDivs = [...divMap.keys()]
      .filter((dn) => (divMap.get(dn)?.size ?? 0) > 0)
      .sort((a, b) => a.localeCompare(b, 'ar'));

    if (sortedDivs.length === 0) continue;

    const created = await prisma.department.create({
      data: {
        name: deptName,
        divisions: {
          create: sortedDivs.map((divName) => {
            const unitNames = [...divMap.get(divName)!].sort((a, b) =>
              a.localeCompare(b, 'ar'),
            );
            return {
              name: divName,
              units: {
                create: unitNames.map((unitName) => ({ name: unitName })),
              },
            };
          }),
        },
      },
      include: { divisions: { include: { units: true } } },
    });

    allUnits.push(...created.divisions.flatMap((d) => d.units));
  }

  console.log(
    `[seed] Created ${sortedDepts.length} departments, ${allUnits.length} units total`,
  );

  return allUnits;
}

async function createFallbackDepartments(prisma: PrismaClient): Promise<Unit[]> {
  const departments = [
    {
      name: 'الصيانة العامة',
      divisions: [
        { name: 'المعدات الميكانيكية', units: ['مضخات', 'محركات', 'توربينات'] },
        { name: 'الكهرباء', units: ['لوحات كهربائية', 'كابلات'] },
      ],
    },
    {
      name: 'تقنية المعلومات',
      divisions: [
        { name: 'الشبكات', units: ['خوادم', 'سويتشات'] },
        { name: 'الدعم الفني', units: ['أجهزة حاسب', 'طابعات'] },
      ],
    },
    {
      name: 'التشغيل والإنتاج',
      divisions: [
        { name: 'التعبئة والتغليف', units: ['خط إنتاج ١', 'خط إنتاج ٢'] },
        { name: 'الجودة', units: ['معايرة', 'فحص'] },
      ],
    },
  ];

  const allUnits: Unit[] = [];

  for (const dept of departments) {
    const created = await prisma.department.create({
      data: {
        name: dept.name,
        divisions: {
          create: dept.divisions.map((div) => ({
            name: div.name,
            units: { create: div.units.map((u) => ({ name: u })) },
          })),
        },
      },
      include: { divisions: { include: { units: true } } },
    });
    allUnits.push(...created.divisions.flatMap((d) => d.units));
  }

  console.log(`[seed] Created ${departments.length} fallback departments, ${allUnits.length} units total`);
  return allUnits;
}
