import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service.js';
import { IS_PUBLIC, PERMISSIONS_KEY, type AuthUser } from '../common/decorators.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    let user: AuthUser;
    try {
      user = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException();
    }
    // The token only proves who signed in. Role and active status are read fresh, so disabling a user
    // or editing a role takes effect on the very next request.
    const row = await this.prisma.appUser.findUnique({
      where: { id: user.id },
      select: { isActive: true, username: true, role: { select: { name: true, permissions: { select: { permissionCode: true } } } } },
    });
    if (!row?.isActive) throw new UnauthorizedException();
    user = { id: user.id, username: row.username, roleName: row.role.name, permissions: row.role.permissions.map((p) => p.permissionCode) };
    req.user = user;

    const needed = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets) ?? [];
    if (needed.some((p) => !user.permissions.includes(p))) throw new ForbiddenException('Missing permission');
    return true;
  }
}
