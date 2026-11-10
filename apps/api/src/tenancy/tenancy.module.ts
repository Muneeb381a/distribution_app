import { Global, HttpException, Injectable, Logger, MiddlewareConsumer, Module, NestMiddleware, NestModule, RequestMethod } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Tenant } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma.service.js';
import { dayOf } from '../common/dates.js';
import { clientInfo, type ClientInfo } from './request-info.js';
import { MAIN_TENANT, tenantStore, type TenantCtx } from './tenant-context.js';

const TENANT_CACHE_MS = 20_000;
const SEEN_EVERY_MS = 5 * 60_000;
const FLUSH_EVERY_MS = 10_000;
/** Failed sign-ins before a person (or an address) is asked to wait. */
const MAX_FAILS_PER_USER = 8;
const MAX_FAILS_PER_IP = 30;
const FAIL_WINDOW_MS = 15 * 60_000;

/** Why a business cannot be used right now, or null when it can. */
export function blockReason(t: Pick<Tenant, 'status' | 'expiresAt' | 'suspendedReason' | 'name'>): string | null {
  if (t.status === 'SUSPENDED') return t.suspendedReason ? `This account is suspended: ${t.suspendedReason}` : 'This account is suspended. Please contact the software provider.';
  if (t.expiresAt && t.expiresAt.getTime() < Date.now()) return 'The subscription for this account has ended. Please contact the software provider.';
  return null;
}

@Injectable()
export class TenancyService {
  private cache = new Map<string, { at: number; tenant: Tenant | null }>();
  private blocked: { at: number; ips: Set<string> } | null = null;

  constructor(private prisma: PrismaService) {}

  /** A business by its sign-in code. The original business always exists. */
  async byCode(code: string): Promise<Tenant | null> {
    const hit = this.cache.get(code);
    if (hit && Date.now() - hit.at < TENANT_CACHE_MS) return hit.tenant;
    let tenant = await this.prisma.control.tenant.findUnique({ where: { code } });
    if (!tenant && code === MAIN_TENANT) {
      tenant = await this.prisma.control.tenant.upsert({
        where: { code: MAIN_TENANT },
        update: {},
        create: { code: MAIN_TENANT, name: 'Main business', schemaName: 'public', isMain: true, status: 'ACTIVE' },
      });
    }
    this.cache.set(code, { at: Date.now(), tenant });
    return tenant;
  }

  /** Changes made in the console show up at once on this instance (others catch up within seconds). */
  forget(code?: string) {
    if (code) this.cache.delete(code); else this.cache.clear();
  }

  context(t: Tenant): TenantCtx {
    return { id: t.id, code: t.code, schema: t.schemaName, maxUsers: t.maxUsers, sessionsValidFrom: t.sessionsValidFrom?.getTime() ?? null };
  }

  /** Whether an address has been blocked from the whole platform. */
  async isBlocked(ip: string | null): Promise<boolean> {
    if (!ip) return false;
    if (!this.blocked || Date.now() - this.blocked.at > TENANT_CACHE_MS) {
      this.blocked = { at: Date.now(), ips: new Set((await this.prisma.control.blockedIp.findMany({ select: { ip: true } })).map((b) => b.ip)) };
    }
    return this.blocked.ips.has(ip);
  }

  forgetBlocked() {
    this.blocked = null;
  }
}

/** Who signed in from where, who is working right now, and how much each business uses the app. */
@Injectable()
export class ActivityService {
  private log = new Logger('Activity');
  private seenAt = new Map<string, { tenantId: string; username: string; fingerprint: string; at: number; hits: number }>();
  private pending = new Map<string, { requests: number; writes: number; errors: number; modules: Record<string, number> }>();
  private lastFlush = Date.now();

  constructor(private prisma: PrismaService) {}

  async loginEvent(e: { scope: 'TENANT' | 'PLATFORM'; tenantId?: string | null; tenantCode?: string | null; username: string; success: boolean; reason?: string; info: ClientInfo }) {
    try {
      const { info, ...rest } = e;
      await this.prisma.control.loginEvent.create({
        data: {
          ...rest, username: rest.username.slice(0, 80), tenantId: rest.tenantId ?? null, tenantCode: rest.tenantCode ?? null,
          ip: info.ip, userAgent: info.userAgent, browser: info.browser, os: info.os, device: info.device, country: info.country, region: info.region, city: info.city,
        },
      });
      if (e.success && e.tenantId) await this.prisma.control.tenant.update({ where: { id: e.tenantId }, data: { lastActiveAt: new Date() } });
    } catch (err) {
      this.log.error(`Could not record a sign-in: ${(err as Error).message}`);
    }
  }

  /** Throws 429 when this person, or this address, has failed too many times lately. */
  async checkAttempts(scope: 'TENANT' | 'PLATFORM', username: string, tenantCode: string | null, ip: string | null) {
    const since = new Date(Date.now() - FAIL_WINDOW_MS);
    const [forUser, forIp] = await Promise.all([
      this.prisma.control.loginEvent.count({ where: { scope, success: false, createdAt: { gte: since }, username: { equals: username.slice(0, 80), mode: 'insensitive' }, tenantCode } }),
      ip ? this.prisma.control.loginEvent.count({ where: { success: false, createdAt: { gte: since }, ip } }) : Promise.resolve(0),
    ]);
    if (forUser >= MAX_FAILS_PER_USER || forIp >= MAX_FAILS_PER_IP) {
      throw new HttpException('Too many failed sign-in attempts. Please wait a few minutes and try again.', 429);
    }
  }

  /** Called for every request of a signed-in person; the writes are batched so the app stays quick. */
  async beforeRequest(ctx: TenantCtx, username: string | null, info: ClientInfo) {
    const due: Promise<unknown>[] = [];
    if (username) {
      const key = `${ctx.id}|${username}|${info.fingerprint}`;
      const seen = this.seenAt.get(key) ?? { tenantId: ctx.id, username, fingerprint: info.fingerprint, at: 0, hits: 0 };
      seen.hits++;
      this.seenAt.set(key, seen);
      if (Date.now() - seen.at > SEEN_EVERY_MS) {
        const hits = seen.hits;
        seen.at = Date.now();
        seen.hits = 0;
        due.push(this.writeSeen(ctx.id, username, info, hits));
      }
      if (this.seenAt.size > 5000) this.seenAt.clear();
    }
    if (Date.now() - this.lastFlush > FLUSH_EVERY_MS) due.push(this.flush());
    if (due.length) await Promise.all(due);
  }

  count(ctx: TenantCtx, method: string, path: string, status: number) {
    const p = this.pending.get(ctx.id) ?? { requests: 0, writes: 0, errors: 0, modules: {} };
    p.requests++;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) p.writes++;
    if (status >= 500) p.errors++;
    const module = path.split('/')[1]?.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'root';
    p.modules[module] = (p.modules[module] ?? 0) + 1;
    this.pending.set(ctx.id, p);
  }

  private async writeSeen(tenantId: string, username: string, info: ClientInfo, hits: number) {
    try {
      const where = { tenantId_username_fingerprint: { tenantId, username, fingerprint: info.fingerprint } };
      const now = new Date();
      await this.prisma.control.tenantUserSeen.upsert({
        where,
        create: { tenantId, username, fingerprint: info.fingerprint, ip: info.ip, userAgent: info.userAgent, browser: info.browser, os: info.os, device: info.device, country: info.country, region: info.region, city: info.city, hits },
        update: { lastSeen: now, hits: { increment: hits }, country: info.country ?? undefined, region: info.region ?? undefined, city: info.city ?? undefined },
      });
      await this.prisma.control.tenant.update({ where: { id: tenantId }, data: { lastActiveAt: now } });
    } catch (err) {
      this.log.error(`Could not record activity: ${(err as Error).message}`);
    }
  }

  async flush() {
    this.lastFlush = Date.now();
    // Requests counted for a person since their last write go in with this batch.
    for (const seen of this.seenAt.values()) {
      if (!seen.hits) continue;
      const hits = seen.hits;
      seen.hits = 0;
      await this.prisma.control.tenantUserSeen.updateMany({
        where: { tenantId: seen.tenantId, username: seen.username, fingerprint: seen.fingerprint },
        data: { hits: { increment: hits }, lastSeen: new Date() },
      }).catch(() => {});
    }
    const batch = [...this.pending.entries()];
    this.pending.clear();
    const day = dayOf();
    for (const [tenantId, p] of batch) {
      try {
        await this.prisma.control.$executeRaw`
          INSERT INTO "UsageDaily" ("tenantId", "day", "requests", "writes", "errors", "modules")
          VALUES (${tenantId}, ${day}::date, ${p.requests}, ${p.writes}, ${p.errors}, ${JSON.stringify(p.modules)}::jsonb)
          ON CONFLICT ("tenantId", "day") DO UPDATE SET
            "requests" = "UsageDaily"."requests" + EXCLUDED."requests",
            "writes" = "UsageDaily"."writes" + EXCLUDED."writes",
            "errors" = "UsageDaily"."errors" + EXCLUDED."errors",
            "modules" = (
              SELECT COALESCE(jsonb_object_agg(k, COALESCE(("UsageDaily"."modules" ->> k)::int, 0) + COALESCE((EXCLUDED."modules" ->> k)::int, 0)), '{}'::jsonb)
              FROM (SELECT jsonb_object_keys("UsageDaily"."modules") AS k UNION SELECT jsonb_object_keys(EXCLUDED."modules")) AS ks
            )`;
      } catch (err) {
        this.log.error(`Could not record usage: ${(err as Error).message}`);
      }
    }
  }
}

interface TokenPayload { tid?: string; username?: string; iat?: number }

/**
 * Decides which business a request belongs to, before anything else runs:
 *  - from the sign-in token (it carries the business code),
 *  - or, for signing in and the public sign-in page, from the code that was typed.
 * Then everything the request does is done inside that business.
 */
@Injectable()
class TenantMiddleware implements NestMiddleware {
  constructor(private tenancy: TenancyService, private activity: ActivityService, private jwt: JwtService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Nothing this API says is ever stored by a browser, a proxy or a CDN: the same address answers differently for each business.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization, X-Business');

    // The platform console works on all businesses; it has its own sign-in.
    if (req.path.startsWith('/platform')) return next();

    // An address the platform admin has blocked reaches nothing at all.
    if (req.method !== 'OPTIONS' && (await this.tenancy.isBlocked(clientInfo(req).ip))) {
      return void res.status(403).json({ statusCode: 403, code: 'IP_BLOCKED', message: 'Access from your address has been blocked. Please contact the software provider.' });
    }

    let payload: TokenPayload | null = null;
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme === 'Bearer' && token) {
      try { payload = this.jwt.verify<TokenPayload>(token); } catch { /* the guard answers 401 for a bad token */ }
    }
    const typed = String((req.body as { business?: string } | undefined)?.business ?? req.query.business ?? req.headers['x-business'] ?? '').trim().toLowerCase();
    const code = payload ? payload.tid ?? MAIN_TENANT : typed || MAIN_TENANT;
    const isLogin = req.method === 'POST' && req.path === '/auth/login';

    try {
      const tenant = await this.tenancy.byCode(code);
      if (!tenant) {
        if (isLogin) {
          // Guessing business codes is slowed down the same way guessing passwords is.
          await this.activity.checkAttempts('TENANT', String((req.body as { username?: string })?.username ?? ''), code.slice(0, 40), clientInfo(req).ip);
          await this.activity.loginEvent({ scope: 'TENANT', tenantCode: code.slice(0, 40), username: String((req.body as { username?: string })?.username ?? ''), success: false, reason: 'Unknown business code', info: clientInfo(req) });
          return void res.status(401).json({ statusCode: 401, message: 'That business code was not found. Check it and try again.' });
        }
        return void res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
      }
      const blocked = blockReason(tenant);
      if (blocked && req.method !== 'OPTIONS') {
        if (isLogin) await this.activity.loginEvent({ scope: 'TENANT', tenantId: tenant.id, tenantCode: tenant.code, username: String((req.body as { username?: string })?.username ?? ''), success: false, reason: 'Account blocked', info: clientInfo(req) });
        return void res.status(403).json({ statusCode: 403, code: 'TENANT_BLOCKED', message: blocked });
      }
      const ctx = this.tenancy.context(tenant);
      // "Sign everyone out": tokens older than the cut-off are refused.
      if (payload && ctx.sessionsValidFrom && (payload.iat ?? 0) * 1000 < ctx.sessionsValidFrom) {
        return void res.status(401).json({ statusCode: 401, message: 'You were signed out. Please sign in again.' });
      }
      if (payload?.username) {
        await this.activity.beforeRequest(ctx, payload.username, clientInfo(req));
        res.on('finish', () => this.activity.count(ctx, req.method, req.path, res.statusCode));
      }
      tenantStore.run(ctx, () => next());
    } catch (e) {
      next(e);
    }
  }
}

@Global()
@Module({ providers: [TenancyService, ActivityService, TenantMiddleware], exports: [TenancyService, ActivityService] })
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}

