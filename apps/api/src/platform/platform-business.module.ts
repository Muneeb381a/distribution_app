import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsIP, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { Prisma, type Tenant } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service.js';
import { Public } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';
import { TenancyService } from '../tenancy/tenancy.module.js';
import { clientInfo } from '../tenancy/request-info.js';
import { currentTenant } from '../tenancy/tenant-context.js';
import { CurrentAdmin, PlatformGuard, type Admin } from './platform-auth.js';

const D = Prisma.Decimal;
const DAY = 86_400_000;
const METHODS = ['CASH', 'BANK', 'JAZZCASH', 'EASYPAISA', 'OTHER'] as const;

class PaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount: number;
  @IsIn(METHODS) method: (typeof METHODS)[number];
  /** Months this payment pays for; the end date moves forward by this much. */
  @IsOptional() @IsInt() @Min(1) @Max(36) months?: number;
  @IsOptional() @IsISO8601() paidOn?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class AnnouncementDto {
  @IsString() @MinLength(2) @MaxLength(120) title: string;
  @IsOptional() @IsString() @MaxLength(1000) body?: string;
  @IsOptional() @IsIn(['INFO', 'WARNING', 'CRITICAL']) level?: 'INFO' | 'WARNING' | 'CRITICAL';
  /** Leave out (or empty) to show it to every business. */
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsUUID() tenantId?: string;
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsISO8601() endsAt?: string;
}

class UpdateAnnouncementDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(1000) body?: string;
  @IsOptional() @IsIn(['INFO', 'WARNING', 'CRITICAL']) level?: 'INFO' | 'WARNING' | 'CRITICAL';
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsISO8601() endsAt?: string;
}

class BlockIpDto {
  @IsIP() ip: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** The same calendar day, `months` later (the end of a short month stays inside it). */
function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
class PlatformBusinessController {
  constructor(private prisma: PrismaService, private tenancy: TenancyService) {}

  private get db() { return this.prisma.control; }

  private async audit(a: Admin, action: string, t?: Pick<Tenant, 'id' | 'name'> | null, detail?: Prisma.InputJsonValue) {
    await this.db.platformAudit.create({ data: { adminId: a.id, adminName: a.username, action, tenantId: t?.id, tenantName: t?.name, detail } });
  }

  private async tenant(id: string) {
    const t = await this.db.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    return t;
  }

  // ------------------------------------------------------------------------------------------- money

  /** Money received: the end date moves forward by the months it pays for. */
  @Post('tenants/:id/payments')
  async pay(@Param('id') id: string, @Body() dto: PaymentDto, @CurrentAdmin() a: Admin) {
    const t = await this.tenant(id);
    if (t.isMain) throw new BadRequestException('Your own business does not pay');
    const months = dto.months ?? 1;
    const today = dayOf();
    const base = t.expiresAt && t.expiresAt.getTime() > today.getTime() ? t.expiresAt : today;
    const expiresAt = addMonths(base, months);
    const [payment, updated] = await this.db.$transaction([
      this.db.tenantPayment.create({
        data: { tenantId: id, amount: dto.amount, method: dto.method, months, paidOn: dto.paidOn ? dayOf(dto.paidOn) : today, previousExpiry: t.expiresAt, note: dto.note?.trim() || null, createdByName: a.username },
      }),
      this.db.tenant.update({ where: { id }, data: { expiresAt, status: t.status === 'SUSPENDED' ? undefined : 'ACTIVE' } }),
    ]);
    await this.audit(a, 'PAYMENT', t, { amount: dto.amount, months, until: expiresAt.toISOString().slice(0, 10) });
    this.tenancy.forget(t.code);
    return { payment, expiresAt: updated.expiresAt };
  }

  @Get('tenants/:id/payments')
  async payments(@Param('id') id: string) {
    await this.tenant(id);
    return this.db.tenantPayment.findMany({ where: { tenantId: id }, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }] });
  }

  /** Every payment, newest first, with totals; for the billing page and its CSV. */
  @Get('payments')
  async allPayments(@Query('from') from?: string, @Query('to') to?: string) {
    const rows = await this.db.tenantPayment.findMany({
      where: { paidOn: { gte: from ? dayOf(from) : undefined, lte: to ? dayOf(to) : undefined } },
      orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
      include: { tenant: { select: { name: true, code: true } } },
    });
    const total = rows.reduce((s, r) => s.plus(r.amount), new D(0));
    return { rows: rows.map(({ tenant, ...r }) => ({ ...r, tenantName: tenant.name, tenantCode: tenant.code })), total };
  }

  /** Undo the most recent payment of a business (a typing mistake); the end date goes back as it was. */
  @Delete('payments/:id')
  async undo(@Param('id') id: string, @CurrentAdmin() a: Admin) {
    const p = await this.db.tenantPayment.findUnique({ where: { id }, include: { tenant: true } });
    if (!p) throw new NotFoundException();
    const latest = await this.db.tenantPayment.findFirst({ where: { tenantId: p.tenantId }, orderBy: { createdAt: 'desc' } });
    if (latest?.id !== p.id) throw new BadRequestException('Only the most recent payment of a business can be undone');
    await this.db.$transaction([
      this.db.tenant.update({ where: { id: p.tenantId }, data: { expiresAt: p.previousExpiry } }),
      this.db.tenantPayment.delete({ where: { id } }),
    ]);
    await this.audit(a, 'UNDO_PAYMENT', p.tenant, { amount: p.amount.toString() });
    this.tenancy.forget(p.tenant.code);
    return { ok: true };
  }

  /** The money picture: monthly income, what came in, who has run out and who runs out soon. */
  @Get('billing/summary')
  async billing() {
    const now = new Date();
    const today = dayOf();
    const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const since = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 5, 1));
    const [tenants, payments] = await Promise.all([
      this.db.tenant.findMany({ where: { isMain: false } }),
      this.db.tenantPayment.findMany({ where: { paidOn: { gte: since } }, select: { amount: true, paidOn: true } }),
    ]);
    const live = tenants.filter((t) => t.status !== 'SUSPENDED' && !(t.expiresAt && t.expiresAt.getTime() < today.getTime()));
    const sum = (rows: typeof payments) => rows.reduce((s, r) => s.plus(r.amount), new D(0));
    const months = Array.from({ length: 6 }, (_, i) => {
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 5 + i, 1));
      const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 4 + i, 1));
      return { month: start.toISOString().slice(0, 7), amount: sum(payments.filter((p) => p.paidOn >= start && p.paidOn < end)) };
    });
    const row = (t: Tenant) => ({ id: t.id, name: t.name, code: t.code, phone: t.phone, contactName: t.contactName, expiresAt: t.expiresAt, monthlyFee: t.monthlyFee, status: t.status, daysLeft: t.expiresAt ? Math.ceil((t.expiresAt.getTime() - today.getTime()) / DAY) : null });
    return {
      mrr: live.reduce((s, t) => s.plus(t.monthlyFee ?? 0), new D(0)),
      collectedThisMonth: sum(payments.filter((p) => p.paidOn >= monthStart)),
      collectedLastMonth: months[4].amount,
      payingBusinesses: live.filter((t) => t.status === 'ACTIVE').length,
      noFeeSet: live.filter((t) => t.status === 'ACTIVE' && !t.monthlyFee).length,
      months,
      overdue: tenants.filter((t) => t.status !== 'SUSPENDED' && t.expiresAt && t.expiresAt.getTime() < today.getTime()).map(row).sort((x, y) => (x.daysLeft ?? 0) - (y.daysLeft ?? 0)),
      dueSoon: tenants.filter((t) => t.status !== 'SUSPENDED' && t.expiresAt && t.expiresAt.getTime() >= today.getTime() && t.expiresAt.getTime() < today.getTime() + 10 * DAY).map(row).sort((x, y) => (x.daysLeft ?? 0) - (y.daysLeft ?? 0)),
    };
  }

  // ----------------------------------------------------------------------------------------- storage

  /** How much of the database each business takes, against the limit of the database plan. */
  @Get('storage')
  async storage() {
    const tenants = await this.db.tenant.findMany({ select: { id: true, schemaName: true } });
    const schemas = tenants.map((t) => t.schemaName).filter((s) => s === 'public' || /^t_[a-z0-9_]{2,40}$/.test(s));
    const [sizes, db] = await Promise.all([
      this.db.$queryRaw<{ schema: string; bytes: bigint }[]>`
        SELECT n.nspname AS schema, COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::bigint AS bytes
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname IN (${Prisma.join(schemas)}) GROUP BY n.nspname`,
      this.db.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS bytes`,
    ]);
    return {
      usedBytes: Number(db[0]?.bytes ?? 0),
      limitBytes: Number(process.env.DB_LIMIT_MB ?? 512) * 1024 * 1024,
      perTenant: tenants.map((t) => ({ tenantId: t.id, bytes: Number(sizes.find((s) => s.schema === t.schemaName)?.bytes ?? 0) })),
    };
  }

  // ----------------------------------------------------------------------------------------- security

  /** End every sign-in of a business at once (a lost phone, a sacked employee); people sign in again with their password. */
  @Post('tenants/:id/sign-out-all')
  async signOutAll(@Param('id') id: string, @CurrentAdmin() a: Admin) {
    const t = await this.tenant(id);
    await this.db.tenant.update({ where: { id }, data: { sessionsValidFrom: new Date() } });
    await this.audit(a, 'SIGN_OUT_ALL', t);
    this.tenancy.forget(t.code);
    return { ok: true };
  }

  /** Failed sign-ins grouped by address, blocked addresses, and businesses reached from several countries. */
  @Get('security')
  async security() {
    const since = new Date(Date.now() - DAY);
    const [failed, blocked, seen] = await Promise.all([
      this.db.loginEvent.findMany({ where: { success: false, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 3000 }),
      this.db.blockedIp.findMany({ orderBy: { createdAt: 'desc' } }),
      this.db.tenantUserSeen.findMany({ where: { lastSeen: { gte: new Date(Date.now() - 30 * DAY) }, country: { not: null } }, select: { tenantId: true, username: true, country: true, city: true, tenant: { select: { name: true } } } }),
    ]);
    const blockedSet = new Set(blocked.map((b) => b.ip));
    const byIp = new Map<string, { ip: string; count: number; users: Set<string>; businesses: Set<string>; country: string | null; city: string | null; last: Date }>();
    for (const e of failed) {
      if (!e.ip) continue;
      const g = byIp.get(e.ip) ?? { ip: e.ip, count: 0, users: new Set<string>(), businesses: new Set<string>(), country: e.country, city: e.city, last: e.createdAt };
      g.count++;
      g.users.add(e.username);
      if (e.tenantCode) g.businesses.add(e.tenantCode);
      byIp.set(e.ip, g);
    }
    const countries = new Map<string, { tenantId: string; name: string; countries: Set<string> }>();
    for (const s of seen) {
      const g = countries.get(s.tenantId) ?? { tenantId: s.tenantId, name: s.tenant.name, countries: new Set<string>() };
      g.countries.add(s.country!);
      countries.set(s.tenantId, g);
    }
    return {
      failed24h: failed.length,
      uniqueIps24h: byIp.size,
      topIps: [...byIp.values()].sort((x, y) => y.count - x.count).slice(0, 15)
        .map((g) => ({ ip: g.ip, count: g.count, users: [...g.users].slice(0, 6), businesses: [...g.businesses], country: g.country, city: g.city, last: g.last, blocked: blockedSet.has(g.ip) })),
      blocked,
      multiCountry: [...countries.values()].filter((c) => c.countries.size > 1).map((c) => ({ tenantId: c.tenantId, name: c.name, countries: [...c.countries].sort() })),
    };
  }

  @Post('blocked-ips')
  async block(@Body() dto: BlockIpDto, @CurrentAdmin() a: Admin, @Req() req: Request) {
    if (clientInfo(req).ip === dto.ip) throw new BadRequestException('That is your own address; blocking it would lock you out');
    const row = await this.db.blockedIp.upsert({ where: { ip: dto.ip }, update: { reason: dto.reason }, create: { ip: dto.ip, reason: dto.reason?.trim() || null, createdByName: a.username } });
    await this.audit(a, 'BLOCK_IP', null, { ip: dto.ip, reason: dto.reason ?? null });
    this.tenancy.forgetBlocked();
    return row;
  }

  @Delete('blocked-ips/:id')
  async unblock(@Param('id') id: string, @CurrentAdmin() a: Admin) {
    const row = await this.db.blockedIp.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    await this.db.blockedIp.delete({ where: { id } });
    await this.audit(a, 'UNBLOCK_IP', null, { ip: row.ip });
    this.tenancy.forgetBlocked();
    return { ok: true };
  }

  // ------------------------------------------------------------------------------------ announcements

  @Get('announcements')
  async announcements() {
    const rows = await this.db.announcement.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }], take: 200, include: { tenant: { select: { name: true } } } });
    const now = Date.now();
    return rows.map(({ tenant, ...r }) => ({ ...r, tenantName: tenant?.name ?? null, live: r.isActive && r.startsAt.getTime() <= now && (!r.endsAt || r.endsAt.getTime() > now) }));
  }

  @Post('announcements')
  async announce(@Body() dto: AnnouncementDto, @CurrentAdmin() a: Admin) {
    const t = dto.tenantId ? await this.tenant(dto.tenantId) : null;
    const row = await this.db.announcement.create({
      data: { title: dto.title.trim(), body: dto.body?.trim() || null, level: dto.level ?? 'INFO', tenantId: t?.id ?? null, endsAt: dto.endsAt ? new Date(dto.endsAt) : null, createdByName: a.username },
    });
    await this.audit(a, 'ANNOUNCE', t, { title: row.title, level: row.level });
    return row;
  }

  @Patch('announcements/:id')
  async updateAnnouncement(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto, @CurrentAdmin() a: Admin) {
    const before = await this.db.announcement.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    const row = await this.db.announcement.update({
      where: { id },
      data: { isActive: dto.isActive, title: dto.title?.trim(), body: dto.body === undefined ? undefined : dto.body.trim() || null, level: dto.level, endsAt: dto.endsAt === undefined ? undefined : dto.endsAt === '' ? null : new Date(dto.endsAt) },
    });
    if (dto.isActive !== undefined && dto.isActive !== before.isActive) await this.audit(a, dto.isActive ? 'ANNOUNCEMENT_ON' : 'ANNOUNCEMENT_OFF', null, { title: row.title });
    return row;
  }

  @Delete('announcements/:id')
  async deleteAnnouncement(@Param('id') id: string, @CurrentAdmin() a: Admin) {
    const row = await this.db.announcement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    await this.db.announcement.delete({ where: { id } });
    await this.audit(a, 'ANNOUNCEMENT_DELETE', null, { title: row.title });
    return { ok: true };
  }
}

/** What a business's staff see: the messages meant for everyone or for their business, that are on right now. */
@Controller('announcements')
class AnnouncementsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async active() {
    const t = currentTenant();
    if (!t) throw new ForbiddenException();
    const now = new Date();
    return this.prisma.control.announcement.findMany({
      where: { isActive: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }], AND: [{ OR: [{ tenantId: null }, { tenantId: t.id }] }] },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, body: true, level: true, createdAt: true },
    });
  }
}

@Module({ controllers: [PlatformBusinessController, AnnouncementsController] })
export class PlatformBusinessModule {}
