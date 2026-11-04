import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { RequirePermissions } from '../common/decorators.js';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  log(userId: string | null, action: string, entity: string, entityId?: string, before?: unknown, after?: unknown) {
    return this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        beforeJson: before === undefined ? undefined : JSON.parse(JSON.stringify(before)),
        afterJson: after === undefined ? undefined : JSON.parse(JSON.stringify(after)),
      },
    });
  }
}

@Controller('audit-log')
class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get() @RequirePermissions('AUDIT_VIEW')
  list(@Query('entity') entity?: string, @Query('entityId') entityId?: string) {
    return this.prisma.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { at: 'desc' },
      take: 200,
      include: { user: { select: { username: true } } },
    });
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
