import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantStore } from './tenancy/tenant-context.js';

/**
 * The database address. On Vercel every request can start its own function, so each one may only hold a single
 * database connection, and Neon's pooled address (the one with -pooler in its name) needs pgbouncer mode.
 * Elsewhere the address is used as given.
 */
export function baseDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !process.env.VERCEL) return url;
  const u = new URL(url);
  if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '1');
  if (u.hostname.includes('-pooler') && !u.searchParams.has('pgbouncer')) u.searchParams.set('pgbouncer', 'true');
  if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '15');
  return u.toString();
}

/** The same database, pointed at one business's schema. */
export function schemaUrl(schema: string): string {
  const u = new URL(baseDatabaseUrl()!);
  u.searchParams.set('schema', schema);
  return u.toString();
}

/** A warm function serves mostly one business at a time; a few clients are kept so switching is cheap. */
const KEEP_CLIENTS = 4;

/**
 * The database client every service uses. It behaves like a normal PrismaClient, but while a request is being served
 * it quietly points at that request's business (see tenancy/tenant-context.ts), so no service has to know about it.
 *
 *  - `control` is always the main schema: the list of businesses, platform admins and activity records.
 *  - `forSchema(name)` is a client for one named business, used by the platform console.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  declare readonly control: PrismaClient;
  declare forSchema: (schema: string) => PrismaClient;

  private clients = new Map<string, PrismaClient>();

  constructor() {
    const url = baseDatabaseUrl();
    super(url ? { datasourceUrl: url } : undefined);
    const main = this as unknown as PrismaClient;
    const clientFor = (schema: string): PrismaClient => {
      if (schema === 'public') return main;
      let c = this.clients.get(schema);
      if (c) {
        // most recently used goes last
        this.clients.delete(schema);
      } else {
        c = new PrismaClient({ datasourceUrl: schemaUrl(schema) });
        if (this.clients.size >= KEEP_CLIENTS) {
          const oldest = this.clients.keys().next().value!;
          void this.clients.get(oldest)!.$disconnect();
          this.clients.delete(oldest);
        }
      }
      this.clients.set(schema, c);
      return c;
    };
    return new Proxy(this, {
      get: (target, prop) => {
        if (prop === 'control') return main;
        if (prop === 'forSchema') return clientFor;
        const ctx = tenantStore.getStore();
        const client = ctx && ctx.schema !== 'public' ? clientFor(ctx.schema) : (target as unknown as PrismaClient);
        const v = Reflect.get(client, prop, client);
        return typeof v === 'function' ? v.bind(client) : v;
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await Promise.all([...this.clients.values()].map((c) => c.$disconnect()));
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
