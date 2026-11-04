import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

interface AuditQuery { entity?: string; entityId?: string; userId?: string; action?: string; from?: string; to?: string; before?: string; limit?: string }
const DAY = /^\d{4}-\d{2}-\d{2}$/;

@Controller('audit-log')
class AuditController {
  constructor(private prisma: PrismaService) {}

  /**
   * Newest first. Optional filters: entity, entityId, userId, action, from/to (YYYY-MM-DD, inclusive),
   * and `before` (an ISO timestamp from the last row) to page back. Default page is 200 rows.
   */
  @Get() @RequirePermissions('AUDIT_VIEW')
  list(@Query() q: AuditQuery) {
    const at: Prisma.DateTimeFilter = {};
    if (q.from && DAY.test(q.from)) at.gte = new Date(`${q.from}T00:00:00.000Z`);
    if (q.to && DAY.test(q.to)) at.lt = new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000);
    if (q.before && !Number.isNaN(Date.parse(q.before))) at.lt = at.lt && at.lt < new Date(q.before) ? at.lt : new Date(q.before);
    const take = Math.min(Math.max(Number(q.limit) || 200, 1), 500);
    return this.prisma.auditLog.findMany({
      where: { entity: q.entity, entityId: q.entityId, userId: q.userId, action: q.action, at: Object.keys(at).length ? at : undefined },
      orderBy: { at: 'desc' },
      take,
      include: { user: { select: { username: true } } },
    });
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
