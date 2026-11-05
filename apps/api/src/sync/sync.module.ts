import { Body, Controller, ForbiddenException, Get, HttpException, Module, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsISO8601, IsOptional, IsUUID, Matches, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { SalesModule } from '../sales/sales.module.js';
import { withCustomerBalances } from '../common/balances.js';
import { PaymentDto, SaleDto, SalesService } from '../sales/sales.service.js';

import { OFFLINE_BILL_NO as BILL_NO, OFFLINE_DOC_NO, OFFLINE_RECEIPT_NO as RECEIPT_NO } from '@dist/shared';

class SyncOpDto {
  @IsEnum(['SALE', 'PAYMENT']) kind: 'SALE' | 'PAYMENT';
  /** Also the bill's / payment's clientId: replays are recognised and not created twice. */
  @IsUUID() clientId: string;
  @Matches(OFFLINE_DOC_NO) number: string;
  /** When the device saved it, for the record. */
  @IsOptional() @IsISO8601() savedAt?: string;
  @IsOptional() @ValidateNested() @Type(() => SaleDto) sale?: SaleDto;
  @IsOptional() @ValidateNested() @Type(() => PaymentDto) payment?: PaymentDto;
}

class PushDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SyncOpDto) ops: SyncOpDto[];
}

type Result =
  | { clientId: string; status: 'created' | 'duplicate'; id: string; number: string; flags: string[] }
  | { clientId: string; status: 'failed' | 'retry'; error: string };

/**
 * Offline billing support (plan §3.10 / §9).
 * - POST /sync/device: a device asks once, while online, for its number prefix (D1, D2…), so two offline
 *   PCs can never print the same bill number.
 * - GET /sync/snapshot: everything the new-bill screen needs to work without the server.
 * - POST /sync/push: the device's outbox. Each operation is applied on its own; replays are idempotent.
 */
@Controller('sync')
class SyncController {
  constructor(private prisma: PrismaService, private sales: SalesService, private audit: AuditService) {}

  @Post('device') @RequirePermissions('SALE_CREATE')
  async device(@CurrentUser() u: AuthUser) {
    const c = await this.prisma.counter.upsert({ where: { key: 'DEVICE' }, update: { value: { increment: 1 } }, create: { key: 'DEVICE', value: 1 } });
    const prefix = `D${c.value}`;
    await this.audit.log(u.id, 'CREATE', 'Device', prefix, undefined, { prefix });
    return { prefix };
  }

  @Get('snapshot') @RequirePermissions('SALE_CREATE')
  async snapshot() {
    const [products, prices, locations, salesmen, customerRows, rates, stock, empties] = await Promise.all([
      this.prisma.product.findMany({
        where: { isActive: true },
        include: { units: true, category: { select: { name: true, businessLine: { select: { code: true } } } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.productPrice.findMany(),
      this.prisma.location.findMany({ where: { isActive: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
      this.prisma.employee.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.customer.findMany({
        where: { isActive: true },
        select: { id: true, name: true, shopName: true, area: true, phone: true, type: true, creditLimit: true, openingBalance: true, priceTier: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.customerRate.findMany(),
      this.prisma.stockMovement.groupBy({ by: ['productId', 'locationId'], where: { status: 'OK' }, _sum: { qtyBase: true } }),
      this.prisma.emptiesLedger.groupBy({ by: ['customerId', 'productId'], _sum: { qtyOut: true, qtyIn: true } }),
    ]);
    const customers = await withCustomerBalances(this.prisma, customerRows);
    return {
      at: new Date().toISOString(),
      products,
      prices,
      locations,
      salesmen,
      customers: customers.map(({ openingBalance: _ob, ...c }) => c),
      rates,
      stock: stock.map((s) => ({ productId: s.productId, locationId: s.locationId, qtyBase: s._sum.qtyBase ?? 0 })),
      empties: empties
        .map((e) => ({ customerId: e.customerId, productId: e.productId, held: (e._sum.qtyOut ?? 0) - (e._sum.qtyIn ?? 0) }))
        .filter((e) => e.held !== 0),
    };
  }

  @Post('push') @RequirePermissions('SALE_CREATE')
  async push(@Body() dto: PushDto, @CurrentUser() u: AuthUser): Promise<{ results: Result[] }> {
    const results: Result[] = [];
    // In order: a payment saved after a bill on the device is applied after it here too.
    for (const op of dto.ops) results.push(await this.apply(op, u));
    return { results };
  }

  private async apply(op: SyncOpDto, u: AuthUser): Promise<Result> {
    try {
      if (op.kind === 'SALE') {
        if (!op.sale || !BILL_NO.test(op.number)) return { clientId: op.clientId, status: 'failed', error: 'Not a valid offline bill' };
        const seen = await this.prisma.sale.findUnique({ where: { clientId: op.clientId }, select: { id: true, billNo: true } });
        if (seen) return { clientId: op.clientId, status: 'duplicate', id: seen.id, number: seen.billNo, flags: await this.flags(seen.id) };
        const bill = await this.sales.create({ ...op.sale, clientId: op.clientId }, u, { billNo: op.number });
        return { clientId: op.clientId, status: 'created', id: bill.id, number: bill.billNo, flags: await this.flags(bill.id) };
      }
      if (!u.permissions.includes('PAYMENT_RECORD')) throw new ForbiddenException('You are not allowed to record payments');
      if (!op.payment || !RECEIPT_NO.test(op.number)) return { clientId: op.clientId, status: 'failed', error: 'Not a valid offline receipt' };
      const seen = await this.prisma.payment.findUnique({ where: { clientId: op.clientId }, select: { id: true, receiptNo: true } });
      if (seen) return { clientId: op.clientId, status: 'duplicate', id: seen.id, number: seen.receiptNo, flags: [] };
      const id = await this.sales.recordPayment({ ...op.payment, clientId: op.clientId }, u, { receiptNo: op.number });
      return { clientId: op.clientId, status: 'created', id, number: op.number, flags: [] };
    } catch (e) {
      // Business rules (no stock, unknown customer, number clash…) need a person; anything else is retried.
      if (e instanceof HttpException && e.getStatus() < 500) {
        const body = e.getResponse() as { message?: string | string[] } | string;
        const msg = typeof body === 'string' ? body : Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? e.message);
        return { clientId: op.clientId, status: 'failed', error: msg };
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { clientId: op.clientId, status: 'failed', error: `Number ${op.number} is already used by another document` };
      }
      return { clientId: op.clientId, status: 'retry', error: 'Server error, will retry' };
    }
  }

  /** What a person should look at: a credit limit crossed on a bill made offline. */
  private async flags(saleId: string) {
    const rows = await this.prisma.auditLog.findMany({ where: { entity: 'Sale', entityId: saleId, action: 'OFFLINE_CREDIT_BREACH' }, select: { afterJson: true } });
    return rows.map((r) => String((r.afterJson as { reason?: string } | null)?.reason ?? 'Credit limit crossed'));
  }
}

@Module({ imports: [SalesModule], controllers: [SyncController] })
export class SyncModule {}
