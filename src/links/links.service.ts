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
      data: { name: dto.name, url: dto.url },
    });
  }

  async remove(id: string) {
    try {
      return await this.prisma.link.delete({ where: { id } });
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
   * Grid summary: maintenance → no ping; otherwise always one live ping (fresh state).
   * Persisted logs are for the detail page / audit only.
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
            checkedAt: null as string | null,
          };
        }
        const ping = await this.pingUrl(link.url);
        return {
          linkId: link.id,
          isMaintenance: false,
          isUp: ping.ok,
          checkedAt: new Date().toISOString(),
        };
      }),
    );
    return { items };
  }

  async pingById(id: string) {
    const link = await this.prisma.link.findUnique({
      where: { id },
      select: { id: true, url: true },
    });
    if (!link) throw new NotFoundException();
    const ping = await this.pingUrl(link.url);
    return { id: link.id, ok: ping.ok };
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
    const ping = await this.pingUrl(link.url);
    const log = await this.prisma.linkStatusLog.create({
      data: {
        linkId: id,
        isUp: ping.ok,
        statusCode: ping.statusCode,
        responseTimeMs: ping.responseTimeMs,
        errorMessage: ping.errorMessage,
      },
    });
    return { link, latestLog: log };
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
