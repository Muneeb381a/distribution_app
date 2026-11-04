import { BadRequestException, Controller, Get, Module, Query } from '@nestjs/common';
import { BusinessLineCode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { RequirePermissions } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = () => new D(0);
const iso = (d: Date) => d.toISOString().slice(0, 10);

interface RangeQuery {
  from?: string;
  to?: string;
  groupBy?: 'day' | 'month' | 'none';
}

function range(q: RangeQuery) {
  const from = dayOf(q.from);
  const to = q.to ? dayOf(q.to) : from;
  if (to < from) throw new BadRequestException('"to" is before "from"');
  if (to.getTime() - from.getTime() > 400 * 86_400_000) throw new BadRequestException('Range is limited to about 13 months');
  return { from, to };
}

const keyFor = (d: Date, groupBy: RangeQuery['groupBy']) => (groupBy === 'none' ? 'total' : groupBy === 'month' ? iso(d).slice(0, 7) : iso(d));

interface LineTotals { qtySold: Dec; sales: Dec; returnsCredit: Dec; netSales: Dec; cost: Dec; grossProfit: Dec; expenses: Dec; netProfit: Dec }
const emptyLine = (): LineTotals => ({ qtySold: ZERO(), sales: ZERO(), returnsCredit: ZERO(), netSales: ZERO(), cost: ZERO(), grossProfit: ZERO(), expenses: ZERO(), netProfit: ZERO() });

@Controller('reports')
class ReportsController {
  constructor(private prisma: PrismaService) {}

  /**
   * End-of-day / monthly profit per business line.
   * Revenue is net of returns credits. Cost is the latest purchase cost frozen on each sold line.
   * Rent and other shared costs are reported separately and only affect the overall net profit.
   */
  @Get('profit') @RequirePermissions('REPORT_VIEW')
  async profit(@Query() q: RangeQuery) {
    const { from, to } = range(q);
    const groupBy = q.groupBy ?? 'day';
    const [items, sales, expenses, receipts] = await Promise.all([
      this.prisma.saleItem.findMany({
        where: { sale: { status: 'ACTIVE', date: { gte: from, lte: to } } },
        select: { qtyBase: true, lineTotal: true, unitCostBase: true, sale: { select: { date: true, businessLine: true } } },
      }),
      this.prisma.sale.findMany({
        where: { status: 'ACTIVE', date: { gte: from, lte: to } },
        select: { date: true, businessLine: true, returnsCredit: true, net: true, paidNow: true, customerId: true },
      }),
      this.prisma.expense.findMany({ where: { status: 'ACTIVE', date: { gte: from, lte: to } }, select: { date: true, businessLine: true, amount: true } }),
      this.prisma.payment.findMany({ where: { status: 'ACTIVE', date: { gte: from, lte: to } }, select: { date: true, amount: true, saleId: true } }),
    ]);

    type Period = { lines: Record<BusinessLineCode, LineTotals>; sharedExpenses: Dec; cash: { paidWithBills: Dec; otherReceipts: Dec; udhaarGiven: Dec }; uncostedLines: number };
    const periods = new Map<string, Period>();
    const get = (d: Date): Period => {
      const k = keyFor(d, groupBy);
      let p = periods.get(k);
      if (!p) {
        p = { lines: { BOTTLES: emptyLine(), RICE: emptyLine() }, sharedExpenses: ZERO(), cash: { paidWithBills: ZERO(), otherReceipts: ZERO(), udhaarGiven: ZERO() }, uncostedLines: 0 };
        periods.set(k, p);
      }
      return p;
    };

    for (const it of items) {
      const p = get(it.sale.date);
      const l = p.lines[it.sale.businessLine];
      l.qtySold = l.qtySold.plus(it.qtyBase);
      l.sales = l.sales.plus(it.lineTotal);
      if (it.unitCostBase) l.cost = l.cost.plus(it.qtyBase.mul(it.unitCostBase));
      else p.uncostedLines += 1;
    }
    for (const s of sales) {
      const p = get(s.date);
      p.lines[s.businessLine].returnsCredit = p.lines[s.businessLine].returnsCredit.plus(s.returnsCredit);
      p.cash.paidWithBills = p.cash.paidWithBills.plus(s.paidNow);
      // Udhaar given = the part of a bill left unpaid (only for customers; walk-in sales are always paid in full).
      const unpaid = s.net.minus(s.paidNow);
      if (s.customerId && unpaid.gt(0)) p.cash.udhaarGiven = p.cash.udhaarGiven.plus(unpaid);
    }
    for (const r of receipts) if (!r.saleId) get(r.date).cash.otherReceipts = get(r.date).cash.otherReceipts.plus(r.amount);
    for (const e of expenses) {
      const p = get(e.date);
      if (e.businessLine) p.lines[e.businessLine].expenses = p.lines[e.businessLine].expenses.plus(e.amount);
      else p.sharedExpenses = p.sharedExpenses.plus(e.amount);
    }

    const rows = [...periods.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, p]) => {
      const total = emptyLine();
      for (const code of ['BOTTLES', 'RICE'] as const) {
        const l = p.lines[code];
        l.netSales = l.sales.minus(l.returnsCredit);
        l.grossProfit = l.netSales.minus(l.cost);
        l.netProfit = l.grossProfit.minus(l.expenses);
        for (const k of Object.keys(total) as (keyof LineTotals)[]) total[k] = total[k].plus(l[k]);
      }
      total.expenses = total.expenses.plus(p.sharedExpenses);
      total.netProfit = total.grossProfit.minus(total.expenses);
      return { period, ...p, total };
    });
    return { from: iso(from), to: iso(to), groupBy, rows };
  }

  /** Rice bought vs sold per product over a range. */
  @Get('rice') @RequirePermissions('REPORT_VIEW')
  async rice(@Query() q: RangeQuery) {
    const { from, to } = range(q);
    const [bought, sold, products] = await Promise.all([
      this.prisma.purchaseItem.groupBy({ by: ['productId'], where: { purchase: { status: 'ACTIVE', date: { gte: from, lte: to } }, product: { category: { businessLine: { code: 'RICE' } } } }, _sum: { qtyBase: true, lineTotal: true } }),
      this.prisma.saleItem.groupBy({ by: ['productId'], where: { sale: { status: 'ACTIVE', date: { gte: from, lte: to } }, product: { category: { businessLine: { code: 'RICE' } } } }, _sum: { qtyBase: true, lineTotal: true } }),
      this.prisma.product.findMany({ where: { category: { businessLine: { code: 'RICE' } } }, include: { category: { include: { parent: { include: { parent: true } } } } } }),
    ]);
    const path = (c: (typeof products)[number]['category']) => [c.parent?.parent?.name, c.parent?.name, c.name].filter(Boolean).join(' > ');
    const ids = new Set([...bought.map((b) => b.productId), ...sold.map((s) => s.productId)]);
    return {
      from: iso(from), to: iso(to),
      rows: products.filter((p) => ids.has(p.id)).map((p) => {
        const b = bought.find((x) => x.productId === p.id);
        const s = sold.find((x) => x.productId === p.id);
        return {
          productId: p.id, product: p.name, size: p.size, category: path(p.category),
          boughtKg: b?._sum.qtyBase ?? ZERO(), boughtValue: b?._sum.lineTotal ?? ZERO(),
          soldKg: s?._sum.qtyBase ?? ZERO(), soldValue: s?._sum.lineTotal ?? ZERO(),
        };
      }).sort((a, b) => a.category.localeCompare(b.category) || a.product.localeCompare(b.product)),
    };
  }

  /** Per salesman and per vehicle: bills, sales, what was collected on the bills, udhaar, commission. */
  @Get('salesmen') @RequirePermissions('REPORT_VIEW')
  async salesmen(@Query() q: RangeQuery) {
    const { from, to } = range(q);
    const sales = await this.prisma.sale.findMany({
      where: { status: 'ACTIVE', date: { gte: from, lte: to } },
      select: { id: true, salesmanId: true, locationId: true, saleType: true, net: true, paidNow: true, customerId: true, payments: { where: { status: 'ACTIVE' }, select: { amount: true, method: true } } },
    });
    const [employees, locations, empties] = await Promise.all([
      this.prisma.employee.findMany({ select: { id: true, name: true, commissionPercent: true } }),
      this.prisma.location.findMany({ select: { id: true, name: true } }),
      this.prisma.emptiesLedger.findMany({ where: { saleId: { in: sales.map((s) => s.id) } }, select: { saleId: true, qtyOut: true, qtyIn: true } }),
    ]);

    const roll = (keyOf: (s: (typeof sales)[number]) => string | null) => {
      const m = new Map<string, { bills: number; net: Dec; collected: Dec; udhaar: Dec; byMethod: Record<string, Dec>; emptiesOut: number; emptiesIn: number }>();
      for (const s of sales) {
        const k = keyOf(s);
        if (!k) continue;
        const r = m.get(k) ?? { bills: 0, net: ZERO(), collected: ZERO(), udhaar: ZERO(), byMethod: {}, emptiesOut: 0, emptiesIn: 0 };
        r.bills += 1;
        r.net = r.net.plus(s.net);
        r.collected = r.collected.plus(s.paidNow);
        if (s.customerId && s.net.gt(s.paidNow)) r.udhaar = r.udhaar.plus(s.net.minus(s.paidNow));
        for (const p of s.payments) r.byMethod[p.method] = (r.byMethod[p.method] ?? ZERO()).plus(p.amount);
        for (const e of empties.filter((x) => x.saleId === s.id)) {
          r.emptiesOut += e.qtyOut;
          r.emptiesIn += e.qtyIn;
        }
        m.set(k, r);
      }
      return m;
    };

    return {
      from: iso(from), to: iso(to),
      salesmen: [...roll((s) => s.salesmanId)].map(([id, r]) => {
        const e = employees.find((x) => x.id === id);
        const commission = e?.commissionPercent && r.net.gt(0) ? r.net.mul(e.commissionPercent).div(100).toDecimalPlaces(2) : ZERO();
        return { employeeId: id, name: e?.name, commissionPercent: e?.commissionPercent ?? null, commission, ...r };
      }),
      vehicles: [...roll((s) => (s.saleType === 'DELIVERY' ? s.locationId : null))].map(([id, r]) => ({ locationId: id, name: locations.find((l) => l.id === id)?.name, ...r })),
    };
  }

  /** Customers currently holding empties. */
  @Get('empties') @RequirePermissions('REPORT_VIEW')
  async empties() {
    const g = await this.prisma.emptiesLedger.groupBy({ by: ['customerId', 'productId'], _sum: { qtyOut: true, qtyIn: true } });
    const rows = g.map((r) => ({ customerId: r.customerId, productId: r.productId, held: (r._sum.qtyOut ?? 0) - (r._sum.qtyIn ?? 0) })).filter((r) => r.held !== 0);
    const [customers, products] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true, shopName: true, area: true } }),
      this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, name: true } }),
    ]);
    return rows
      .map((r) => ({ ...r, customer: customers.find((c) => c.id === r.customerId), product: products.find((p) => p.id === r.productId)?.name }))
      .sort((a, b) => b.held - a.held);
  }

  /** Customer returns in the range, plus damaged stock currently on hand. */
  @Get('returns') @RequirePermissions('REPORT_VIEW')
  async returns(@Query() q: RangeQuery) {
    const { from, to } = range(q);
    const [items, damaged] = await Promise.all([
      this.prisma.saleReturnItem.findMany({
        where: { sale: { status: 'ACTIVE', date: { gte: from, lte: to } } },
        include: { product: { select: { name: true, size: true } }, sale: { select: { billNo: true, date: true, customer: { select: { name: true } } } } },
        orderBy: { sale: { date: 'desc' } },
      }),
      this.prisma.stockMovement.groupBy({ by: ['productId', 'locationId'], where: { status: 'DAMAGED' }, _sum: { qtyBase: true } }),
    ]);
    const onHand = damaged.filter((d) => (d._sum.qtyBase ?? ZERO()).gt(0));
    const [products, locations] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: onHand.map((d) => d.productId) } }, select: { id: true, name: true } }),
      this.prisma.location.findMany({ select: { id: true, name: true } }),
    ]);
    const byReason = (r: 'DAMAGED' | 'EXPIRED') => items.filter((i) => i.reason === r).reduce((s, i) => s.plus(i.creditAmount), ZERO());
    return {
      from: iso(from), to: iso(to),
      credit: { DAMAGED: byReason('DAMAGED'), EXPIRED: byReason('EXPIRED') },
      items: items.map((i) => ({
        bill: i.sale.billNo, date: i.sale.date, customer: i.sale.customer?.name, product: i.product.name, size: i.product.size,
        qty: i.qty, unitName: i.unitName, reason: i.reason, credit: i.creditAmount,
      })),
      damagedOnHand: onHand.map((d) => ({
        product: products.find((p) => p.id === d.productId)?.name, location: locations.find((l) => l.id === d.locationId)?.name, qtyBase: d._sum.qtyBase,
      })),
    };
  }

  /** Who recorded how much and when. */
  @Get('collections') @RequirePermissions('REPORT_VIEW')
  async collections(@Query() q: RangeQuery) {
    const { from, to } = range(q);
    const payments = await this.prisma.payment.findMany({
      where: { status: 'ACTIVE', date: { gte: from, lte: to } },
      select: { date: true, amount: true, method: true, createdById: true },
    });
    const users = await this.prisma.appUser.findMany({ where: { id: { in: [...new Set(payments.map((p) => p.createdById))] } }, select: { id: true, username: true } });
    const m = new Map<string, { date: string; user: string; count: number; total: Dec; byMethod: Record<string, Dec> }>();
    for (const p of payments) {
      const user = users.find((u) => u.id === p.createdById)?.username ?? 'unknown';
      const k = `${iso(p.date)}|${user}`;
      const r = m.get(k) ?? { date: iso(p.date), user, count: 0, total: ZERO(), byMethod: {} };
      r.count += 1;
      r.total = r.total.plus(p.amount);
      r.byMethod[p.method] = (r.byMethod[p.method] ?? ZERO()).plus(p.amount);
      m.set(k, r);
    }
    return { from: iso(from), to: iso(to), rows: [...m.values()].sort((a, b) => b.date.localeCompare(a.date) || a.user.localeCompare(b.user)) };
  }
}

@Module({ controllers: [ReportsController] })
export class ReportsModule {}
