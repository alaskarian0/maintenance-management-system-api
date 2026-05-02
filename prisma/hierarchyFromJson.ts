import * as fs from 'fs';
import * as path from 'path';
import type { PrismaClient, Unit } from '@prisma/client';

/** Same delimiter as in employes2-unique-hierarchy.json paths */
const PATH_SPLIT = '  -  ';

const INACTIVE_MARKER = '( المنقطعين عن العمل )';

export type HierarchyTriple = {
  department: string;
  division: string;
  unit: string;
};

export function parseHierarchyJson(
  raw: string,
  options?: { excludeInactive?: boolean },
): HierarchyTriple[] {
  const excludeInactive = options?.excludeInactive !== false;
  const doc = JSON.parse(raw) as { unique?: string[] };
  const paths = doc.unique ?? [];
  const triples: HierarchyTriple[] = [];

  for (const line of paths) {
    if (!line || typeof line !== 'string') continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (excludeInactive && trimmed.includes(INACTIVE_MARKER)) continue;

    const parts = trimmed
      .split(PATH_SPLIT)
      .map((p) => p.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (parts.length === 0) continue;

    if (parts.length === 1) {
      triples.push({
        department: parts[0],
        division: 'عام',
        unit: 'عام',
      });
    } else if (parts.length === 2) {
      triples.push({
        department: parts[0],
        division: parts[1],
        unit: 'عام',
      });
    } else {
      triples.push({
        department: parts[0],
        division: parts[1],
        unit: parts.slice(2).join(' - '),
      });
    }
  }

  return triples;
}

/** Merge triples into dept → division → set(units), deduped */
export function buildHierarchyTree(
  triples: HierarchyTriple[],
): Map<string, Map<string, Set<string>>> {
  const tree = new Map<string, Map<string, Set<string>>>();
  for (const t of triples) {
    if (!tree.has(t.department)) tree.set(t.department, new Map());
    const divMap = tree.get(t.department)!;
    if (!divMap.has(t.division)) divMap.set(t.division, new Set());
    const u = t.unit.trim();
    if (u) divMap.get(t.division)!.add(u);
  }
  return tree;
}

export async function seedDepartmentsFromHierarchyJson(
  prisma: PrismaClient,
  options?: { excludeInactive?: boolean },
): Promise<Unit[]> {
  const excludeInactive = options?.excludeInactive !== false;
  const jsonPath = path.join(
    process.cwd(),
    'prisma',
    'data',
    'employes2-unique-hierarchy.json',
  );
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const triples = parseHierarchyJson(raw, { excludeInactive });
  const tree = buildHierarchyTree(triples);

  const allUnits: Unit[] = [];
  const sortedDepts = [...tree.keys()].sort((a, b) => a.localeCompare(b, 'ar'));

  for (const deptName of sortedDepts) {
    if (!deptName.trim()) continue;
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

  return allUnits;
}
