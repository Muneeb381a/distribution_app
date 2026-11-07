import { BadRequestException, Body, Controller, Get, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { CustomerType, EmployeeType, LocationType, SupplierType, UnitName } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';

class LocationDto {
  @IsString() name: string;
  @IsEnum(LocationType) type: LocationType;
}
class UpdateLocationDto extends PartialType(LocationDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class CustomerDto {
  @IsString() name: string;
  @IsOptional() @IsString() shopName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() area?: string;
  @IsOptional() @IsEnum(CustomerType) type?: CustomerType;
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsNumber() openingBalance?: number;
  /** Which list rates the customer pays. */
  @IsOptional() @IsIn(['RETAIL', 'WHOLESALE']) priceTier?: string;
}
class UpdateCustomerDto extends PartialType(CustomerDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class RateDto {
  @IsUUID() productId: string;
  @IsEnum(UnitName) unitName: UnitName;
  @IsNumber() @Min(0) rate: number;
}
class RatesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => RateDto) rates: RateDto[];
}

class SupplierDto {
  @IsString() name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEnum(SupplierType) type?: SupplierType;
  @IsOptional() @IsNumber() openingBalance?: number;
}
class UpdateSupplierDto extends PartialType(SupplierDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class EmployeeDto {
  @IsString() name: string;
  @IsOptional() @IsString() phone?: string;
  @IsEnum(EmployeeType) type: EmployeeType;
  @IsOptional() @IsNumber() @Min(0) monthlySalary?: number;
  @IsOptional() @IsNumber() @Min(0) dailyWage?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) commissionPercent?: number;
  @IsOptional() @IsString() joinDate?: string;
  /** 0 = Sunday .. 6 = Saturday; null = no fixed day off. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(6) weeklyOff?: number | null;
}
class UpdateEmployeeDto extends PartialType(EmployeeDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

function checkCredit(type?: CustomerType, limit?: number) {
  if (type === 'CASH' && limit) throw new BadRequestException('Cash customers cannot have a credit limit');
}

function checkPay(type: EmployeeType, d: { monthlySalary?: number; dailyWage?: number }) {
  if (type === 'MONTHLY' && d.monthlySalary == null) throw new BadRequestException('monthlySalary required');
  if (type === 'DAILY' && d.dailyWage == null) throw new BadRequestException('dailyWage required');
}

@Controller()
class MasterDataController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ----- locations -----
  @Get('locations')
  locations() {
    return this.prisma.location.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  }

  @Post('locations') @RequirePermissions('MASTER_DATA_EDIT')
  async createLocation(@Body() dto: LocationDto, @CurrentUser() u: AuthUser) {
    const row = await this.prisma.location.create({ data: dto });
    await this.audit.log(u.id, 'CREATE', 'Location', row.id, undefined, row);
    return row;
  }

  @Patch('locations/:id') @RequirePermissions('MASTER_DATA_EDIT')
  async updateLocation(@Param('id') id: string, @Body() dto: UpdateLocationDto, @CurrentUser() u: AuthUser) {
    const before = await this.prisma.location.findUniqueOrThrow({ where: { id } });
    const row = await this.prisma.location.update({ where: { id }, data: dto });
    await this.audit.log(u.id, 'UPDATE', 'Location', id, before, row);
    return row;
  }

  // ----- customers -----
  @Get('customers')
  customers(@Query('search') search?: string, @Query('area') area?: string, @Query('type') type?: CustomerType) {
    return this.prisma.customer.findMany({
      where: {
        isActive: true,
        area,
        type,
        OR: search
          ? [
              { name: { contains: search, mode: 'insensitive' } },
              { shopName: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ]
          : undefined,
      },
      orderBy: { name: 'asc' },
    });
  }

  @Get('customers/:id')
  customer(@Param('id') id: string) {
    return this.prisma.customer.findUniqueOrThrow({ where: { id }, include: { rates: true } });
  }

  @Post('customers') @RequirePermissions('MASTER_DATA_EDIT')
  async createCustomer(@Body() dto: CustomerDto, @CurrentUser() u: AuthUser) {
    checkCredit(dto.type, dto.creditLimit);
    const row = await this.prisma.customer.create({ data: dto });
    await this.audit.log(u.id, 'CREATE', 'Customer', row.id, undefined, row);
    return row;
  }

  @Patch('customers/:id') @RequirePermissions('MASTER_DATA_EDIT')
  async updateCustomer(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @CurrentUser() u: AuthUser) {
    const before = await this.prisma.customer.findUniqueOrThrow({ where: { id } });
    checkCredit(dto.type ?? before.type, dto.creditLimit ?? (before.creditLimit ? Number(before.creditLimit) : undefined));
    const row = await this.prisma.customer.update({ where: { id }, data: dto });
    await this.audit.log(u.id, 'UPDATE', 'Customer', id, before, row);
    return row;
  }

  @Put('customers/:id/rates') @RequirePermissions('RATE_EDIT')
  async setRates(@Param('id') id: string, @Body() dto: RatesDto, @CurrentUser() u: AuthUser) {
    const before = await this.prisma.customerRate.findMany({ where: { customerId: id } });
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.customerRate.deleteMany({ where: { customerId: id } });
      await tx.customerRate.createMany({ data: dto.rates.map((r) => ({ ...r, customerId: id })) });
      return tx.customerRate.findMany({ where: { customerId: id } });
    });
    await this.audit.log(u.id, 'SET_RATES', 'Customer', id, before, after);
    return after;
  }

  // ----- suppliers -----
  @Get('suppliers')
  suppliers() {
    return this.prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  @Post('suppliers') @RequirePermissions('MASTER_DATA_EDIT')
  async createSupplier(@Body() dto: SupplierDto, @CurrentUser() u: AuthUser) {
    const row = await this.prisma.supplier.create({ data: dto });
    await this.audit.log(u.id, 'CREATE', 'Supplier', row.id, undefined, row);
    return row;
  }

  @Patch('suppliers/:id') @RequirePermissions('MASTER_DATA_EDIT')
  async updateSupplier(@Param('id') id: string, @Body() dto: UpdateSupplierDto, @CurrentUser() u: AuthUser) {
    const before = await this.prisma.supplier.findUniqueOrThrow({ where: { id } });
    const row = await this.prisma.supplier.update({ where: { id }, data: dto });
    await this.audit.log(u.id, 'UPDATE', 'Supplier', id, before, row);
    return row;
  }

  // ----- employees -----
  /** Names only, for dropdowns (e.g. choosing a salesman). No pay data, so no special permission. */
  @Get('employees/options')
  employeeOptions() {
    return this.prisma.employee.findMany({ where: { isActive: true }, select: { id: true, name: true, type: true, weeklyOff: true }, orderBy: { name: 'asc' } });
  }

  @Get('employees') @RequirePermissions('USER_MANAGE')
  employees() {
    return this.prisma.employee.findMany({ orderBy: { name: 'asc' } });
  }

  @Post('employees') @RequirePermissions('USER_MANAGE')
  async createEmployee(@Body() dto: EmployeeDto, @CurrentUser() u: AuthUser) {
    checkPay(dto.type, dto);
    const row = await this.prisma.employee.create({ data: { ...dto, joinDate: dto.joinDate ? new Date(dto.joinDate) : undefined } });
    await this.audit.log(u.id, 'CREATE', 'Employee', row.id, undefined, row);
    return row;
  }

  @Patch('employees/:id') @RequirePermissions('USER_MANAGE')
  async updateEmployee(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @CurrentUser() u: AuthUser) {
    const before = await this.prisma.employee.findUniqueOrThrow({ where: { id } });
    const row = await this.prisma.employee.update({
      where: { id },
      data: { ...dto, joinDate: dto.joinDate ? new Date(dto.joinDate) : undefined },
    });
    await this.audit.log(u.id, 'UPDATE', 'Employee', id, before, row);
    return row;
  }
}

@Module({ controllers: [MasterDataController] })
export class MasterDataModule {}
