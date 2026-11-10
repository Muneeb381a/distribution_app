import { BadRequestException, Body, Controller, Get, Global, Injectable, Module, Patch, Post, Req, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service.js';
import { CurrentUser, Public, type AuthUser } from '../common/decorators.js';
import { AuthGuard } from './auth.guard.js';
import { ActivityService } from '../tenancy/tenancy.module.js';
import { clientInfo } from '../tenancy/request-info.js';
import { currentTenant, MAIN_TENANT } from '../tenancy/tenant-context.js';

class LoginDto {
  @IsString() username: string;
  @IsString() password: string;
  /** The business code; left out for the original business. */
  @IsOptional() @IsString() @MaxLength(40) business?: string;
}

class ProfileDto {
  @IsOptional() @IsString() @MaxLength(60) displayName?: string;
  /** A small square picture as a data URL (the browser shrinks it first); null removes it. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(90_000) @Matches(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, { message: 'avatar must be a JPEG, PNG or WebP picture' })
  avatar?: string | null;
}

class PasswordDto {
  @IsString() current: string;
  @IsString() @MinLength(6) next: string;
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private activity: ActivityService) {}

  async login(username: string, password: string, req: Request) {
    const tenant = currentTenant();
    const info = clientInfo(req);
    const event = { scope: 'TENANT' as const, tenantId: tenant?.id, tenantCode: tenant?.code ?? MAIN_TENANT, username, info };
    await this.activity.checkAttempts('TENANT', username, event.tenantCode, info.ip);
    const user = await this.prisma.appUser.findUnique({
      where: { username },
      include: { role: { include: { permissions: true } } },
    });
    const reason = !user ? 'Unknown username' : !user.isActive ? 'Account turned off' : !(await bcrypt.compare(password, user.passwordHash)) ? 'Wrong password' : null;
    if (!user || reason) {
      await this.activity.loginEvent({ ...event, success: false, reason: reason ?? 'Unknown username' });
      throw new UnauthorizedException('Invalid username or password');
    }
    const payload: AuthUser = {
      id: user.id,
      username: user.username,
      roleName: user.role.name,
      permissions: user.role.permissions.map((p) => p.permissionCode),
    };
    await this.activity.loginEvent({ ...event, success: true });
    return { accessToken: await this.jwt.signAsync({ ...payload, tid: tenant?.code ?? MAIN_TENANT }), user: { ...payload, displayName: user.displayName, avatar: user.avatar } };
  }

  /** The signed-in user with their picture; the picture is kept out of the token so it stays small. */
  async profile(user: AuthUser) {
    const row = await this.prisma.appUser.findUniqueOrThrow({ where: { id: user.id }, select: { displayName: true, avatar: true } });
    return { ...user, displayName: row.displayName, avatar: row.avatar };
  }

  async updateProfile(user: AuthUser, dto: ProfileDto) {
    const data: { displayName?: string | null; avatar?: string | null } = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName.trim() || null;
    if (dto.avatar !== undefined) data.avatar = dto.avatar;
    await this.prisma.appUser.update({ where: { id: user.id }, data });
    return this.profile(user);
  }

  async changePassword(user: AuthUser, current: string, next: string) {
    const row = await this.prisma.appUser.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await bcrypt.compare(current, row.passwordHash))) throw new BadRequestException('Your current password is not correct');
    await this.prisma.appUser.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
    return { ok: true };
  }
}

@Controller('auth')
class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.username, dto.password, req);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user);
  }

  @Patch('profile')
  profile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto) {
    return this.auth.updateProfile(user, dto);
  }

  @Post('password')
  password(@CurrentUser() user: AuthUser, @Body() dto: PasswordDto) {
    return this.auth.changePassword(user, dto.current, dto.next);
  }
}

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-only-secret',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
