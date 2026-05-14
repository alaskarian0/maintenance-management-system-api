import type { PrismaClient, Unit } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

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

interface HierarchyJsonFile {
  source: string;
  field: string;
  count: number;
  unique: string[];
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

function parseHierarchyFromJsonFile(): Map<string, Map<string, Set<string>>> {
  const filePath = join(__dirname, 'data', 'employes2-unique-hierarchy.json');
  const raw = readFileSync(filePath, 'utf-8');
  const json: HierarchyJsonFile = JSON.parse(raw);

  const tree = new Map<string, Map<string, Set<string>>>();

  for (const entry of json.unique) {
    const parts = entry.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    const deptName = parts[0];
    if (!deptName) continue;

    if (!tree.has(deptName)) tree.set(deptName, new Map());
    const divMap = tree.get(deptName)!;

    if (parts.length === 1) {
      // Department with no children — add a "عام" division placeholder
      if (!divMap.has('عام')) divMap.set('عام', new Set());
      continue;
    }

    // Second level = division, everything after = units
    const divName = parts[1];
    if (!divName) continue;
    if (!divMap.has(divName)) divMap.set(divName, new Set());
    const units = divMap.get(divName)!;

    // Collect all deeper levels as unit names
    for (let i = 2; i < parts.length; i++) {
      if (parts[i]) units.add(parts[i]);
    }

    // If the division has no units, at least the division name exists
  }

  return tree;
}

async function createFallbackDepartments(prisma: PrismaClient): Promise<Unit[]> {
  const tree = parseHierarchyFromJsonFile();
  const allUnits: Unit[] = [];

  const sortedDepts = [...tree.keys()].sort((a, b) =>
    a.localeCompare(b, 'ar'),
  );

  console.log(
    `[seed] Fallback: loading ${sortedDepts.length} departments from JSON hierarchy file`,
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
    `[seed] Fallback: created ${sortedDepts.length} departments, ${allUnits.length} units total from JSON file`,
  );
  return allUnits;
}
