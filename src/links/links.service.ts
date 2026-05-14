import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateLinkDto } from './dto/create-link.dto';

const HEALTH_CHECK_TIMEOUT_MS = 5000;
const HEALTH_USER_AGENT = 'MaintenanceLinksHealthCheck/1.0';

export type PingResult = {
  ok: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
};

@Injectable()
export class LinksService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.link.findMany({ orderBy: { createdAt: 'asc' } });
  }

  create(dto: CreateLinkDto) {
    return this.prisma.link.create({
      data: {
        name: dto.name,
        url: dto.url,
        apiUrl: dto.apiUrl ?? null,
      },
    });
  }

  async remove(id: string) {
    try {
      return await this.prisma.link.delete({ where: { id } });
    } catch {
      throw new NotFoundException();
    }
  }

  async update(id: string, data: { name?: string; url?: string; apiUrl?: string | null }) {
    try {
      return await this.prisma.link.update({
        where: { id },
        data,
      });
    } catch {
      throw new NotFoundException();
    }
  }

  /** Legacy: batch ping only (no maintenance / logs). */
  async healthBatch() {
    const links = await this.prisma.link.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, url: true },
    });
    const items = await Promise.all(
      links.map(async (link) => ({
        id: link.id,
        ok: (await this.pingUrl(link.url)).ok,
      })),
    );
    return { items };
  }

  /**
   * Grid summary: maintenance → no ping; otherwise pings both dashboard & API URLs.
   * Returns combined status per link.
   */
  async statusSummary() {
    const links = await this.prisma.link.findMany({
      orderBy: { createdAt: 'asc' },
    });
    const items = await Promise.all(
      links.map(async (link) => {
        if (link.isMaintenance) {
          return {
            linkId: link.id,
            isMaintenance: true,
            isUp: null as boolean | null,
            dashboardUp: null as boolean | null,
            apiUp: null as boolean | null,
            hasApiUrl: !!link.apiUrl,
            checkedAt: null as string | null,
          };
        }
        const [dashboardPing, apiPing] = await Promise.all([
          this.pingUrl(link.url),
          link.apiUrl ? this.pingUrl(link.apiUrl) : Promise.resolve(null),
        ]);
        const dashboardUp = dashboardPing.ok;
        const apiUp = apiPing?.ok ?? null;
        const isUp = link.apiUrl ? dashboardUp && apiUp! : dashboardUp;
        return {
          linkId: link.id,
          isMaintenance: false,
          isUp,
          dashboardUp,
          apiUp,
          hasApiUrl: !!link.apiUrl,
          checkedAt: new Date().toISOString(),
        };
      }),
    );
    return { items };
  }

  async pingById(id: string) {
    const link = await this.prisma.link.findUnique({
      where: { id },
      select: { id: true, url: true, apiUrl: true },
    });
    if (!link) throw new NotFoundException();
    const [dashboardPing, apiPing] = await Promise.all([
      this.pingUrl(link.url),
      link.apiUrl ? this.pingUrl(link.apiUrl) : Promise.resolve(null),
    ]);
    const dashboardUp = dashboardPing.ok;
    const apiUp = apiPing?.ok ?? null;
    const isUp = link.apiUrl ? dashboardUp && apiUp! : dashboardUp;
    return {
      id: link.id,
      ok: isUp,
      dashboardUp,
      apiUp,
      hasApiUrl: !!link.apiUrl,
    };
  }

  async getDetails(id: string, limit: number) {
    const link = await this.prisma.link.findUnique({ where: { id } });
    if (!link) throw new NotFoundException();
    const take = Math.min(Math.max(limit, 1), 100);
    const logs = await this.prisma.linkStatusLog.findMany({
      where: { linkId: id },
      orderBy: { checkedAt: 'desc' },
      take,
    });
    const latestLog = logs[0] ?? null;
    return { link, latestLog, logs };
  }

  async statusLogs(id: string, limit: number, offset: number) {
    const link = await this.prisma.link.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!link) throw new NotFoundException();
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = Math.max(offset, 0);
    return this.prisma.linkStatusLog.findMany({
      where: { linkId: id },
      orderBy: { checkedAt: 'desc' },
      skip,
      take,
    });
  }

  async checkAndLog(id: string) {
    const link = await this.prisma.link.findUnique({ where: { id } });
    if (!link) throw new NotFoundException();
    const [dashboardPing, apiPing] = await Promise.all([
      this.pingUrl(link.url),
      link.apiUrl ? this.pingUrl(link.apiUrl) : Promise.resolve(null),
    ]);
    const dashboardUp = dashboardPing.ok;
    const apiUp = apiPing?.ok ?? null;
    const isUp = link.apiUrl ? dashboardUp && apiUp! : dashboardUp;
    const log = await this.prisma.linkStatusLog.create({
      data: {
        linkId: id,
        isUp,
        statusCode: dashboardPing.statusCode,
        responseTimeMs: dashboardPing.responseTimeMs,
        errorMessage: [
          dashboardPing.ok ? null : `Dashboard: ${dashboardPing.errorMessage || 'down'}`,
          apiPing && !apiPing.ok ? `API: ${apiPing.errorMessage || 'down'}` : null,
        ].filter(Boolean).join(' | ') || null,
      },
    });
    return {
      link,
      latestLog: log,
      dashboardUp,
      apiUp,
      hasApiUrl: !!link.apiUrl,
    };
  }

  /**
   * One-time cleanup: finds standalone API entries (url matches an apiUrl
   * pattern or entries with no matching frontend) and merges them into
   * their matching entries by setting apiUrl, then deletes the API entries.
   * Matching is done by stripping " API" suffix from the entry name.
   */
  async cleanupDuplicateApiLinks() {
    const links = await this.prisma.link.findMany({
      orderBy: { createdAt: 'asc' },
    });

    const apiEntries = links.filter((l) => /\s*API\s*$/.test(l.name));
    const frontendEntries = links.filter((l) => !/\s*API\s*$/.test(l.name));

    const results: { merged: string[]; deleted: string[]; skipped: string[] } = {
      merged: [],
      deleted: [],
      skipped: [],
    };

    for (const api of apiEntries) {
      const baseName = api.name.replace(/\s*API\s*$/, '').trim();
      const match = frontendEntries.find(
        (f) => f.name.trim() === baseName && !f.apiUrl,
      );

      if (match) {
        await this.prisma.link.update({
          where: { id: match.id },
          data: { apiUrl: api.url },
        });
        await this.prisma.link.delete({ where: { id: api.id } });
        results.merged.push(`${api.name} → ${match.name} (apiUrl=${api.url})`);
      } else {
        results.skipped.push(api.name);
      }
    }

    return results;
  }

  async setMaintenance(id: string, isMaintenance: boolean) {
    try {
      return await this.prisma.link.update({
        where: { id },
        data: { isMaintenance },
      });
    } catch {
      throw new NotFoundException();
    }
  }

  private async pingUrl(url: string): Promise<PingResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': HEALTH_USER_AGENT, Accept: '*/*' },
      });
      const responseTimeMs = Date.now() - started;
      const ok = res.status >= 200 && res.status < 400;
      return {
        ok,
        statusCode: res.status,
        responseTimeMs,
        errorMessage: ok ? null : `HTTP ${res.status}`,
      };
    } catch (e) {
      const responseTimeMs = Date.now() - started;
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        statusCode: null,
        responseTimeMs,
        errorMessage: msg,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
