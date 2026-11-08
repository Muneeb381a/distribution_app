import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * On Vercel every request can start its own function, so each one may only hold a single database connection,
 * and Neon's pooled address (the one with -pooler in its name) needs pgbouncer mode. Elsewhere the address is used as given.
 */
function datasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !process.env.VERCEL) return undefined;
  const u = new URL(url);
  if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '1');
  if (u.hostname.includes('-pooler') && !u.searchParams.has('pgbouncer')) u.searchParams.set('pgbouncer', 'true');
  if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '15');
  return u.toString();
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const url = datasourceUrl();
    super(url ? { datasourceUrl: url } : undefined);
  }

  async onModuleInit() {
    await this.$connect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
