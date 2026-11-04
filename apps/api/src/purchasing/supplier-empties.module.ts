import { BadRequestException, Body, ConflictException, Controller, Get, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';

class SupplierEmptiesDto {
  @IsUUID() supplierId: string;
  @IsUUID() productId: string;
  /** RECEIVED = the supplier gave us empties to keep until we return them; RETURNED = we sent empties back. */
  @IsEnum(['RECEIVED', 'RETURNED']) direction: 'RECEIVED' | 'RETURNED';
  @IsInt() @Min(1) qty: number;
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

@Controller('supplier-empties')
class SupplierEmptiesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Entries for one supplier plus what is still owed back per product. */
  @Get() @RequirePermissions('PURCHASE_MANAGE')
  async forSupplier(@Query('supplierId') supplierId: string) {
    const entries = await this.prisma.supplierEmptiesLedger.findMany({
      where: { supplierId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: { product: { select: { name: true, size: true } } },
    });
    const owed = new Map<string, { productId: string; product: string; owed: number }>();
    for (const e of entries.filter((x) => x.status === 'ACTIVE')) {
      const r = owed.get(e.productId) ?? { productId: e.productId, product: e.product.name, owed: 0 };
      r.owed += e.qtyIn - e.qtyOut;
      owed.set(e.productId, r);
    }
    return { entries, owed: [...owed.values()].filter((o) => o.owed !== 0) };
  }

  @Post() @RequirePermissions('PURCHASE_MANAGE')
  async record(@Body() dto: SupplierEmptiesDto, @CurrentUser() u: AuthUser) {
    const [supplier, product] = await Promise.all([
      this.prisma.supplier.findUnique({ where: { id: dto.supplierId } }),
      this.prisma.product.findUnique({ where: { id: dto.productId } }),
    ]);
    if (!supplier?.isActive) throw new BadRequestException('Unknown or inactive supplier');
    if (!product?.returnableEmpty) throw new BadRequestException('This product has no returnable empties');
    const row = await this.prisma.supplierEmptiesLedger.create({
      data: {
        supplierId: dto.supplierId, productId: dto.productId, date: dayOf(dto.date), note: dto.note, createdById: u.id,
        qtyIn: dto.direction === 'RECEIVED' ? dto.qty : 0,
        qtyOut: dto.direction === 'RETURNED' ? dto.qty : 0,
      },
    });
    await this.audit.log(u.id, 'CREATE', 'SupplierEmpties', row.id, undefined, row);
    return row;
  }

  @Post(':id/cancel') @RequirePermissions('PURCHASE_MANAGE')
  async cancel(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const r = await this.prisma.supplierEmptiesLedger.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.status === 'CANCELLED') throw new ConflictException('Already cancelled');
    const row = await this.prisma.supplierEmptiesLedger.update({ where: { id }, data: { status: 'CANCELLED', cancelledById: u.id, cancelledAt: new Date() } });
    await this.audit.log(u.id, 'CANCEL', 'SupplierEmpties', id, r, row);
    return row;
  }
}

@Module({ controllers: [SupplierEmptiesController] })
export class SupplierEmptiesModule {}
