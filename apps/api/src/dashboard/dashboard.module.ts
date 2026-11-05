import { Controller, Get, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lowStock } from '../stock/low-stock.js';
import { PrismaService } from '../prisma.service.js';
import { RequirePermissions } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';
import { overLimit, withCustomerBalances, withSupplierBalances } from '../common/balances.js';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = () => new D(0);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

@Controller('dashboard')
class DashboardController {
  constructor(private prisma: PrismaService) {}

  /** Owner's home screen: today, the last 7 days, this month, what customers owe, what we owe suppliers. */
  @Get('summary') @RequirePermissions('REPORT_VIEW')
  async summary() {
    const today = dayOf();
    const weekStart = addDays(today, -6);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const from = weekStart < monthStart ? weekStart : monthStart;

    const [items, sales, expenses, receipts, customerRows, supplierRows, recent, damaged] = await Promise.all([
      this.prisma.saleItem.findMany({
        where: { sale: { status: 'ACTIVE', date: { gte: from, lte: today } } },
        select: { qtyBase: true, unitCostBase: true, sale: { select: { date: true, businessLine: true } } },
      }),
      this.prisma.sale.findMany({
        where: { status: 'ACTIVE', date: { gte: from, lte: today } },
        select: { date: true, businessLine: true, net: true, paidNow: true, customerId: true },
      }),
      this.prisma.expense.findMany({ where: { status: 'ACTIVE', date: { gte: from, lte: today } }, select: { date: true, amount: true } }),
      this.prisma.payment.findMany({ where: { status: 'ACTIVE', date: { gte: from, lte: today }, saleId: null }, select: { date: true, amount: true } }),
      this.prisma.customer.findMany({ select: { id: true, name: true, shopName: true, area: true, openingBalance: true, creditLimit: true } }),
      this.prisma.supplier.findMany({ select: { id: true, openingBalance: true } }),
      this.prisma.sale.findMany({
        where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 8,
        select: { id: true, billNo: true, date: true, net: true, paidNow: true, businessLine: true, customer: { select: { name: true } } },
      }),
      this.prisma.stockMovement.groupBy({ by: ['productId'], where: { status: 'DAMAGED' }, _sum: { qtyBase: true } }),
    ]);

    const days = Array.from({ length: 7 }, (_, i) => iso(addDays(weekStart, i)));
    const trend = new Map(days.map((d) => [d, { date: d, sales: ZERO(), bills: 0 }]));
    const todayKey = iso(today);
    const t = { bills: 0, netSales: ZERO(), cashWithBills: ZERO(), receipts: ZERO(), udhaar: ZERO(), expenses: ZERO(), cost: ZERO(), bottles: ZERO(), rice: ZERO(), bottlesCost: ZERO(), riceCost: ZERO() };
    const m = { bills: 0, netSales: ZERO(), expenses: ZERO(), cost: ZERO(), bottles: ZERO(), rice: ZERO(), bottlesCost: ZERO(), riceCost: ZERO() };

    for (const s of sales) {
      const k = iso(s.date);
      const inMonth = s.date >= monthStart;
      const tr = trend.get(k);
      if (tr) { tr.sales = tr.sales.plus(s.net); tr.bills += 1; }
      if (inMonth) {
        m.bills += 1;
        m.netSales = m.netSales.plus(s.net);
        if (s.businessLine === 'BOTTLES') m.bottles = m.bottles.plus(s.net);
        else m.rice = m.rice.plus(s.net);
      }
      if (k === todayKey) {
        t.bills += 1;
        t.netSales = t.netSales.plus(s.net);
        if (s.businessLine === 'BOTTLES') t.bottles = t.bottles.plus(s.net);
        else t.rice = t.rice.plus(s.net);
        t.cashWithBills = t.cashWithBills.plus(s.paidNow);
        if (s.customerId && s.net.gt(s.paidNow)) t.udhaar = t.udhaar.plus(s.net.minus(s.paidNow));
      }
    }
    for (const it of items) {
      const c = it.unitCostBase ? it.qtyBase.mul(it.unitCostBase) : ZERO();
      if (it.sale.date >= monthStart) {
        m.cost = m.cost.plus(c);
        if (it.sale.businessLine === 'BOTTLES') m.bottlesCost = m.bottlesCost.plus(c);
        else m.riceCost = m.riceCost.plus(c);
      }
      if (iso(it.sale.date) === todayKey) {
        t.cost = t.cost.plus(c);
        if (it.sale.businessLine === 'BOTTLES') t.bottlesCost = t.bottlesCost.plus(c);
        else t.riceCost = t.riceCost.plus(c);
      }
    }
    for (const e of expenses) {
      if (e.date >= monthStart) m.expenses = m.expenses.plus(e.amount);
      if (iso(e.date) === todayKey) t.expenses = t.expenses.plus(e.amount);
    }
    for (const r of receipts) if (iso(r.date) === todayKey) t.receipts = t.receipts.plus(r.amount);

    const [customers, suppliers, low, chequesDue] = await Promise.all([
      withCustomerBalances(this.prisma, customerRows), withSupplierBalances(this.prisma, supplierRows), lowStock(this.prisma),
      // Customer cheques that can be deposited now (dated today or earlier) and are still pending.
      this.prisma.payment.aggregate({ where: { method: 'CHEQUE', chequeStatus: 'PENDING', status: 'ACTIVE', chequeDate: { lte: today } }, _count: true, _sum: { amount: true } }),
    ]);
    const owing = customers.filter((c) => c.balance.gt(0));
    const receivable = owing.reduce((s: Dec, c) => s.plus(c.balance), ZERO());
    const topDebtors = [...owing].sort((a, b) => b.balance.comparedTo(a.balance)).slice(0, 6).map((c) => ({
      id: c.id, name: c.name, shopName: c.shopName, area: c.area, balance: c.balance, overLimit: overLimit(c.balance, c.creditLimit),
    }));

    const payable = suppliers.reduce((s: Dec, x) => s.plus(x.balance), ZERO());

    return {
      today: {
        ...t, grossProfit: t.netSales.minus(t.cost), netProfit: t.netSales.minus(t.cost).minus(t.expenses),
        bottlesProfit: t.bottles.minus(t.bottlesCost), riceProfit: t.rice.minus(t.riceCost),
      },
      month: {
        ...m, grossProfit: m.netSales.minus(m.cost), netProfit: m.netSales.minus(m.cost).minus(m.expenses),
        // Each line's own gross profit; expenses are not split and only come off the combined profit.
        bottlesProfit: m.bottles.minus(m.bottlesCost), riceProfit: m.rice.minus(m.riceCost),
      },
      trend: [...trend.values()],
      khata: { receivable, customersOwing: owing.length, overLimit: topDebtors.filter((d) => d.overLimit).length, topDebtors },
      payable: payable.gt(0) ? payable : ZERO(),
      damagedProducts: damaged.filter((d) => (d._sum.qtyBase ?? ZERO()).gt(0)).length,
      lowStock: low.slice(0, 8),
      lowStockCount: low.length,
      chequesDue: { count: chequesDue._count, amount: chequesDue._sum.amount ?? ZERO() },
      recentSales: recent.map((s) => ({ id: s.id, billNo: s.billNo, date: s.date, net: s.net, paidNow: s.paidNow, businessLine: s.businessLine, customer: s.customer?.name ?? null })),
    };
  }
}

@Module({ controllers: [DashboardController] })
export class DashboardModule {}
