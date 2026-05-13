import * as fs from 'fs';
import * as path from 'path';

const HR_API_BASE_URL = process.env.HR_API_BASE_URL || 'http://192.168.0.31:5000';
const HR_API_KEY = process.env.HR_API_KEY || 'hr-maintenance-dev-key-2024';

export interface HrWorkplaceEntity {
  id: number;
  name: string;
  entityCode: string;
}

export interface HrEmployee {
  id: number;
  code: number;
  fullName: string | null;
  phoneNumber: string | null;
  isHoused: boolean | null;
  location: {
    governate: string | null;
    region: 'southern' | 'middle' | 'northern' | 'current' | null;
  };
  birthDate: string | null;
  hiringDate: string | null;
  workplace: {
    department: HrWorkplaceEntity | null;
    division: HrWorkplaceEntity | null;
    unit: HrWorkplaceEntity | null;
  };
  workingStatus: 'working' | 'retired' | 'resigned' | 'fired' | null;
}

interface HrEmployeesResponse {
  success: boolean;
  data: HrEmployee[];
}

async function fetchEmployees(): Promise<HrEmployee[]> {
  const url = `${HR_API_BASE_URL}/maintenance/employees`;
  console.log(`Fetching employees from: ${url}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': HR_API_KEY,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`HR API returned ${response.status}: ${response.statusText}`);
  }

  const json = (await response.json()) as HrEmployeesResponse;

  if (!json.success || !Array.isArray(json.data)) {
    throw new Error('Invalid response format from HR API');
  }

  return json.data;
}

async function main() {
  try {
    const employees = await fetchEmployees();
    console.log(`Fetched ${employees.length} employees`);

    const outputPath = path.join(
      process.cwd(),
      'prisma',
      'data',
      'employees-hr.json',
    );

    const output = {
      fetchedAt: new Date().toISOString(),
      source: `${HR_API_BASE_URL}/maintenance/employees`,
      count: employees.length,
      data: employees,
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`Saved to: ${outputPath}`);

    // Print sample
    if (employees.length > 0) {
      console.log('\nSample employee:');
      console.log(JSON.stringify(employees[0], null, 2));
    }
  } catch (error) {
    console.error('Failed to fetch employees:', error);
    process.exit(1);
  }
}

main();
