import { BadRequestException, Body, ConflictException, Controller, Get, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

class CategoryDto {
  @IsString() @MaxLength(40) name: string;
  @IsOptional() @Matches(HEX, { message: 'color must look like #0ea5e9' }) color?: string;
}

class UpdateCategoryDto {
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  /** Empty string goes back to the automatic colour. */
  @IsOptional() @Matches(/^(#[0-9a-fA-F]{6})?$/, { message: 'color must look like #0ea5e9' }) color?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

@Controller('expense-categories')
class ExpenseCategoriesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Every category with how much has been spent under it. Names used on old expenses but missing here are added first. */
  @Get() @RequirePermissions('EXPENSE_MANAGE')
  async list() {
    const used = await this.prisma.expense.groupBy({ by: ['category'], where: { status: 'ACTIVE' }, _sum: { amount: true }, _count: true });
    const known = new Set((await this.prisma.expenseCategory.findMany({ select: { name: true } })).map((c) => c.name.toLowerCase()));
    const missing = (await this.prisma.expense.findMany({ distinct: ['category'], select: { category: true } })).map((e) => e.category).filter((n) => !known.has(n.toLowerCase()));
    if (missing.length) await this.prisma.expenseCategory.createMany({ data: missing.map((name) => ({ name })), skipDuplicates: true });
    const rows = await this.prisma.expenseCategory.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    return rows.map((c) => {
      const u = used.find((x) => x.category === c.name);
      return { ...c, entries: u?._count ?? 0, total: u?._sum.amount ?? new Prisma.Decimal(0) };
    });
  }

  @Post() @RequirePermissions('EXPENSE_MANAGE')
  async create(@Body() dto: CategoryDto, @CurrentUser() u: AuthUser) {
    const name = clean(dto.name);
    if (!name) throw new BadRequestException('Give the category a name');
    await this.checkName(name);
    const row = await this.prisma.expenseCategory.create({ data: { name, color: dto.color?.toLowerCase() } });
    await this.audit.log(u.id, 'CREATE', 'ExpenseCategory', row.id, undefined, row);
    return row;
  }

  @Patch(':id') @RequirePermissions('EXPENSE_MANAGE')
  async update(@Param('id') id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() u: AuthUser) {
    const before = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    const name = dto.name === undefined ? before.name : clean(dto.name);
    const renamed = name !== before.name;
    if (before.isSystem && (renamed || dto.isActive === false)) throw new BadRequestException(`“${before.name}” is used by payroll and cannot be renamed or hidden`);
    if (!name) throw new BadRequestException('Give the category a name');
    if (renamed) await this.checkName(name, id);
    const row = await this.prisma.$transaction(async (tx) => {
      // Expenses keep the name as text, so a rename carries the old entries along.
      if (renamed) await tx.expense.updateMany({ where: { category: before.name }, data: { category: name } });
      return tx.expenseCategory.update({
        where: { id },
        data: { name, color: dto.color === undefined ? undefined : dto.color.toLowerCase() || null, isActive: dto.isActive },
      });
    });
    await this.audit.log(u.id, 'UPDATE', 'ExpenseCategory', id, before, row);
    return row;
  }

  private async checkName(name: string, exceptId?: string) {
    const same = await this.prisma.expenseCategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, id: exceptId ? { not: exceptId } : undefined } });
    if (same) throw new ConflictException(same.isActive ? `“${same.name}” already exists` : `“${same.name}” already exists but is hidden; show it again from the list`);
  }
}

@Module({ controllers: [ExpenseCategoriesController] })
export class ExpenseCategoriesModule {}
