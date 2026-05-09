import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface EmployeeEntry {
  'تسلسل الموظف': number;
  'الإسم الرباعي': string;
  'الهيكلية': string;
  'الوجبة': string | null;
}

export interface ResidentEntry {
  id: number;
  fullName: string;
  dateOfBirth: string | null;
  gender: string | null;
  phoneNumber: string | null;
  notes: string;
  kinship: string;
  familyId: number;
  familyAddress: string;
}

interface EmployeesJson {
  name: string;
  headers: string[];
  data: EmployeeEntry[];
}

interface FamilyMember {
  id: number;
  familyID: number;
  fullName: string;
  motherName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phoneNumber: string | null;
  notes: string;
  kinship: number;
  kinshipRelation: { id: number; title: string } | null;
  deletedAt?: string | null;
}

interface Family {
  id: number;
  currentResidentialAddress: string;
  propertyType: string;
  status: boolean;
  familyMembers: FamilyMember[];
}

interface FamiliesResponse {
  status: string;
  totalFamilies: number;
  data: Family[];
}

@Injectable()
export class PersonSearchService {
  private employeesCache: EmployeeEntry[] | null = null;
  private employeesCacheAt = 0;
  private residentsCache: ResidentEntry[] | null = null;
  private residentsCacheAt = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000;

  searchEmployees(query: string): EmployeeEntry[] {
    const data = this.loadEmployees();

    if (!query || query.trim().length < 1) {
      return data;
    }

    const q = query.trim().toLowerCase();
    return data.filter((emp) => {
      const name = emp['الإسم الرباعي']?.toLowerCase() || '';
      const id = String(emp['تسلسل الموظف'] || '');
      return name.includes(q) || id.includes(q);
    });
  }

  async searchResidents(query: string): Promise<ResidentEntry[]> {
    const residents = await this.loadResidents();

    if (!query || query.trim().length < 1) {
      return residents;
    }

    const q = query.trim().toLowerCase();
    return residents.filter((r) => {
      const name = r.fullName?.toLowerCase() || '';
      const id = String(r.id);
      const phone = r.phoneNumber?.toLowerCase() || '';
      return name.includes(q) || id.includes(q) || phone.includes(q);
    });
  }

  private loadEmployees(): EmployeeEntry[] {
    const now = Date.now();
    if (this.employeesCache && now - this.employeesCacheAt < this.CACHE_TTL) {
      return this.employeesCache;
    }

    const jsonPath = path.join(
      process.cwd(),
      'prisma',
      'data',
      'employes2.json',
    );
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const doc = JSON.parse(raw) as EmployeesJson;

    this.employeesCache = doc.data;
    this.employeesCacheAt = now;
    return doc.data;
  }

  private async loadResidents(): Promise<ResidentEntry[]> {
    const now = Date.now();
    if (this.residentsCache && now - this.residentsCacheAt < this.CACHE_TTL) {
      return this.residentsCache;
    }

    const apiUrl = process.env.RESIDENTS_API_URL;
    const apiKey = process.env.RESIDENTS_API_KEY;

    if (!apiUrl || !apiKey) {
      return this.residentsCache ?? [];
    }

    try {
      const res = await fetch(apiUrl, {
        headers: { 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) return this.residentsCache ?? [];

      const json = (await res.json()) as FamiliesResponse;
      const residents: ResidentEntry[] = [];

      for (const family of json.data) {
        for (const member of family.familyMembers) {
          if (member.deletedAt) continue;
          residents.push({
            id: member.id,
            fullName: member.fullName || '',
            dateOfBirth: member.dateOfBirth,
            gender: member.gender,
            phoneNumber: member.phoneNumber,
            notes: member.notes || '',
            kinship: member.kinshipRelation?.title || '',
            familyId: family.id,
            familyAddress: family.currentResidentialAddress || '',
          });
        }
      }

      this.residentsCache = residents;
      this.residentsCacheAt = now;
      return residents;
    } catch {
      return this.residentsCache ?? [];
    }
  }
}
