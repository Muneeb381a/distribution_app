import { Body, Controller, Get, Global, Injectable, Module, Post, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { IsString } from 'class-validator';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma.service.js';
import { CurrentUser, Public, type AuthUser } from '../common/decorators.js';
import { AuthGuard } from './auth.guard.js';

class LoginDto {
  @IsString() username: string;
  @IsString() password: string;
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(username: string, password: string) {
    const user = await this.prisma.appUser.findUnique({
      where: { username },
      include: { role: { include: { permissions: true } } },
    });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid username or password');
    }
    const payload: AuthUser = {
      id: user.id,
      username: user.username,
      roleName: user.role.name,
      permissions: user.role.permissions.map((p) => p.permissionCode),
    };
    return { accessToken: await this.jwt.signAsync(payload), user: payload };
  }
}

@Controller('auth')
class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
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
