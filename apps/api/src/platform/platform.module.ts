import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, Module,
  NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { Prisma, type Tenant } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service.js';
import { Public } from '../common/decorators.js';
import { ActivityService, TenancyService, blockReason } from '../tenancy/tenancy.module.js';
import { clientInfo } from '../tenancy/request-info.js';
import { CurrentAdmin, PLATFORM_SECRET, PlatformGuard, type Admin } from './platform-auth.js';
import { createSchema, dropSchema, schemaFor, schemaExists, SCHEMA } from './provision.js';
import { newPassword, seedTenant } from './seed-tenant.js';
import { withDefaults } from '@dist/shared';

const RESERVED = new Set(['main', 'admin', 'platform', 'api', 'www', 'public', 'login', 'app', 'static', 'auth']);
const DAY = 86_400_000;
const ACTIVE_NOW_MS = 15 * 60_000;

// ---------------------------------------------------------------------------------------------- input

class PlatformLoginDto {
  @IsString() username: string;
  @IsString() password: string;
}

class PlatformPasswordDto {
  @IsString() current: string;
  @IsString() @MinLength(8) next: string;
}

class TenantDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  /** What staff type at sign-in. Made from the name when left out. */
  @IsOptional() @IsString() @MinLength(3) @MaxLength(30) @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'code may use small letters, numbers and single hyphens, e.g. ali-traders' }) code?: string;
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsIn(['TRIAL', 'ACTIVE']) status?: 'TRIAL' | 'ACTIVE';
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(500) maxUsers?: number;
  /** What the business pays each month. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyFee?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /** The owner's first password; one is made when left out. */
  @IsOptional() @IsString() @MinLength(8) @MaxLength(60) ownerPassword?: string;
}

class UpdateTenantDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsIn(['TRIAL', 'ACTIVE']) status?: 'TRIAL' | 'ACTIVE';
  /** Empty text removes the end date. */
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsISO8601() expiresAt?: string;
  /** 0 removes the limit. */
  @IsOptional() @IsInt() @Min(0) @Max(500) maxUsers?: number;
  /** 0 removes the fee. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyFee?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

class SuspendDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

class ResetOwnerDto {
  @IsOptional() @IsString() @MaxLength(60) username?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(60) password?: string;
}

class DeleteTenantDto {
  @IsString() confirm: string;
}

class AdminDto {
  @IsString() @MinLength(3) @MaxLength(40) @Matches(/^[a-z0-9._-]+$/, { message: 'username may use small letters, numbers, dot, dash and underscore' }) username: string;
  @IsString() @MinLength(8) @MaxLength(60) password: string;
  @IsOptional() @IsString() @MaxLength(60) displayName?: string;
}

class UpdateAdminDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(60) password?: string;
  @IsOptional() @IsString() @MaxLength(60) displayName?: string;
}

// ---------------------------------------------------------------------------------------------- sign-in

@Public()
@Controller('platform/auth')
class PlatformAuthController {
  constructor(private prisma: PrismaService, private jwt: JwtService, private activity: ActivityService, private tenancy: TenancyService) {}

  @Post('login')
  async login(@Body() dto: PlatformLoginDto, @Req() req: Request) {
    const info = clientInfo(req);
    if (await this.tenancy.isBlocked(info.ip)) throw new ForbiddenException('Access from your address has been blocked.');
    const event = { scope: 'PLATFORM' as const, tenantCode: null, username: dto.username, info };
    await this.activity.checkAttempts('PLATFORM', dto.username, null, info.ip);
    const admin = await this.prisma.control.platformAdmin.findUnique({ where: { username: dto.username.trim().toLowerCase() } });
    const reason = !admin ? 'Unknown username' : !admin.isActive ? 'Account turned off' : !(await bcrypt.compare(dto.password, admin.passwordHash)) ? 'Wrong password' : null;
    if (!admin || reason) {
      await this.activity.loginEvent({ ...event, success: false, reason: reason ?? 'Unknown username' });
      throw new UnauthorizedException('Invalid username or password');
    }
    await this.activity.loginEvent({ ...event, success: true });
    await this.prisma.control.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const token = await this.jwt.signAsync({ sub: admin.id, kind: 'platform' }, { secret: PLATFORM_SECRET(), expiresIn: '8h' });
    return { accessToken: token, admin: { id: admin.id, username: admin.username, displayName: admin.displayName } };
  }

  @UseGuards(PlatformGuard) @Get('me')
  me(@CurrentAdmin() a: Admin) {
    return a;
  }

  @UseGuards(PlatformGuard) @Post('password')
  async password(@CurrentAdmin() a: Admin, @Body() dto: PlatformPasswordDto) {
    const row = await this.prisma.control.platformAdmin.findUniqueOrThrow({ where: { id: a.id } });
    if (!(await bcrypt.compare(dto.current, row.passwordHash))) throw new BadRequestException('Your current password is not correct');
    await this.prisma.control.platformAdmin.update({ where: { id: a.id }, data: { passwordHash: await bcrypt.hash(dto.next, 10) } });
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------------------------- the console

/** A safe SQL list of schemas for counting across businesses; names come from the database and are checked. */
const safeSchemas = (tenants: Pick<Tenant, 'schemaName'>[]) => tenants.map((t) => t.schemaName).filter((s) => s === 'public' || SCHEMA.test(s));

@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
class PlatformController {
  constructor(private prisma: PrismaService, private tenancy: TenancyService, private activity: ActivityService) {}

  private get db() { return this.prisma.control; }

  private async audit(a: Admin, action: string, t?: Pick<Tenant, 'id' | 'name'> | null, detail?: Prisma.InputJsonValue) {
    await this.db.platformAudit.create({ data: { adminId: a.id, adminName: a.username, action, tenantId: t?.id, tenantName: t?.name, detail } });
  }

  private async userCounts(tenants: Tenant[]) {
    const schemas = safeSchemas(tenants);
    const out = new Map<string, { users: number; active: number }>();
    if (!schemas.length) return out;
    const sql = schemas.map((s) => `SELECT '${s}' AS s, count(*)::int AS n, (count(*) FILTER (WHERE "isActive"))::int AS a FROM "${s}"."AppUser"`).join(' UNION ALL ');
    for (const r of await this.db.$queryRawUnsafe<{ s: string; n: number; a: number }[]>(sql).catch(() => [])) out.set(r.s, { users: r.n, active: r.a });
    return out;
  }

  private row(t: Tenant, extra: { users?: { users: number; active: number }; requests7d?: number; requestsToday?: number; activeNow?: number; lastLoginAt?: Date | null }) {
    const left = t.expiresAt ? Math.ceil((t.expiresAt.getTime() - Date.now()) / DAY) : null;
    return {
      ...t,
      users: extra.users?.users ?? 0, activeUsers: extra.users?.active ?? 0,
      requests7d: extra.requests7d ?? 0, requestsToday: extra.requestsToday ?? 0, activeNow: extra.activeNow ?? 0,
      lastLoginAt: extra.lastLoginAt ?? null,
      blocked: blockReason(t), daysLeft: left,
    };
  }

  @Get('overview')
  async overview() {
    await this.activity.flush();
    const now = Date.now();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayStart = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const since14 = new Date(dayStart.getTime() - 13 * DAY);
    const [tenants, usage, activeNow, logins24h, fails24h, recent, perTenant] = await Promise.all([
      this.db.tenant.findMany(),
      this.db.usageDaily.findMany({ where: { day: { gte: since14 } } }),
      this.db.tenantUserSeen.findMany({ where: { lastSeen: { gte: new Date(now - ACTIVE_NOW_MS) } }, select: { tenantId: true, username: true } }),
      this.db.loginEvent.count({ where: { success: true, createdAt: { gte: new Date(now - DAY) } } }),
      this.db.loginEvent.count({ where: { success: false, createdAt: { gte: new Date(now - DAY) } } }),
      this.db.loginEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 12, include: { tenant: { select: { name: true, code: true } } } }),
      this.db.usageDaily.groupBy({ by: ['tenantId'], where: { day: { gte: new Date(dayStart.getTime() - 6 * DAY) } }, _sum: { requests: true } }),
    ]);
    const series = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(since14.getTime() + i * DAY);
      const rows = usage.filter((u) => u.day.getTime() === d.getTime());
      return { day: d.toISOString().slice(0, 10), requests: rows.reduce((s, r) => s + r.requests, 0), writes: rows.reduce((s, r) => s + r.writes, 0) };
    });
    const top = perTenant.map((p) => ({ tenantId: p.tenantId, name: tenants.find((t) => t.id === p.tenantId)?.name ?? '', requests: p._sum.requests ?? 0 }))
      .sort((a, b) => b.requests - a.requests).slice(0, 5);
    return {
      tenants: {
        total: tenants.length,
        active: tenants.filter((t) => t.status === 'ACTIVE' && !blockReason(t)).length,
        trial: tenants.filter((t) => t.status === 'TRIAL' && !blockReason(t)).length,
        suspended: tenants.filter((t) => t.status === 'SUSPENDED').length,
        expired: tenants.filter((t) => t.status !== 'SUSPENDED' && t.expiresAt && t.expiresAt.getTime() < now).length,
        expiringSoon: tenants.filter((t) => t.expiresAt && t.expiresAt.getTime() >= now && t.expiresAt.getTime() < now + 14 * DAY).length,
        active24h: tenants.filter((t) => t.lastActiveAt && t.lastActiveAt.getTime() > now - DAY).length,
        idle14d: tenants.filter((t) => !t.isMain && (!t.lastActiveAt || t.lastActiveAt.getTime() < now - 14 * DAY)).length,
      },
      activeNow: activeNow.length,
      logins24h, failedLogins24h: fails24h,
      requestsToday: series[series.length - 1].requests,
      series, top,
      recentLogins: recent.map((e) => ({ ...e, tenantName: e.tenant?.name ?? null })),
    };
  }

  @Get('tenants')
  async tenants() {
    await this.activity.flush();
    const now = Date.now();
    const today = new Date();
    const dayStart = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const [tenants, usage, seen, lastLogins, lastPaid] = await Promise.all([
      this.db.tenant.findMany({ orderBy: [{ isMain: 'desc' }, { createdAt: 'desc' }] }),
      this.db.usageDaily.findMany({ where: { day: { gte: new Date(dayStart.getTime() - 6 * DAY) } }, select: { tenantId: true, day: true, requests: true } }),
      this.db.tenantUserSeen.findMany({ where: { lastSeen: { gte: new Date(now - ACTIVE_NOW_MS) } }, select: { tenantId: true, username: true } }),
      this.db.loginEvent.groupBy({ by: ['tenantId'], where: { success: true, tenantId: { not: null } }, _max: { createdAt: true } }),
      this.db.tenantPayment.groupBy({ by: ['tenantId'], _max: { paidOn: true } }),
    ]);
    const users = await this.userCounts(tenants);
    return tenants.map((t) => ({ lastPaymentOn: lastPaid.find((p) => p.tenantId === t.id)?._max.paidOn ?? null, ...this.row(t, {
      users: users.get(t.schemaName),
      requests7d: usage.filter((u) => u.tenantId === t.id).reduce((s, u) => s + u.requests, 0),
      requestsToday: usage.filter((u) => u.tenantId === t.id && u.day.getTime() === dayStart.getTime()).reduce((s, u) => s + u.requests, 0),
      activeNow: new Set(seen.filter((s) => s.tenantId === t.id).map((s) => s.username)).size,
      lastLoginAt: lastLogins.find((l) => l.tenantId === t.id)?._max.createdAt ?? null,
    }) }));
  }

  @Post('tenants')
  async create(@Body() dto: TenantDto, @CurrentAdmin() a: Admin) {
    const code = dto.code ?? (await this.freeCode(dto.name));
    if (RESERVED.has(code)) throw new BadRequestException(`“${code}” is reserved; choose another code`);
    if (await this.db.tenant.findUnique({ where: { code } })) throw new ConflictException(`The code “${code}” is already used by another business`);
    const schema = schemaFor(code);
    if (await schemaExists(schema)) throw new ConflictException('A database schema for this code already exists; choose another code');

    await createSchema(schema);
    let ownerPassword: string;
    try {
      const seeded = await seedTenant(this.prisma.forSchema(schema), { ownerPassword: dto.ownerPassword });
      ownerPassword = seeded.ownerPassword ?? dto.ownerPassword ?? newPassword();
      // The sign-in page and printed bills carry the business's own name from the start.
      await this.prisma.forSchema(schema).setting.upsert({
        where: { key: 'business' },
        update: {},
        create: { key: 'business', value: withDefaults({ businessName: dto.name.trim(), phone: dto.phone ?? '' }) as unknown as Prisma.InputJsonValue },
      });
    } catch (e) {
      await dropSchema(schema).catch(() => {});
      throw e;
    }
    const tenant = await this.db.tenant.create({
      data: {
        code, name: dto.name.trim(), schemaName: schema, contactName: dto.contactName, phone: dto.phone, email: dto.email || undefined, city: dto.city,
        status: dto.status ?? 'TRIAL', expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null, maxUsers: dto.maxUsers, monthlyFee: dto.monthlyFee || null, notes: dto.notes,
      },
    });
    await this.audit(a, 'CREATE_TENANT', tenant, { code });
    this.tenancy.forget(code);
    return { tenant: this.row(tenant, {}), owner: { username: 'owner', password: ownerPassword } };
  }

  @Get('tenants/:id')
  async one(@Param('id') id: string) {
    await this.activity.flush();
    const t = await this.db.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    const db = this.prisma.forSchema(t.schemaName);
    const since30 = new Date(Date.now() - 30 * DAY);
    const [counts, users, usage, seen, logins, lastSale, loginByUser, history] = await Promise.all([
      Promise.all([db.appUser.count(), db.customer.count(), db.supplier.count(), db.product.count(), db.sale.count(), db.purchase.count(), db.employee.count(), db.expense.count(), db.stockMovement.count()])
        .then(([users, customers, suppliers, products, sales, purchases, employees, expenses, stockMoves]) => ({ users, customers, suppliers, products, sales, purchases, employees, expenses, stockMoves })),
      db.appUser.findMany({ select: { id: true, username: true, displayName: true, isActive: true, role: { select: { name: true } } }, orderBy: { username: 'asc' } }),
      this.db.usageDaily.findMany({ where: { tenantId: id, day: { gte: since30 } }, orderBy: { day: 'asc' } }),
      this.db.tenantUserSeen.findMany({ where: { tenantId: id }, orderBy: { lastSeen: 'desc' }, take: 100 }),
      this.db.loginEvent.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 40 }),
      db.sale.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.db.loginEvent.groupBy({ by: ['username'], where: { tenantId: id, success: true }, _max: { createdAt: true }, _count: true }),
      this.db.platformAudit.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 40 }),
    ]);
    const modules: Record<string, number> = {};
    for (const u of usage) for (const [k, v] of Object.entries((u.modules ?? {}) as Record<string, number>)) modules[k] = (modules[k] ?? 0) + v;
    const activeNow = new Set(seen.filter((s) => s.lastSeen.getTime() > Date.now() - ACTIVE_NOW_MS).map((s) => s.username)).size;
    return {
      tenant: this.row(t, { users: { users: counts.users, active: users.filter((u) => u.isActive).length }, activeNow, requests7d: usage.filter((u) => u.day.getTime() > Date.now() - 7 * DAY).reduce((s, u) => s + u.requests, 0) }),
      counts, lastSaleAt: lastSale?.createdAt ?? null,
      users: users.map((u) => {
        const l = loginByUser.find((x) => x.username === u.username);
        return { ...u, role: u.role.name, lastLoginAt: l?._max.createdAt ?? null, logins: l?._count ?? 0 };
      }),
      usage: usage.map((u) => ({ day: u.day.toISOString().slice(0, 10), requests: u.requests, writes: u.writes, errors: u.errors })),
      modules: Object.entries(modules).sort((x, y) => y[1] - x[1]).map(([module, requests]) => ({ module, requests })),
      sessions: seen, logins, history,
      countries: [...new Set(seen.map((s) => s.country).filter((c): c is string => !!c))],
    };
  }

  @Patch('tenants/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateTenantDto, @CurrentAdmin() a: Admin) {
    const before = await this.db.tenant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    if (before.isMain && dto.status === 'TRIAL') throw new BadRequestException('The original business cannot be a trial');
    const row = await this.db.tenant.update({
      where: { id },
      data: {
        name: dto.name?.trim(), contactName: dto.contactName, phone: dto.phone, email: dto.email === '' ? null : dto.email, city: dto.city, notes: dto.notes,
        status: before.status === 'SUSPENDED' ? undefined : dto.status,
        expiresAt: dto.expiresAt === undefined ? undefined : dto.expiresAt === '' ? null : new Date(dto.expiresAt),
        maxUsers: dto.maxUsers === undefined ? undefined : dto.maxUsers === 0 ? null : dto.maxUsers,
        monthlyFee: dto.monthlyFee === undefined ? undefined : dto.monthlyFee === 0 ? null : dto.monthlyFee,
      },
    });
    await this.audit(a, 'UPDATE_TENANT', row, JSON.parse(JSON.stringify(dto)));
    this.tenancy.forget(row.code);
    return this.row(row, {});
  }

  @Post('tenants/:id/suspend')
  async suspend(@Param('id') id: string, @Body() dto: SuspendDto, @CurrentAdmin() a: Admin) {
    const t = await this.db.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.isMain) throw new BadRequestException('The original business cannot be suspended');
    const row = await this.db.tenant.update({ where: { id }, data: { status: 'SUSPENDED', suspendedReason: dto.reason?.trim() || null } });
    await this.audit(a, 'SUSPEND_TENANT', row, { reason: dto.reason ?? null });
    this.tenancy.forget(row.code);
    return this.row(row, {});
  }

  @Post('tenants/:id/activate')
  async activate(@Param('id') id: string, @CurrentAdmin() a: Admin) {
    const t = await this.db.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    const row = await this.db.tenant.update({ where: { id }, data: { status: 'ACTIVE', suspendedReason: null } });
    await this.audit(a, 'ACTIVATE_TENANT', row);
    this.tenancy.forget(row.code);
    return this.row(row, {});
  }

  /** A new password for the owner account (or another account) when its holder is locked out. */
  @Post('tenants/:id/reset-owner')
  async resetOwner(@Param('id') id: string, @Body() dto: ResetOwnerDto, @CurrentAdmin() a: Admin) {
    const t = await this.db.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    const db = this.prisma.forSchema(t.schemaName);
    const username = dto.username?.trim() || 'owner';
    const user = await db.appUser.findUnique({ where: { username } });
    if (!user) throw new NotFoundException(`There is no account named “${username}” in this business`);
    const password = dto.password ?? newPassword();
    await db.appUser.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 10), isActive: true } });
    await this.audit(a, 'RESET_PASSWORD', t, { username });
    return { username, password };
  }

  /** Removes a business and all its data for good. The code must be typed to confirm. */
  @Delete('tenants/:id')
  async remove(@Param('id') id: string, @Body() dto: DeleteTenantDto, @CurrentAdmin() a: Admin) {
    const t = await this.db.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.isMain) throw new ForbiddenException('The original business cannot be deleted');
    if (dto.confirm !== t.code) throw new BadRequestException('Type the business code exactly to confirm');
    await this.audit(a, 'DELETE_TENANT', t, { code: t.code });
    await dropSchema(t.schemaName);
    await this.db.tenant.delete({ where: { id } });
    this.tenancy.forget(t.code);
    return { ok: true };
  }

  @Get('logins')
  async logins(@Query('tenantId') tenantId?: string, @Query('result') result?: string, @Query('q') q?: string, @Query('limit') limit?: string, @Query('before') before?: string) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await this.db.loginEvent.findMany({
      where: {
        tenantId: tenantId || undefined,
        success: result === 'ok' ? true : result === 'failed' ? false : undefined,
        createdAt: before ? { lt: new Date(before) } : undefined,
        OR: q ? [{ username: { contains: q, mode: 'insensitive' } }, { ip: { contains: q } }, { city: { contains: q, mode: 'insensitive' } }, { tenantCode: { contains: q, mode: 'insensitive' } }] : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      include: { tenant: { select: { name: true, code: true } } },
    });
    return { rows: rows.slice(0, take).map((e) => ({ ...e, tenantName: e.tenant?.name ?? null })), more: rows.length > take };
  }

  /** Everyone seen working lately, across all businesses. */
  @Get('sessions')
  async sessions(@Query('hours') hours?: string) {
    const since = new Date(Date.now() - Math.min(Math.max(Number(hours) || 24, 1), 24 * 30) * 3_600_000);
    const rows = await this.db.tenantUserSeen.findMany({ where: { lastSeen: { gte: since } }, orderBy: { lastSeen: 'desc' }, take: 300, include: { tenant: { select: { name: true, code: true } } } });
    return rows.map((r) => ({ ...r, tenantName: r.tenant.name, tenantCode: r.tenant.code, activeNow: r.lastSeen.getTime() > Date.now() - ACTIVE_NOW_MS }));
  }

  @Get('audit')
  audits() {
    return this.db.platformAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @Get('admins')
  async admins() {
    return (await this.db.platformAdmin.findMany({ orderBy: { createdAt: 'asc' } })).map(({ passwordHash: _h, ...a }) => a);
  }

  @Post('admins')
  async addAdmin(@Body() dto: AdminDto, @CurrentAdmin() a: Admin) {
    if (await this.db.platformAdmin.findUnique({ where: { username: dto.username } })) throw new ConflictException('That username is taken');
    const row = await this.db.platformAdmin.create({ data: { username: dto.username, passwordHash: await bcrypt.hash(dto.password, 10), displayName: dto.displayName } });
    await this.audit(a, 'CREATE_ADMIN', null, { username: row.username });
    return { id: row.id, username: row.username, displayName: row.displayName, isActive: row.isActive };
  }

  @Patch('admins/:id')
  async updateAdmin(@Param('id') id: string, @Body() dto: UpdateAdminDto, @CurrentAdmin() a: Admin) {
    if (id === a.id && dto.isActive === false) throw new BadRequestException('You cannot turn off your own account');
    const row = await this.db.platformAdmin.update({
      where: { id },
      data: { isActive: dto.isActive, displayName: dto.displayName, passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : undefined },
    });
    await this.audit(a, 'UPDATE_ADMIN', null, { username: row.username, isActive: dto.isActive ?? null, passwordChanged: !!dto.password });
    return { id: row.id, username: row.username, displayName: row.displayName, isActive: row.isActive };
  }

  /** A readable code from the business name, with a number added if it is taken. */
  private async freeCode(name: string) {
    const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 26) || 'business';
    let code = base.length >= 3 ? base : `${base}-co`;
    for (let n = 2; RESERVED.has(code) || (await this.db.tenant.findUnique({ where: { code } })); n++) code = `${base}-${n}`;
    return code;
  }
}

@Module({ controllers: [PlatformAuthController, PlatformController], providers: [PlatformGuard], exports: [PlatformGuard] })
export class PlatformModule {}

