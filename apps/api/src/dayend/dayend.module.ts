import { BadRequestException, Body, Controller, Get, Injectable, Module, Put, Query } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = () => new D(0);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

class CloseDto {
  @Matches(DAY) date: string;
  /** Cash actually counted in the drawer. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) counted: number;
  /** Only needed when there is no earlier count to start from. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) openingCash?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

interface Item { label: string; amount: Dec; note?: string | null; count?: number }

@Injectable()
export class DayEndService {
  constructor(private prisma: PrismaService) {}

  /**
   * What happened on a day, and what the cash drawer should hold because of it.
   * Cash in: bills and khata receipts paid in cash (walk-in cash sales count as cash).
   * Cash out: expenses, salary advances and supplier payments made in cash (including purchases paid on the spot).
   * Bank, wallet and cheque money is listed but is not in the drawer.
   */
  async compute(date: Date) {
    const [sales, pays, expenses, advances, supplierPays, previous, closed] = await Promise.all([
      this.prisma.sale.findMany({ where: { date, status: 'ACTIVE' }, select: { net: true, paidNow: true, customerId: true } }),
      this.prisma.payment.findMany({ where: { date, status: 'ACTIVE' }, select: { amount: true, method: true, saleId: true } }),
      this.prisma.expense.findMany({ where: { date, status: 'ACTIVE' }, select: { amount: true, category: true, note: true, source: true } }),
      this.prisma.salaryAdvance.findMany({ where: { date, status: 'ACTIVE' }, select: { amount: true, note: true, employee: { select: { name: true } } } }),
      this.prisma.supplierPayment.findMany({ where: { date, method: 'CASH' }, select: { amount: true, note: true, supplier: { select: { name: true } } } }),
      this.prisma.dayClose.findFirst({ where: { date: { lt: date } }, orderBy: { date: 'desc' }, select: { date: true, counted: true } }),
      this.prisma.dayClose.findUnique({ where: { date } }),
    ]);
    const sum = (xs: Dec[]) => xs.reduce((t, x) => t.plus(x), ZERO());

    const net = sum(sales.map((s) => s.net));
    const udhaar = sum(sales.filter((s) => s.customerId && s.net.gt(s.paidNow)).map((s) => s.net.minus(s.paidNow)));

    const walkIn = sum(sales.filter((s) => !s.customerId).map((s) => s.paidNow));
    const cashPays = pays.filter((p) => p.method === 'CASH');
    const withBills = sum(cashPays.filter((p) => p.saleId).map((p) => p.amount)).plus(walkIn);
    const khata = sum(cashPays.filter((p) => !p.saleId).map((p) => p.amount));
    const cashInItems: Item[] = [
      { label: 'Cash taken with bills', amount: withBills, count: cashPays.filter((p) => p.saleId).length + sales.filter((s) => !s.customerId && s.paidNow.gt(0)).length },
      { label: 'Old khata received in cash', amount: khata, count: cashPays.filter((p) => !p.saleId).length },
    ].filter((i) => i.amount.gt(0));

    const byMethod = new Map<string, { amount: Dec; count: number }>();
    for (const p of pays.filter((x) => x.method !== 'CASH')) {
      const m = byMethod.get(p.method) ?? { amount: ZERO(), count: 0 };
      byMethod.set(p.method, { amount: m.amount.plus(p.amount), count: m.count + 1 });
    }

    const byCategory = new Map<string, { amount: Dec; count: number }>();
    for (const e of expenses) {
      const m = byCategory.get(e.category) ?? { amount: ZERO(), count: 0 };
      byCategory.set(e.category, { amount: m.amount.plus(e.amount), count: m.count + 1 });
    }
    const cashOutItems: Item[] = [
      ...[...byCategory].map(([label, v]) => ({ label: `Expense: ${label}`, amount: v.amount, count: v.count })),
      ...advances.map((a) => ({ label: `Advance to ${a.employee.name}`, amount: a.amount, note: a.note })),
      // A purchase paid on the spot is recorded as a supplier payment too, so it is counted here once.
      ...supplierPays.map((p) => ({ label: `Paid ${p.supplier.name}`, amount: p.amount, note: p.note })),
    ];

    const cashIn = sum(cashInItems.map((i) => i.amount));
    const cashOut = sum(cashOutItems.map((i) => i.amount));
    // The opening cash is the last count; once a day is closed its own opening figure stays as it was.
    const openingCash = closed?.openingCash ?? previous?.counted ?? null;
    const expected = (openingCash ?? ZERO()).plus(cashIn).minus(cashOut);
    return {
      date: date.toISOString().slice(0, 10),
      bills: { count: sales.length, net, udhaar },
      cashIn: { total: cashIn, items: cashInItems },
      otherIn: { total: sum([...byMethod.values()].map((m) => m.amount)), items: [...byMethod].map(([method, v]) => ({ method, amount: v.amount, count: v.count })) },
      cashOut: { total: cashOut, items: cashOutItems },
      previous: previous ? { date: previous.date.toISOString().slice(0, 10), counted: previous.counted } : null,
      openingCash, expected, closed,
    };
  }
}

@Controller('day-end')
class DayEndController {
  constructor(private svc: DayEndService, private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermissions('PAYMENT_RECORD')
  day(@Query('date') date?: string) {
    if (date && !DAY.test(date)) throw new BadRequestException('date must look like 2026-11-08');
    return this.svc.compute(dayOf(date));
  }

  @Get('history') @RequirePermissions('PAYMENT_RECORD')
  async history(@Query('limit') limit?: string) {
    const rows = await this.prisma.dayClose.findMany({ orderBy: { date: 'desc' }, take: Math.min(Math.max(Number(limit) || 14, 1), 90) });
    const users = await this.prisma.appUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.closedById))] } }, select: { id: true, username: true } });
    return rows.map((r) => ({ ...r, closedBy: users.find((u) => u.id === r.closedById)?.username ?? null }));
  }

  /** Saves the cash count for a day. Saving again for the same day replaces the count (and is recorded). */
  @Put() @RequirePermissions('PAYMENT_RECORD')
  async close(@Body() dto: CloseDto, @CurrentUser() u: AuthUser) {
    const date = dayOf(dto.date);
    if (date.getTime() > dayOf().getTime()) throw new BadRequestException('A day cannot be closed before it has happened');
    const day = await this.svc.compute(date);
    if (day.openingCash === null && dto.openingCash === undefined) throw new BadRequestException('There is no earlier count to start from. Enter the cash that was in the drawer when the day started.');
    const openingCash = day.closed ? day.closed.openingCash : day.openingCash ?? new D(dto.openingCash ?? 0);
    const expected = openingCash.plus(day.cashIn.total).minus(day.cashOut.total);
    const counted = new D(dto.counted);
    const data = {
      openingCash, cashIn: day.cashIn.total, cashOut: day.cashOut.total, expected, counted, difference: counted.minus(expected),
      note: dto.note?.trim() || null,
      summary: { bills: day.bills.count, net: day.bills.net.toString(), udhaar: day.bills.udhaar.toString(), otherIn: day.otherIn.total.toString() },
      closedById: u.id, closedAt: new Date(),
    };
    const before = day.closed;
    const row = await this.prisma.dayClose.upsert({ where: { date }, create: { date, ...data }, update: data });
    await this.audit.log(u.id, before ? 'DAY_REOPEN_RECLOSE' : 'DAY_CLOSE', 'DayClose', row.id, before ?? undefined, { date: dto.date, counted: dto.counted, difference: row.difference.toString() });
    return row;
  }
}

@Module({ controllers: [DayEndController], providers: [DayEndService] })
export class DayEndModule {}
