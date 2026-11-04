import { Controller, Get, Module, Query } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { CurrentUser, type AuthUser } from '../common/decorators.js';

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

@Controller('search')
class SearchController {
  constructor(private prisma: PrismaService) {}

  /** One box for the top bar: customers, products, suppliers and bills matching the text. */
  @Get()
  async search(@Query('q') raw = '', @CurrentUser() user: AuthUser) {
    const q = raw.trim();
    if (q.length < 2) return [];
    const canSell = user.permissions.includes('SALE_CREATE');
    const canKhata = user.permissions.includes('PAYMENT_RECORD');
    const [customers, products, suppliers, sales] = await Promise.all([
      this.prisma.customer.findMany({
        where: { OR: [{ name: contains(q) }, { shopName: contains(q) }, { phone: contains(q) }, { area: contains(q) }] },
        select: { id: true, name: true, shopName: true, area: true, phone: true }, take: 5, orderBy: { name: 'asc' },
      }),
      this.prisma.product.findMany({
        where: { OR: [{ name: contains(q) }, { brand: contains(q) }] },
        select: { id: true, name: true, size: true, brand: true }, take: 5, orderBy: { name: 'asc' },
      }),
      this.prisma.supplier.findMany({
        where: { OR: [{ name: contains(q) }, { phone: contains(q) }] },
        select: { id: true, name: true, phone: true }, take: 4, orderBy: { name: 'asc' },
      }),
      canSell
        ? this.prisma.sale.findMany({
            where: { billNo: contains(q) },
            select: { id: true, billNo: true, date: true, net: true, customer: { select: { name: true } } }, take: 5, orderBy: { createdAt: 'desc' },
          })
        : [],
    ]);
    return [
      ...sales.map((s) => ({ group: 'Bills', title: s.billNo, sub: `${s.customer?.name ?? 'Cash sale'} · Rs ${Number(s.net).toLocaleString()}`, href: `/sales/${s.id}` })),
      ...customers.map((c) => ({
        group: 'Customers', title: c.name, sub: [c.shopName, c.area, c.phone].filter(Boolean).join(' · '),
        href: canKhata ? `/khata/${c.id}` : `/customers/${c.id}`,
      })),
      ...products.map((p) => ({ group: 'Products', title: p.name, sub: [p.brand, p.size].filter(Boolean).join(' · '), href: '/products' })),
      ...suppliers.map((s) => ({ group: 'Suppliers', title: s.name, sub: s.phone ?? '', href: `/suppliers/${s.id}` })),
    ];
  }
}

@Module({ controllers: [SearchController] })
export class SearchModule {}
