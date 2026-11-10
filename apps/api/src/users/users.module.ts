import { currentTenant } from '../tenancy/tenant-context.js';
import { BadRequestException, Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { PERMISSIONS } from '../common/permissions.js';

class CreateUserDto {
  @IsString() @MinLength(3) username: string;
  @IsString() @MinLength(6) password: string;
  @IsUUID() roleId: string;
  @IsOptional() @IsUUID() employeeId?: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(6) password?: string;
  @IsOptional() @IsUUID() roleId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class RoleDto {
  @IsString() name: string;
  @IsArray() @IsIn(PERMISSIONS, { each: true }) permissions: string[];
}

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
  isActive: true,
  employeeId: true,
  role: { select: { id: true, name: true } },
} as const;

@Controller()
class UsersController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get('permissions') @RequirePermissions('USER_MANAGE')
  permissions() {
    return PERMISSIONS;
  }

  @Get('roles') @RequirePermissions('USER_MANAGE')
  roles() {
    return this.prisma.role.findMany({ include: { permissions: true }, orderBy: { name: 'asc' } });
  }

  @Post('roles') @RequirePermissions('USER_MANAGE')
  async createRole(@Body() dto: RoleDto, @CurrentUser() u: AuthUser) {
    const role = await this.prisma.role.create({
      data: { name: dto.name, permissions: { create: dto.permissions.map((permissionCode) => ({ permissionCode })) } },
      include: { permissions: true },
    });
    await this.audit.log(u.id, 'CREATE', 'Role', role.id, undefined, role);
    return role;
  }

  @Patch('roles/:id') @RequirePermissions('USER_MANAGE')
  async updateRole(@Param('id') id: string, @Body() dto: RoleDto, @CurrentUser() u: AuthUser) {
    const before = await this.prisma.role.findUniqueOrThrow({ where: { id }, include: { permissions: true } });
    if (before.name === 'Owner') throw new BadRequestException('The Owner role cannot be changed');
    const after = await this.prisma.role.update({
      where: { id },
      data: {
        name: dto.name,
        permissions: { deleteMany: {}, create: dto.permissions.map((permissionCode) => ({ permissionCode })) },
      },
      include: { permissions: true },
    });
    await this.audit.log(u.id, 'UPDATE', 'Role', id, before, after);
    return after;
  }

  @Get('users') @RequirePermissions('USER_MANAGE')
  users() {
    return this.prisma.appUser.findMany({ select: publicUser, orderBy: { username: 'asc' } });
  }

  /** The plan of this business may cap how many staff accounts can be active. */
  private async checkSeat() {
    const max = currentTenant()?.maxUsers;
    if (max && (await this.prisma.appUser.count({ where: { isActive: true } })) >= max) {
      throw new BadRequestException(`This account allows ${max} active user${max === 1 ? '' : 's'}. Turn one off first, or ask the software provider for a bigger plan.`);
    }
  }

  @Post('users') @RequirePermissions('USER_MANAGE')
  async createUser(@Body() dto: CreateUserDto, @CurrentUser() u: AuthUser) {
    await this.checkSeat();
    const { password, ...rest } = dto;
    const user = await this.prisma.appUser.create({
      data: { ...rest, passwordHash: await bcrypt.hash(password, 10) },
      select: publicUser,
    });
    await this.audit.log(u.id, 'CREATE', 'AppUser', user.id, undefined, user);
    return user;
  }

  @Patch('users/:id') @RequirePermissions('USER_MANAGE')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() u: AuthUser) {
    if (id === u.id && dto.isActive === false) throw new BadRequestException('You cannot deactivate yourself');
    const before = await this.prisma.appUser.findUniqueOrThrow({ where: { id }, select: publicUser });
    if (dto.isActive === true && !before.isActive) await this.checkSeat();
    const { password, ...rest } = dto;
    const after = await this.prisma.appUser.update({
      where: { id },
      data: { ...rest, passwordHash: password ? await bcrypt.hash(password, 10) : undefined },
      select: publicUser,
    });
    await this.audit.log(u.id, password ? 'UPDATE_PASSWORD' : 'UPDATE', 'AppUser', id, before, after);
    return after;
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
