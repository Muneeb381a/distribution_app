import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { BaseUnit, BusinessLineCode, UnitName } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { createProducts } from './product-rows.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';

class CategoryDto {
  @IsEnum(BusinessLineCode) businessLine: BusinessLineCode;
  @IsString() name: string;
  @IsOptional() @IsUUID() parentId?: string;
}

class UnitDto {
  @IsEnum(UnitName) unitName: UnitName;
  @IsNumber() @IsPositive() factorToBase: number;
}

class ProductDto {
  @IsUUID() categoryId: string;
  @IsString() name: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() size?: string;
  @IsEnum(BaseUnit) baseUnit: BaseUnit;
  @IsOptional() @IsBoolean() isPacked?: boolean;
  @IsOptional() @IsBoolean() returnableEmpty?: boolean;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => UnitDto) units: UnitDto[];
}

/** One product from the starter catalog (same shape as an Excel import row). */
class ProductSpecDto {
  @IsEnum(BusinessLineCode) line: BusinessLineCode;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(4) @IsString({ each: true }) @MaxLength(60, { each: true }) path: string[];
  @IsString() @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(60) brand: string | null;
  @IsOptional() @IsString() @MaxLength(30) size: string | null;
  @IsInt() @Min(1) packSize: number;
  @IsOptional() @IsNumber() @IsPositive() bagKg: number | null;
  @IsBoolean() returnableEmpty: boolean;
  @IsOptional() @IsBoolean() isPacked?: boolean;
}
class BulkProductsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ProductSpecDto) items: ProductSpecDto[];
}

class UpdateProductDto extends PartialType(ProductDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

interface ProductQuery {
  line?: BusinessLineCode;
  categoryId?: string;
  search?: string;
  includeInactive?: string;
}

@Injectable()
export class CatalogService {
  constructor(public prisma: PrismaService, public audit: AuditService) {}

  listCategories(line?: BusinessLineCode) {
    return this.prisma.category.findMany({
      where: line ? { businessLine: { code: line } } : undefined,
      include: { businessLine: { select: { code: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(dto: CategoryDto, user: AuthUser) {
    const line = await this.prisma.businessLine.findUniqueOrThrow({ where: { code: dto.businessLine } });
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.businessLineId !== line.id) throw new BadRequestException('Parent is in a different business line');
    }
    const cat = await this.prisma.category.create({
      data: { businessLineId: line.id, name: dto.name, parentId: dto.parentId },
    });
    await this.audit.log(user.id, 'CREATE', 'Category', cat.id, undefined, cat);
    return cat;
  }

  listProducts(q: ProductQuery) {
    return this.prisma.product.findMany({
      where: {
        isActive: q.includeInactive === 'true' ? undefined : true,
        categoryId: q.categoryId,
        category: q.line ? { businessLine: { code: q.line } } : undefined,
        name: q.search ? { contains: q.search, mode: 'insensitive' } : undefined,
      },
      include: { units: true, category: { select: { name: true, businessLine: { select: { code: true } } } } },
      orderBy: { name: 'asc' },
    });
  }

  private checkUnits(baseUnit: BaseUnit, units: UnitDto[]) {
    const names = units.map((u) => u.unitName);
    if (new Set(names).size !== names.length) throw new BadRequestException('Duplicate unit');
    const allowed: UnitName[] = baseUnit === 'BOTTLE' ? ['BOTTLE', 'CARTON'] : ['KG', 'MAUND', 'BAG'];
    if (names.some((n) => !allowed.includes(n))) throw new BadRequestException(`Units for ${baseUnit} must be ${allowed.join(', ')}`);
    const base = units.find((u) => u.unitName === baseUnit);
    if (!base || Number(base.factorToBase) !== 1) throw new BadRequestException(`Base unit ${baseUnit} is required with factor 1`);
  }

  async createProduct(dto: ProductDto, user: AuthUser) {
    this.checkUnits(dto.baseUnit, dto.units);
    const { units, ...rest } = dto;
    const product = await this.prisma.product.create({
      data: { ...rest, units: { create: units } },
      include: { units: true },
    });
    await this.audit.log(user.id, 'CREATE', 'Product', product.id, undefined, product);
    return product;
  }

  async updateProduct(id: string, dto: UpdateProductDto, user: AuthUser) {
    const before = await this.prisma.product.findUniqueOrThrow({ where: { id }, include: { units: true } });
    const baseUnit = dto.baseUnit ?? before.baseUnit;
    if (dto.units) this.checkUnits(baseUnit, dto.units);
    else if (dto.baseUnit && dto.baseUnit !== before.baseUnit) throw new BadRequestException('Changing base unit requires new units');
    const { units, ...rest } = dto;
    const after = await this.prisma.product.update({
      where: { id },
      data: { ...rest, units: units ? { deleteMany: {}, create: units } : undefined },
      include: { units: true },
    });
    await this.audit.log(user.id, 'UPDATE', 'Product', id, before, after);
    return after;
  }
}

@Controller()
class CatalogController {
  constructor(private svc: CatalogService) {}

  @Get('categories')
  categories(@Query('line') line?: BusinessLineCode) {
    return this.svc.listCategories(line);
  }

  @Post('categories') @RequirePermissions('MASTER_DATA_EDIT')
  createCategory(@Body() dto: CategoryDto, @CurrentUser() u: AuthUser) {
    return this.svc.createCategory(dto, u);
  }

  @Get('products')
  products(@Query() q: ProductQuery) {
    return this.svc.listProducts(q);
  }

  @Post('products') @RequirePermissions('MASTER_DATA_EDIT')
  createProduct(@Body() dto: ProductDto, @CurrentUser() u: AuthUser) {
    return this.svc.createProduct(dto, u);
  }

  /** Many products at once, e.g. picked from the starter catalog. Existing name+size pairs are skipped. */
  @Post('products/bulk') @RequirePermissions('MASTER_DATA_EDIT')
  async bulk(@Body() dto: BulkProductsDto, @CurrentUser() u: AuthUser) {
    const result = await this.svc.prisma.$transaction((tx) => createProducts(tx, dto.items), { timeout: 30_000 });
    await this.svc.audit.log(u.id, 'CREATE', 'Product', undefined, undefined, { bulk: result.created.length, skipped: result.skipped.length });
    return result;
  }

  @Patch('products/:id') @RequirePermissions('MASTER_DATA_EDIT')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() u: AuthUser) {
    return this.svc.updateProduct(id, dto, u);
  }
}

@Module({ controllers: [CatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
