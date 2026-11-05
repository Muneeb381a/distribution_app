import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { AttendanceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';
import { monthName, rupees } from '@dist/shared';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
type Db = Prisma.TransactionClient;

/** Salary per day for monthly staff = monthly salary / 30. */
const DAYS_IN_PAY_MONTH = 30;
export const DEFAULT_EXPENSE_CATEGORIES = ['Utility bills', 'Rent', 'Salaries', 'Fuel', 'Vehicle maintenance', 'Other'];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** First and last calendar day of "2026-11" as UTC dates. */
export function monthRange(month: string) {
  if (!MONTH.test(month)) throw new BadRequestException('month must look like 2026-11');
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
}

class ExpenseDto {
  @IsOptional() @IsISO8601() date?: string;
  @IsString() @MaxLength(60) category: string;
  /** Godown or shop the cost is for; leave out for a general cost. */
  @IsOptional() @IsUUID() locationId?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount: number;
  @IsOptional() @IsString() note?: string;
}

class AdvanceDto {
  @IsUUID() employeeId: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount: number;
  /** Cut from each salary; leave out to recover it all from the next salary. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() installment?: number;
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class InstallmentDto {
  /** New monthly cut; null = recover the whole remainder from the next salary. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() installment?: number | null;
}

class RepayDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount: number;
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class DeductionDto {
  @IsUUID() advanceId: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount: number;
}

class AttendanceEntryDto {
  @IsUUID() employeeId: string;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
}
class AttendanceDto {
  @IsISO8601() date: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AttendanceEntryDto) entries: AttendanceEntryDto[];
}

class PayrollDto {
  @IsUUID() employeeId: string;
  @Matches(MONTH) month: string;
  /** This month's cut per advance, when the owner changes the planned amounts (0 = skip this month). */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => DeductionDto) deductions?: DeductionDto[];
}

class CancelRunDto {
  @IsString() @MinLength(3) @MaxLength(200) reason: string;
}

type OpenAdvance = { id: string; date: Date; amount: Dec; installment: Dec | null; note: string | null; recovered: Dec; remaining: Dec };

/** An employee's advances that still have something owed, oldest first. */
export async function openAdvances(db: Db | PrismaService, employeeId: string, upTo?: Date): Promise<OpenAdvance[]> {
  const rows = await db.salaryAdvance.findMany({
    where: { employeeId, status: 'ACTIVE', date: upTo ? { lte: upTo } : undefined },
    include: { recoveries: { where: { status: 'ACTIVE' }, select: { amount: true } } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  return rows
    .map(({ recoveries, ...a }) => {
      const recovered = recoveries.reduce((s, r) => s.plus(r.amount), new D(0));
      return { ...a, recovered, remaining: a.amount.minus(recovered) };
    })
    .filter((a) => a.remaining.gt(0));
}

/**
 * This month's cut from each open advance: its instalment (or the whole remainder), oldest first,
 * never more than the salary earned, so net pay is never negative. Whatever is not cut stays owed.
 * The owner may change the cut per advance (0 = skip this month); those must still fit the salary.
 */
export function planCuts(open: OpenAdvance[], available: Dec, overrides?: { advanceId: string; amount: number }[]) {
  const given = new Map((overrides ?? []).map((o) => [o.advanceId, new D(o.amount)]));
  for (const id of given.keys()) if (!open.some((a) => a.id === id)) throw new BadRequestException('A deduction refers to an advance that is not open');
  let left = available;
  const cuts = open.map((a) => {
    const planned = D.min(a.installment ?? a.remaining, a.remaining);
    let amount: Dec;
    const g = given.get(a.id);
    if (g) {
      if (g.gt(a.remaining)) throw new BadRequestException(`Only Rs ${a.remaining.toFixed(2)} is left on the advance of ${a.date.toISOString().slice(0, 10)}`);
      amount = g;
    } else {
      amount = D.min(planned, D.max(left, 0));
    }
    left = left.minus(amount);
    return { advanceId: a.id, date: a.date, note: a.note, total: a.amount, installment: a.installment, remaining: a.remaining, planned, amount };
  });
  if (left.lt(0)) throw new BadRequestException(`Deductions are more than the salary (Rs ${available.toFixed(2)} available)`);
  return cuts;
}

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  /** Works out one employee's month without saving anything. */
  async calc(db: Db | PrismaService, employeeId: string, month: string, overrides?: DeductionDto[]) {
    const { start, end } = monthRange(month);
    const emp = await db.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw new NotFoundException('Unknown employee');

    const att = await db.attendance.groupBy({
      by: ['status'],
      where: { employeeId, date: { gte: start, lte: end } },
      _count: true,
    });
    const days = (s: AttendanceStatus) => att.find((a) => a.status === s)?._count ?? 0;
    const present = days('PRESENT');
    const half = days('HALF_DAY');
    const paidLeave = days('PAID_LEAVE');
    const absentDays = days('ABSENT') + days('UNPAID_LEAVE') + half * 0.5;

    let base: Dec;
    let absenceDeduction = new D(0);
    if (emp.type === 'MONTHLY') {
      base = emp.monthlySalary ?? new D(0);
      absenceDeduction = D.min(base, base.div(DAYS_IN_PAY_MONTH).mul(absentDays)).toDecimalPlaces(2);
    } else {
      base = (emp.dailyWage ?? new D(0)).mul(present + half * 0.5 + paidLeave).toDecimalPlaces(2);
    }

    let commission = new D(0);
    let salesNet = new D(0);
    if (emp.commissionPercent) {
      const s = await db.sale.aggregate({
        where: { salesmanId: employeeId, status: 'ACTIVE', date: { gte: start, lte: end } },
        _sum: { net: true },
      });
      salesNet = s._sum.net ?? new D(0);
      if (salesNet.gt(0)) commission = salesNet.mul(emp.commissionPercent).div(100).toDecimalPlaces(2);
    }

    // Runs from before instalments could carry an over-deduction into the next month; honour it first.
    const prev = await db.payrollRun.findFirst({ where: { employeeId, status: 'ACTIVE', month: { lt: month } }, orderBy: { month: 'desc' } });
    const carryIn = prev?.carryOut ?? new D(0);
    const gross = base.plus(commission).minus(absenceDeduction);

    const open = (await openAdvances(db, employeeId, end));
    const available = D.max(gross.minus(carryIn), 0);
    const cuts = planCuts(open, available, overrides);
    const advanceTotal = cuts.reduce((s, c) => s.plus(c.amount), new D(0));
    const net = gross.minus(advanceTotal).minus(carryIn);
    return {
      employee: { id: emp.id, name: emp.name, type: emp.type },
      month,
      base,
      commission,
      absenceDeduction,
      gross,
      advances: advanceTotal,
      /** Each open advance with what this month cuts from it; the rest stays owed. */
      cuts: cuts.map((c) => ({ ...c, amount: c.amount.toString(), planned: c.planned.toString(), remaining: c.remaining.toString(), installment: c.installment?.toString() ?? null })),
      /** What is still owed after this month's cuts. */
      owedAfter: open.reduce((s, a) => s.plus(a.remaining), new D(0)).minus(advanceTotal),
      carryIn,
      netPaid: D.max(net, 0),
      carryOut: D.max(net.neg(), 0),
      details: {
        attendance: { present, halfDay: half, absent: days('ABSENT'), paidLeave, unpaidLeave: days('UNPAID_LEAVE') },
        absentDaysDeducted: absentDays,
        salesNet: salesNet.toString(),
        commissionPercent: emp.commissionPercent?.toString() ?? null,
        advances: cuts.filter((c) => c.amount.gt(0)).map((c) => ({ id: c.advanceId, date: c.date, amount: c.amount.toString(), of: c.total.toString(), left: c.remaining.minus(c.amount).toString(), note: c.note })),
      },
    };
  }
}

function withRemaining<T extends { amount: Dec }>(a: T, recoveries: { amount: Dec }[]) {
  const recovered = recoveries.reduce((s, r) => s.plus(r.amount), new D(0));
  return { ...a, recovered: recovered.toString(), remaining: a.amount.minus(recovered).toString() };
}

@Controller()
class HrController {
  constructor(private prisma: PrismaService, private payroll: PayrollService, private audit: AuditService) {}

  // ----------------------------------------------------------- expenses

  @Get('expenses/categories') @RequirePermissions('EXPENSE_MANAGE')
  async categories() {
    const used = await this.prisma.expense.findMany({ distinct: ['category'], select: { category: true } });
    return [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...used.map((u) => u.category)])];
  }

  @Get('expenses') @RequirePermissions('EXPENSE_MANAGE')
  expenses(@Query() q: { from?: string; to?: string; category?: string; locationId?: string }) {
    return this.prisma.expense.findMany({
      where: {
        category: q.category,
        locationId: q.locationId === 'none' ? null : q.locationId || undefined,
        date: q.from || q.to ? { gte: q.from ? dayOf(q.from) : undefined, lte: q.to ? dayOf(q.to) : undefined } : undefined,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: { location: { select: { id: true, name: true, type: true } } },
    });
  }

  @Post('expenses') @RequirePermissions('EXPENSE_MANAGE')
  async addExpense(@Body() dto: ExpenseDto, @CurrentUser() u: AuthUser) {
    const category = dto.category.trim();
    if (!category) throw new BadRequestException('Category is required');
    if (dto.locationId) {
      const loc = await this.prisma.location.findUnique({ where: { id: dto.locationId } });
      if (!loc?.isActive || loc.type === 'VEHICLE') throw new BadRequestException('Pick a godown or shop');
    }
    const row = await this.prisma.expense.create({
      data: { date: dayOf(dto.date), category, locationId: dto.locationId, amount: dto.amount, note: dto.note, createdById: u.id },
    });
    await this.audit.log(u.id, 'CREATE', 'Expense', row.id, undefined, row);
    return row;
  }

  @Post('expenses/:id/cancel') @RequirePermissions('EXPENSE_MANAGE')
  async cancelExpense(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const e = await this.prisma.expense.findUnique({ where: { id } });
    if (!e) throw new NotFoundException();
    if (e.source) throw new BadRequestException('This expense was created by payroll');
    if (e.status === 'CANCELLED') throw new ConflictException('Already cancelled');
    const row = await this.prisma.expense.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log(u.id, 'CANCEL', 'Expense', id, e, row);
    return row;
  }

  // --------------------------------------------------------- attendance

  @Get('attendance') @RequirePermissions('PAYROLL_MANAGE')
  attendance(@Query('month') month: string) {
    const { start, end } = monthRange(month);
    return this.prisma.attendance.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' } });
  }

  @Put('attendance') @RequirePermissions('PAYROLL_MANAGE')
  async markAttendance(@Body() dto: AttendanceDto, @CurrentUser() u: AuthUser) {
    const date = dayOf(dto.date);
    const month = date.toISOString().slice(0, 7);
    const locked = await this.prisma.payrollRun.findMany({
      where: { month, status: 'ACTIVE', employeeId: { in: dto.entries.map((e) => e.employeeId) } },
      select: { employeeId: true },
    });
    if (locked.length) throw new BadRequestException('Payroll for this month is already finalised for some of these employees');
    await this.prisma.$transaction(
      dto.entries.map((e) =>
        this.prisma.attendance.upsert({
          where: { employeeId_date: { employeeId: e.employeeId, date } },
          update: { status: e.status },
          create: { employeeId: e.employeeId, date, status: e.status },
        }),
      ),
    );
    await this.audit.log(u.id, 'ATTENDANCE', 'Attendance', undefined, undefined, { date: dto.date, count: dto.entries.length });
    return { ok: true };
  }

  // ----------------------------------------------------------- advances

  /** Advances with what has been recovered and what is left. */
  @Get('advances') @RequirePermissions('PAYROLL_MANAGE')
  async advances(@Query('employeeId') employeeId?: string) {
    const rows = await this.prisma.salaryAdvance.findMany({
      where: { employeeId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      include: { employee: { select: { name: true } }, recoveries: { where: { status: 'ACTIVE' }, select: { amount: true } } },
    });
    return rows.map(({ recoveries, ...a }) => withRemaining(a, recoveries));
  }

  /** One advance with every cut and repayment, for the advance slip. */
  @Get('advances/:id') @RequirePermissions('PAYROLL_MANAGE')
  async advance(@Param('id') id: string) {
    const a = await this.prisma.salaryAdvance.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, name: true, phone: true, type: true } },
        recoveries: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], include: { payrollRun: { select: { id: true, month: true } } } },
      },
    });
    if (!a) throw new NotFoundException();
    const by = await this.prisma.appUser.findUnique({ where: { id: a.createdById }, select: { username: true } });
    return { ...withRemaining(a, a.recoveries.filter((r) => r.status === 'ACTIVE')), createdBy: by?.username ?? null };
  }

  @Post('advances') @RequirePermissions('PAYROLL_MANAGE')
  async addAdvance(@Body() dto: AdvanceDto, @CurrentUser() u: AuthUser) {
    const emp = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!emp?.isActive) throw new BadRequestException('Unknown or inactive employee');
    if (dto.installment && dto.installment > dto.amount) throw new BadRequestException('The monthly cut cannot be more than the advance');
    const row = await this.prisma.salaryAdvance.create({
      data: { employeeId: dto.employeeId, amount: dto.amount, installment: dto.installment, date: dayOf(dto.date), note: dto.note, createdById: u.id },
    });
    await this.audit.log(u.id, 'CREATE', 'SalaryAdvance', row.id, undefined, row);
    return row;
  }

  /** Change the monthly cut of an advance that is still being recovered. */
  @Put('advances/:id/installment') @RequirePermissions('PAYROLL_MANAGE')
  async setInstallment(@Param('id') id: string, @Body() dto: InstallmentDto, @CurrentUser() u: AuthUser) {
    const a = await this.prisma.salaryAdvance.findUnique({ where: { id } });
    if (!a || a.status !== 'ACTIVE') throw new NotFoundException();
    if (dto.installment && new D(dto.installment).gt(a.amount)) throw new BadRequestException('The monthly cut cannot be more than the advance');
    const row = await this.prisma.salaryAdvance.update({ where: { id }, data: { installment: dto.installment ?? null } });
    await this.audit.log(u.id, 'UPDATE', 'SalaryAdvance', id, a, row);
    return row;
  }

  /** The employee hands back cash against an advance. */
  @Post('advances/:id/repay') @RequirePermissions('PAYROLL_MANAGE')
  async repay(@Param('id') id: string, @Body() dto: RepayDto, @CurrentUser() u: AuthUser) {
    const row = await this.prisma.$transaction(async (tx) => {
      const adv = await tx.salaryAdvance.findUnique({ where: { id }, select: { employeeId: true } });
      if (!adv) throw new NotFoundException();
      const a = (await openAdvances(tx, adv.employeeId)).find((x) => x.id === id);
      if (!a) throw new BadRequestException('This advance is already fully recovered or cancelled');
      if (new D(dto.amount).gt(a.remaining)) throw new BadRequestException(`Only Rs ${a.remaining.toFixed(2)} is left on this advance`);
      return tx.advanceRecovery.create({ data: { advanceId: id, amount: dto.amount, date: dayOf(dto.date), note: dto.note ?? 'Cash repaid', createdById: u.id } });
    });
    await this.audit.log(u.id, 'CREATE', 'AdvanceRecovery', row.id, undefined, row);
    return row;
  }

  /** Undo a cash repayment entered by mistake. Cuts made by payroll are undone by cancelling that payroll. */
  @Post('advances/recoveries/:id/cancel') @RequirePermissions('PAYROLL_MANAGE')
  async cancelRepayment(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const r = await this.prisma.advanceRecovery.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.payrollRunId) throw new BadRequestException('This was cut by payroll; cancel that payroll instead');
    if (r.status === 'CANCELLED') throw new ConflictException('Already cancelled');
    const row = await this.prisma.advanceRecovery.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log(u.id, 'CANCEL', 'AdvanceRecovery', id, r, row);
    return row;
  }

  @Post('advances/:id/cancel') @RequirePermissions('PAYROLL_MANAGE')
  async cancelAdvance(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const a = await this.prisma.salaryAdvance.findUnique({ where: { id }, include: { recoveries: { where: { status: 'ACTIVE' }, select: { id: true } } } });
    if (!a) throw new NotFoundException();
    if (a.recoveries.length) throw new BadRequestException('Part of this advance is already recovered; cancel those first');
    if (a.status === 'CANCELLED') throw new ConflictException('Already cancelled');
    const { recoveries: _r, ...before } = a;
    const row = await this.prisma.salaryAdvance.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log(u.id, 'CANCEL', 'SalaryAdvance', id, before, row);
    return row;
  }

  /**
   * Everything between the business and one employee, oldest first: advances given, cuts and
   * repayments, and salaries paid, with what the employee still owes after each step.
   */
  @Get('employees/:id/ledger') @RequirePermissions('PAYROLL_MANAGE')
  async ledger(@Param('id') id: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException();
    const [advances, runs] = await Promise.all([
      this.prisma.salaryAdvance.findMany({ where: { employeeId: id }, include: { recoveries: { include: { payrollRun: { select: { month: true, createdAt: true } } } } } }),
      this.prisma.payrollRun.findMany({ where: { employeeId: id }, orderBy: { month: 'asc' } }),
    ]);
    type Entry = { date: Date; at: Date; kind: 'ADVANCE' | 'CUT' | 'REPAID' | 'SALARY'; ref: string; text: string; owed: Dec; paid: Dec; cancelled: boolean };
    const entries: Entry[] = [];
    for (const a of advances) {
      entries.push({ date: a.date, at: a.createdAt, kind: 'ADVANCE', ref: a.id, text: `Advance${a.installment ? ` · Rs ${rupees(a.installment.toString())} a month` : ' · all from next salary'}${a.note ? ` · ${a.note}` : ''}`, owed: a.amount, paid: new D(0), cancelled: a.status === 'CANCELLED' });
      for (const r of a.recoveries) {
        entries.push({
          // a payroll cut sits just before the salary row of the same run
          date: r.date, at: r.payrollRun ? new Date(r.payrollRun.createdAt.getTime() - 1) : r.createdAt, kind: r.payrollRunId ? 'CUT' : 'REPAID', ref: r.payrollRunId ?? a.id,
          text: r.payrollRunId ? `Cut from ${r.payrollRun ? monthName(r.payrollRun.month) : ''} salary` : (r.note ?? 'Cash repaid'),
          owed: r.amount.neg(), paid: new D(0), cancelled: r.status === 'CANCELLED' || a.status === 'CANCELLED',
        });
      }
    }
    for (const r of runs) {
      entries.push({ date: r.paidOn, at: r.createdAt, kind: 'SALARY', ref: r.id, text: `${monthName(r.month)} salary · earned Rs ${rupees(r.gross.toString())}`, owed: r.carryOut.minus(r.carryIn), paid: r.netPaid, cancelled: r.status === 'CANCELLED' });
    }
    entries.sort((x, y) => x.date.getTime() - y.date.getTime() || x.at.getTime() - y.at.getTime());
    let owed = new D(0);
    const rows = entries.map((e) => {
      if (!e.cancelled) owed = owed.plus(e.owed);
      return { date: e.date, kind: e.kind, ref: e.ref, text: e.text, owed: e.owed.toString(), paid: e.paid.toString(), cancelled: e.cancelled, balance: owed.toString() };
    });
    const open = await openAdvances(this.prisma, id);
    const active = runs.filter((r) => r.status === 'ACTIVE');
    return {
      employee: { id: employee.id, name: employee.name, phone: employee.phone, type: employee.type, monthlySalary: employee.monthlySalary, dailyWage: employee.dailyWage, isActive: employee.isActive },
      owed: owed.toString(),
      openAdvances: open.length,
      monthlyCut: open.reduce((s, a) => s.plus(D.min(a.installment ?? a.remaining, a.remaining)), new D(0)).toString(),
      totals: {
        advanced: advances.filter((a) => a.status === 'ACTIVE').reduce((s, a) => s.plus(a.amount), new D(0)).toString(),
        salaryPaid: active.reduce((s, r) => s.plus(r.netPaid), new D(0)).toString(),
        earned: active.reduce((s, r) => s.plus(r.gross), new D(0)).toString(),
      },
      entries: rows.reverse(),
    };
  }

  // ------------------------------------------------------------ payroll

  /** What the salary would be. Safe to call repeatedly. */
  @Get('payroll/preview') @RequirePermissions('PAYROLL_MANAGE')
  async preview(@Query('employeeId') employeeId: string, @Query('month') month: string) {
    if (!employeeId) throw new BadRequestException('employeeId is required');
    const existing = await this.prisma.payrollRun.findFirst({ where: { employeeId, month, status: 'ACTIVE' } });
    const calc = await this.payroll.calc(this.prisma, employeeId, month);
    if (!existing) return { alreadyRun: null, ...calc };
    // A finalised month shows what was actually paid, not a fresh calculation (its advances are already deducted).
    const { id, base, commission, absenceDeduction, gross, advances, carryIn, netPaid, carryOut, details } = existing;
    return { ...calc, alreadyRun: { id, status: existing.status }, base, commission, absenceDeduction, gross, advances, carryIn, netPaid, carryOut, details };
  }

  /** Finalises the month: deducts the advances, posts the salary expense, records what was paid. */
  @Post('payroll/run') @RequirePermissions('PAYROLL_MANAGE')
  async run(@Body() dto: PayrollDto, @CurrentUser() u: AuthUser) {
    const { end } = monthRange(dto.month);
    const run = await this.prisma.$transaction(async (tx) => {
      if (await tx.payrollRun.findFirst({ where: { employeeId: dto.employeeId, month: dto.month, status: 'ACTIVE' } })) {
        throw new ConflictException('Payroll for this employee and month is already finalised');
      }
      const c = await this.payroll.calc(tx, dto.employeeId, dto.month, dto.deductions);
      const created = await tx.payrollRun.create({
        data: {
          employeeId: dto.employeeId, month: dto.month, base: c.base, commission: c.commission,
          absenceDeduction: c.absenceDeduction, gross: c.gross, advances: c.advances, carryIn: c.carryIn,
          netPaid: c.netPaid, carryOut: c.carryOut, details: c.details, paidOn: dayOf(), createdById: u.id,
        },
      });
      const cuts = c.cuts.filter((x) => Number(x.amount) > 0);
      if (cuts.length) {
        await tx.advanceRecovery.createMany({
          data: cuts.map((x) => ({ advanceId: x.advanceId, payrollRunId: created.id, date: created.paidOn, amount: x.amount, createdById: u.id })),
        });
      }
      // The salary expense is what was earned; advances were already cash out and are not a second expense.
      if (c.gross.gt(0)) {
        await tx.expense.create({
          data: {
            date: end, category: 'Salaries', amount: c.gross, note: `${c.employee.name} ${dto.month}`,
            source: 'PAYROLL', sourceId: created.id, createdById: u.id,
          },
        });
      }
      return created;
    });
    await this.audit.log(u.id, 'RUN', 'PayrollRun', run.id, undefined, run);
    return run;
  }

  @Get('payroll') @RequirePermissions('PAYROLL_MANAGE')
  list(@Query('month') month?: string, @Query('employeeId') employeeId?: string) {
    return this.prisma.payrollRun.findMany({
      where: { month, employeeId },
      orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      include: { employee: { select: { name: true, type: true } } },
    });
  }

  /**
   * Undo a finalised month: the salary expense is cancelled and the advances it deducted become open again,
   * so the month can be corrected and run once more. A later month that already used this one's carry-over must be cancelled first.
   */
  @Post('payroll/:id/cancel') @RequirePermissions('PAYROLL_MANAGE')
  async cancelRun(@Param('id') id: string, @Body() dto: CancelRunDto, @CurrentUser() u: AuthUser) {
    const run = await this.prisma.$transaction(async (tx) => {
      const r = await tx.payrollRun.findUnique({ where: { id } });
      if (!r) throw new NotFoundException();
      if (r.status === 'CANCELLED') throw new ConflictException('Already cancelled');
      const later = await tx.payrollRun.findFirst({ where: { employeeId: r.employeeId, status: 'ACTIVE', month: { gt: r.month } } });
      if (later) throw new BadRequestException(`Cancel ${later.month} first: it was calculated after this month`);
      const after = await tx.payrollRun.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledById: u.id, cancelledAt: new Date(), cancelReason: dto.reason },
      });
      await tx.advanceRecovery.updateMany({ where: { payrollRunId: id }, data: { status: 'CANCELLED' } });
      await tx.expense.updateMany({ where: { source: 'PAYROLL', sourceId: id }, data: { status: 'CANCELLED' } });
      return { before: r, after };
    });
    await this.audit.log(u.id, 'CANCEL', 'PayrollRun', id, run.before, run.after);
    return run.after;
  }

  @Get('payroll/:id') @RequirePermissions('PAYROLL_MANAGE')
  async slip(@Param('id') id: string) {
    const r = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        employee: { select: { name: true, type: true, phone: true } },
        recoveries: { include: { advance: { select: { id: true, date: true, amount: true, note: true } } } },
      },
    });
    if (!r) throw new NotFoundException();
    return r;
  }
}

@Module({ controllers: [HrController], providers: [PayrollService], exports: [PayrollService] })
export class HrModule {}
