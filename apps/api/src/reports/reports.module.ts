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

interface LineTotals { qtySold: Dec; sales: Dec; returnsCredit: Dec; netSales: Dec; cost: Dec; grossProfit: Dec }
const emptyLine = (): LineTotals => ({ qtySold: ZERO(), sales: ZERO(), returnsCredit: ZERO(), netSales: ZERO(), cost: ZERO(), grossProfit: ZERO() });

@Controller('reports')
class ReportsController {
  constructor(private prisma: PrismaService) {}

  /**
   * End-of-day / monthly profit. Bottles and rice each show their own gross profit (net sales - cost);
   * expenses are not split between them and come off the combined gross profit only. Expenses are
   * also totalled by godown/shop. Cost is the latest purchase cost frozen on each sold line.
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
      this.prisma.expense.findMany({ where: { status: 'ACTIVE', date: { gte: from, lte: to } }, select: { date: true, amount: true, category: true, location: { select: { id: true, name: true, type: true } } } }),
      this.prisma.payment.findMany({ where: { status: 'ACTIVE', date: { gte: from, lte: to } }, select: { date: true, amount: true, saleId: true } }),
    ]);

    type Period = { lines: Record<BusinessLineCode, LineTotals>; expenses: Dec; cash: { paidWithBills: Dec; otherReceipts: Dec; udhaarGiven: Dec }; uncostedLines: number };
    const periods = new Map<string, Period>();
    const get = (d: Date): Period => {
      const k = keyFor(d, groupBy);
      let p = periods.get(k);
      if (!p) {
        p = { lines: { BOTTLES: emptyLine(), RICE: emptyLine() }, expenses: ZERO(), cash: { paidWithBills: ZERO(), otherReceipts: ZERO(), udhaarGiven: ZERO() }, uncostedLines: 0 };
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
    // Expenses for the whole range by place (godown / shop / general) and by category.
    const byPlace = new Map<string, { locationId: string | null; name: string; type: string | null; amount: Dec }>();
    const byCategory = new Map<string, Dec>();
    for (const e of expenses) {
      const p = get(e.date);
      p.expenses = p.expenses.plus(e.amount);
      const k = e.location?.id ?? 'general';
      const place = byPlace.get(k) ?? { locationId: e.location?.id ?? null, name: e.location?.name ?? 'General', type: e.location?.type ?? null, amount: ZERO() };
      place.amount = place.amount.plus(e.amount);
      byPlace.set(k, place);
      byCategory.set(e.category, (byCategory.get(e.category) ?? ZERO()).plus(e.amount));
    }

    const rows = [...periods.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, p]) => {
      const sum = emptyLine();
      for (const code of ['BOTTLES', 'RICE'] as const) {
        const l = p.lines[code];
        l.netSales = l.sales.minus(l.returnsCredit);
        l.grossProfit = l.netSales.minus(l.cost);
        for (const k of Object.keys(sum) as (keyof LineTotals)[]) sum[k] = sum[k].plus(l[k]);
      }
      return { period, ...p, total: { ...sum, expenses: p.expenses, netProfit: sum.grossProfit.minus(p.expenses) } };
    });
    return {
      from: iso(from), to: iso(to), groupBy, rows,
      expensesByPlace: [...byPlace.values()].sort((a, b) => b.amount.comparedTo(a.amount)),
      expensesByCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount.comparedTo(a.amount)),
    };
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

  /**
   * Who sold what and who took the money, per person. A person is the salesman on the bill when there is one,
   * otherwise whoever entered the bill; an app user linked to an employee counts as that employee, so a salesman
   * who also signs in is one row. Khata receipts (payments not tied to a bill) go to whoever recorded them.
   */
  private async teamBase(q: RangeQuery) {
    const { from, to } = range(q);
    const [users, employees, sales, receipts] = await Promise.all([
      this.prisma.appUser.findMany({ select: { id: true, username: true, displayName: true, avatar: true, employeeId: true, role: { select: { name: true } } } }),
      this.prisma.employee.findMany({ select: { id: true, name: true, commissionPercent: true } }),
      this.prisma.sale.findMany({
        where: { date: { gte: from, lte: to } },
        select: { id: true, billNo: true, status: true, saleType: true, salesmanId: true, createdById: true, net: true, paidNow: true, customerId: true, createdAt: true, customer: { select: { name: true } } },
      }),
      this.prisma.payment.findMany({
        where: { status: 'ACTIVE', saleId: null, date: { gte: from, lte: to } },
        select: { id: true, receiptNo: true, createdById: true, amount: true, method: true, createdAt: true, customer: { select: { name: true } } },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const keyOfUser = (id: string) => { const u = userById.get(id); return u?.employeeId ? `emp:${u.employeeId}` : `usr:${id}`; };
    const keyOfSale = (s: { salesmanId: string | null; createdById: string }) => (s.salesmanId ? `emp:${s.salesmanId}` : keyOfUser(s.createdById));
    return { from, to, users, employees, sales, receipts, userById, keyOfUser, keyOfSale };
  }

  @Get('team') @RequirePermissions('REPORT_VIEW')
  async team(@Query() q: RangeQuery) {
    const { from, to, users, employees, sales, receipts, userById, keyOfUser, keyOfSale } = await this.teamBase(q);
    type Row = { key: string; name: string; username: string | null; avatar: string | null; roleName: string | null; employeeId: string | null; commissionPercent: Dec | null; bills: number; cancelled: number; sales: Dec; cashWithBills: Dec; udhaar: Dec; receipts: Dec; receiptCount: number; byMethod: Record<string, Dec>; lastAt: Date | null };
    const rows = new Map<string, Row>();
    const row = (key: string): Row => {
      let r = rows.get(key);
      if (r) return r;
      const [kind, id] = key.split(':');
      const emp = kind === 'emp' ? employees.find((e) => e.id === id) : undefined;
      const user = kind === 'usr' ? userById.get(id) : users.find((u) => u.employeeId === id);
      r = {
        key, name: emp?.name ?? user?.displayName ?? user?.username ?? 'Unknown', username: user?.username ?? null, avatar: user?.avatar ?? null, roleName: user?.role.name ?? (emp ? 'Employee' : null),
        employeeId: emp?.id ?? null, commissionPercent: emp?.commissionPercent ?? null,
        bills: 0, cancelled: 0, sales: ZERO(), cashWithBills: ZERO(), udhaar: ZERO(), receipts: ZERO(), receiptCount: 0, byMethod: {}, lastAt: null,
      };
      rows.set(key, r);
      return r;
    };
    const touch = (r: Row, at: Date) => { if (!r.lastAt || at > r.lastAt) r.lastAt = at; };
    for (const s of sales) {
      const r = row(keyOfSale(s));
      if (s.status !== 'ACTIVE') { r.cancelled += 1; continue; }
      r.bills += 1;
      r.sales = r.sales.plus(s.net);
      r.cashWithBills = r.cashWithBills.plus(s.paidNow);
      if (s.customerId && s.net.gt(s.paidNow)) r.udhaar = r.udhaar.plus(s.net.minus(s.paidNow));
      touch(r, s.createdAt);
    }
    for (const p of receipts) {
      const r = row(keyOfUser(p.createdById));
      r.receipts = r.receipts.plus(p.amount);
      r.receiptCount += 1;
      r.byMethod[p.method] = (r.byMethod[p.method] ?? ZERO()).plus(p.amount);
      touch(r, p.createdAt);
    }
    const people = [...rows.values()].map((r) => ({
      ...r,
      collected: r.cashWithBills.plus(r.receipts),
      commission: r.commissionPercent && r.sales.gt(0) ? r.sales.mul(r.commissionPercent).div(100).toDecimalPlaces(2) : ZERO(),
    })).sort((a, b) => b.sales.comparedTo(a.sales) || b.collected.comparedTo(a.collected));
    const sum = (f: (p: (typeof people)[number]) => Dec) => people.reduce((t, p) => t.plus(f(p)), ZERO());
    return {
      from: iso(from), to: iso(to),
      totals: { bills: people.reduce((t, p) => t + p.bills, 0), sales: sum((p) => p.sales), collected: sum((p) => p.collected), cashWithBills: sum((p) => p.cashWithBills), receipts: sum((p) => p.receipts), udhaar: sum((p) => p.udhaar) },
      people,
    };
  }

  /** One person's bills and khata receipts in the range, newest first. */
  @Get('team/activity') @RequirePermissions('REPORT_VIEW')
  async teamActivity(@Query() q: RangeQuery & { key?: string }) {
    if (!q.key || !/^(emp|usr):[0-9a-f-]{36}$/.test(q.key)) throw new BadRequestException('key is required');
    const { sales, receipts, keyOfUser, keyOfSale } = await this.teamBase(q);
    const bills = sales.filter((s) => keyOfSale(s) === q.key).map((s) => ({ id: s.id, billNo: s.billNo, at: s.createdAt, saleType: s.saleType, status: s.status, customer: s.customer?.name ?? null, net: s.net, paidNow: s.paidNow }));
    const got = receipts.filter((p) => keyOfUser(p.createdById) === q.key).map((p) => ({ id: p.id, receiptNo: p.receiptNo, at: p.createdAt, customer: p.customer.name, amount: p.amount, method: p.method }));
    const byTime = <T extends { at: Date }>(a: T, b: T) => b.at.getTime() - a.at.getTime();
    return { bills: bills.sort(byTime).slice(0, 300), receipts: got.sort(byTime).slice(0, 300) };
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

  /** Empties we hold that belong to suppliers (positive) or that suppliers hold of ours (negative). */
  @Get('supplier-empties') @RequirePermissions('REPORT_VIEW')
  async supplierEmpties() {
    const g = await this.prisma.supplierEmptiesLedger.groupBy({ by: ['supplierId', 'productId'], where: { status: 'ACTIVE' }, _sum: { qtyIn: true, qtyOut: true } });
    const rows = g.map((r) => ({ supplierId: r.supplierId, productId: r.productId, owed: (r._sum.qtyIn ?? 0) - (r._sum.qtyOut ?? 0) })).filter((r) => r.owed !== 0);
    const [suppliers, products] = await Promise.all([
      this.prisma.supplier.findMany({ where: { id: { in: rows.map((r) => r.supplierId) } }, select: { id: true, name: true } }),
      this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, name: true } }),
    ]);
    return rows
      .map((r) => ({ ...r, supplier: suppliers.find((s) => s.id === r.supplierId)?.name, product: products.find((p) => p.id === r.productId)?.name }))
      .sort((a, b) => b.owed - a.owed);
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
