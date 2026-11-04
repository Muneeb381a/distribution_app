import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { AttendanceStatus, BusinessLineCode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';

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
  @IsOptional() @IsEnum(BusinessLineCode) businessLine?: BusinessLineCode;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount: number;
  @IsOptional() @IsString() note?: string;
}

class AdvanceDto {
  @IsUUID() employeeId: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount: number;
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsString() note?: string;
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
}

class CancelRunDto {
  @IsString() @MinLength(3) @MaxLength(200) reason: string;
}

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  /** Works out one employee's month without saving anything. */
  async calc(db: Db | PrismaService, employeeId: string, month: string) {
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

    const advances = await db.salaryAdvance.findMany({
      where: { employeeId, status: 'ACTIVE', payrollRunId: null, date: { lte: end } },
      orderBy: { date: 'asc' },
    });
    const advanceTotal = advances.reduce((s, a) => s.plus(a.amount), new D(0));
    const prev = await db.payrollRun.findFirst({ where: { employeeId, status: 'ACTIVE', month: { lt: month } }, orderBy: { month: 'desc' } });
    const carryIn = prev?.carryOut ?? new D(0);

    const gross = base.plus(commission).minus(absenceDeduction);
    const net = gross.minus(advanceTotal).minus(carryIn);
    return {
      employee: { id: emp.id, name: emp.name, type: emp.type },
      month,
      base,
      commission,
      absenceDeduction,
      gross,
      advances: advanceTotal,
      advanceIds: advances.map((a) => a.id),
      carryIn,
      netPaid: D.max(net, 0),
      carryOut: D.max(net.neg(), 0),
      details: {
        attendance: { present, halfDay: half, absent: days('ABSENT'), paidLeave, unpaidLeave: days('UNPAID_LEAVE') },
        absentDaysDeducted: absentDays,
        salesNet: salesNet.toString(),
        commissionPercent: emp.commissionPercent?.toString() ?? null,
        advances: advances.map((a) => ({ date: a.date, amount: a.amount.toString(), note: a.note })),
      },
    };
  }
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
  expenses(@Query() q: { from?: string; to?: string; category?: string; line?: BusinessLineCode }) {
    return this.prisma.expense.findMany({
      where: {
        category: q.category, businessLine: q.line,
        date: q.from || q.to ? { gte: q.from ? dayOf(q.from) : undefined, lte: q.to ? dayOf(q.to) : undefined } : undefined,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  @Post('expenses') @RequirePermissions('EXPENSE_MANAGE')
  async addExpense(@Body() dto: ExpenseDto, @CurrentUser() u: AuthUser) {
    const category = dto.category.trim();
    if (!category) throw new BadRequestException('Category is required');
    const row = await this.prisma.expense.create({
      data: { date: dayOf(dto.date), category, businessLine: dto.businessLine, amount: dto.amount, note: dto.note, createdById: u.id },
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

  @Get('advances') @RequirePermissions('PAYROLL_MANAGE')
  advances(@Query('employeeId') employeeId?: string) {
    return this.prisma.salaryAdvance.findMany({
      where: { employeeId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      include: { employee: { select: { name: true } } },
    });
  }

  @Post('advances') @RequirePermissions('PAYROLL_MANAGE')
  async addAdvance(@Body() dto: AdvanceDto, @CurrentUser() u: AuthUser) {
    const emp = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!emp?.isActive) throw new BadRequestException('Unknown or inactive employee');
    const row = await this.prisma.salaryAdvance.create({
      data: { employeeId: dto.employeeId, amount: dto.amount, date: dayOf(dto.date), note: dto.note, createdById: u.id },
    });
    await this.audit.log(u.id, 'CREATE', 'SalaryAdvance', row.id, undefined, row);
    return row;
  }

  @Post('advances/:id/cancel') @RequirePermissions('PAYROLL_MANAGE')
  async cancelAdvance(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const a = await this.prisma.salaryAdvance.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    if (a.payrollRunId) throw new BadRequestException('Already deducted in a payroll run');
    if (a.status === 'CANCELLED') throw new ConflictException('Already cancelled');
    const row = await this.prisma.salaryAdvance.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log(u.id, 'CANCEL', 'SalaryAdvance', id, a, row);
    return row;
  }

  // ------------------------------------------------------------ payroll

  /** What the salary would be. Safe to call repeatedly. */
  @Get('payroll/preview') @RequirePermissions('PAYROLL_MANAGE')
  async preview(@Query('employeeId') employeeId: string, @Query('month') month: string) {
    const existing = await this.prisma.payrollRun.findFirst({ where: { employeeId, month, status: 'ACTIVE' } });
    return { alreadyRun: existing, ...(await this.payroll.calc(this.prisma, employeeId, month)) };
  }

  /** Finalises the month: deducts the advances, posts the salary expense, records what was paid. */
  @Post('payroll/run') @RequirePermissions('PAYROLL_MANAGE')
  async run(@Body() dto: PayrollDto, @CurrentUser() u: AuthUser) {
    const { end } = monthRange(dto.month);
    const run = await this.prisma.$transaction(async (tx) => {
      if (await tx.payrollRun.findFirst({ where: { employeeId: dto.employeeId, month: dto.month, status: 'ACTIVE' } })) {
        throw new ConflictException('Payroll for this employee and month is already finalised');
      }
      const c = await this.payroll.calc(tx, dto.employeeId, dto.month);
      const created = await tx.payrollRun.create({
        data: {
          employeeId: dto.employeeId, month: dto.month, base: c.base, commission: c.commission,
          absenceDeduction: c.absenceDeduction, gross: c.gross, advances: c.advances, carryIn: c.carryIn,
          netPaid: c.netPaid, carryOut: c.carryOut, details: c.details, paidOn: dayOf(), createdById: u.id,
        },
      });
      await tx.salaryAdvance.updateMany({ where: { id: { in: c.advanceIds } }, data: { payrollRunId: created.id } });
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
      await tx.salaryAdvance.updateMany({ where: { payrollRunId: id }, data: { payrollRunId: null } });
      await tx.expense.updateMany({ where: { source: 'PAYROLL', sourceId: id }, data: { status: 'CANCELLED' } });
      return { before: r, after };
    });
    await this.audit.log(u.id, 'CANCEL', 'PayrollRun', id, run.before, run.after);
    return run.after;
  }

  @Get('payroll/:id') @RequirePermissions('PAYROLL_MANAGE')
  async slip(@Param('id') id: string) {
    const r = await this.prisma.payrollRun.findUnique({ where: { id }, include: { employee: { select: { name: true, type: true } }, advanceItems: true } });
    if (!r) throw new NotFoundException();
    return r;
  }
}

@Module({ controllers: [HrController], providers: [PayrollService], exports: [PayrollService] })
export class HrModule {}
