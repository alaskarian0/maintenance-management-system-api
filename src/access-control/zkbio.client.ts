import { Injectable } from '@nestjs/common';

interface ZKBioConfig {
  baseUrl: string;
  username: string;
  password: string;
}

@Injectable()
export class ZKBioClient {
  private token: string | null = null;
  private tokenExpiry = 0;

  private get config(): ZKBioConfig {
    return {
      baseUrl: process.env.ZKBIO_TIME_URL || 'http://localhost',
      username: process.env.ZKBIO_TIME_USER || 'admin',
      password: process.env.ZKBIO_TIME_PASS || 'admin123',
    };
  }

  private async authenticate(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiry) {
      return this.token;
    }

    const res = await fetch(`${this.config.baseUrl}/jwt-api-token-auth/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`ZKBio auth failed: ${res.status}`);
    }

    const data = (await res.json()) as { token: string };
    this.token = data.token;
    this.tokenExpiry = now + 23 * 60 * 60 * 1000; // 23 hours
    return this.token!;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await this.authenticate();
    const url = new URL(path, this.config.baseUrl);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `JWT ${token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ZKBio GET ${path} failed: ${res.status} ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const token = await this.authenticate();

    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `JWT ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ZKBio POST ${path} failed: ${res.status} ${text}`);
    }

    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const token = await this.authenticate();

    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        Authorization: `JWT ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ZKBio PATCH ${path} failed: ${res.status} ${text}`);
    }

    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  async healthCheck(): Promise<{ connected: boolean; message: string }> {
    try {
      const res = await fetch(`${this.config.baseUrl}/jwt-api-token-auth/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.config.username,
          password: this.config.password,
        }),
        signal: AbortSignal.timeout(5_000),
      });

      if (res.ok) {
        return { connected: true, message: 'ZKBio Time server is connected' };
      }

      return { connected: false, message: `Authentication failed (${res.status})` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { connected: false, message: `Cannot reach ZKBio Time server: ${msg}` };
    }
  }

  async del<T = void>(path: string): Promise<T> {
    const token = await this.authenticate();

    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `JWT ${token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok && res.status !== 204) {
      throw new Error(`ZKBio DELETE ${path} failed: ${res.status}`);
    }

    const text = await res.text().catch(() => '');
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}

export interface ZKBioPaginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  msg: string;
  code: number;
  data: T[];
}

export interface ZKBioTerminal {
  id: number;
  sn: string;
  ip_address: string;
  alias: string;
  terminal_name: string | null;
  fw_ver: string | null;
  push_ver: string | null;
  state: string;
  terminal_tz: number;
  area: { id: number; area_code: string; area_name: string };
  last_activity: string | null;
  user_count: number | null;
  fp_count: number | null;
  face_count: number | null;
  palm_count: number | null;
  transaction_count: number | null;
  push_time: string | null;
  transfer_time: string;
  transfer_interval: number;
  is_attendance: number;
  area_name: string;
}

export interface ZKBioTransaction {
  id: number;
  emp: { id: number; emp_code: string; emp_name: string } | null;
  emp_code: string;
  punch_time: string;
  punch_state: number;
  verify_type: number;
  terminal: { id: number; sn: string; alias: string };
  terminal_sn: string;
  area: { id: number; area_name: string };
}

export interface ZKBioEmployee {
  id: number;
  emp_code: string;
  emp_name: string;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  department: { id: number; dept_code: string; dept_name: string };
  position: { id: number; position_code: string; position_name: string } | null;
  area: { id: number; area_name: string }[];
}

export interface ZKBioDepartment {
  id: number;
  dept_code: string;
  dept_name: string;
  parent_dept: number | null;
}
