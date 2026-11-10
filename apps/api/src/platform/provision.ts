import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** Schema names are made by the server from a checked business code; this keeps anything else out of SQL. */
export const SCHEMA = /^t_[a-z0-9_]{2,40}$/;

const here = dirname(fileURLToPath(import.meta.url));
/** The migration files: prisma/migrations in the repository, or the copy the Vercel build puts next to the compiled code. */
const MIGRATIONS = [join(here, '..', '..', 'prisma', 'migrations'), join(here, '..', 'migrations')].find((p) => existsSync(p)) ?? join(here, '..', '..', 'prisma', 'migrations');

export const schemaFor = (code: string) => `t_${code.replace(/-/g, '_')}`;

function connect() {
  const raw = process.env.DATABASE_URL_UNPOOLED ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const u = new URL(raw);
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  return new pg.Client({
    host: u.hostname, port: u.port ? Number(u.port) : 5432, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.slice(1), ssl: local || u.searchParams.get('sslmode') === 'disable' ? false : { rejectUnauthorized: false },
  });
}

/** Run something on one short-lived connection (a pooled address cannot be used: the steps must share a session). */
async function withClient<T>(run: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = connect();
  await c.connect();
  try {
    return await run(c);
  } finally {
    await c.end();
  }
}

/**
 * A new, empty business: its own schema with every table, enum and starting row that the migrations make.
 * The migrations are applied the way Prisma would, and recorded in the schema's own migration history,
 * so `prisma migrate deploy` can bring this schema up to date later like any other.
 */
export async function createSchema(schema: string): Promise<void> {
  if (!SCHEMA.test(schema)) throw new Error('Bad schema name');
  const names = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  await withClient(async (c) => {
    await c.query('BEGIN');
    try {
      await c.query(`CREATE SCHEMA "${schema}"`);
      await c.query(`SET LOCAL search_path TO "${schema}"`);
      await c.query(`CREATE TABLE "_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
      for (const name of names) {
        const sql = readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8');
        await c.query(sql);
        await c.query(
          `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count") VALUES ($1, $2, now(), $3, 1)`,
          [randomUUID(), createHash('sha256').update(sql).digest('hex'), name],
        );
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
  });
}

export async function dropSchema(schema: string): Promise<void> {
  if (!SCHEMA.test(schema)) throw new Error('Bad schema name');
  await withClient((c) => c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
}

export async function schemaExists(schema: string): Promise<boolean> {
  return withClient(async (c) => (await c.query('SELECT 1 FROM information_schema.schemata WHERE schema_name = $1', [schema])).rowCount! > 0);
}
