import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service.js';

/** Platform tokens are signed with their own secret, so a business's token can never open the console. */
export const PLATFORM_SECRET = () => `${process.env.JWT_SECRET ?? 'dev-only-secret'}:platform`;

export interface Admin { id: string; username: string; displayName: string | null }

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): Admin => ctx.switchToHttp().getRequest().admin);

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; kind?: string }>(token, { secret: PLATFORM_SECRET() });
      if (p.kind !== 'platform') throw new Error('not a platform token');
      const admin = await this.prisma.control.platformAdmin.findUnique({ where: { id: p.sub } });
      if (!admin?.isActive) throw new Error('inactive');
      req.admin = { id: admin.id, username: admin.username, displayName: admin.displayName } satisfies Admin;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
