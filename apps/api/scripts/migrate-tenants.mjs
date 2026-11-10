// Brings every business's own schema up to date, the same way `prisma migrate deploy` does for the main one.
// Run after the main schema is migrated (the list of businesses lives there). Uses DATABASE_URL (a direct address).
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const base = process.env.DATABASE_URL;
if (!base) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const u = new URL(base);
const local = ['localhost', '127.0.0.1'].includes(u.hostname);
const client = new pg.Client({
  host: u.hostname, port: u.port ? Number(u.port) : 5432, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), ssl: local || u.searchParams.get('sslmode') === 'disable' ? false : { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(`SELECT "schemaName" FROM "Tenant" WHERE "schemaName" <> 'public' ORDER BY "createdAt"`);
await client.end();

let failed = 0;
for (const { schemaName } of rows) {
  if (!/^t_[a-z0-9_]{2,40}$/.test(schemaName)) { console.error(`Skipping odd schema name ${schemaName}`); failed++; continue; }
  const url = new URL(base);
  url.searchParams.set('schema', schemaName);
  console.log(`Migrating ${schemaName} ...`);
  const r = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url.toString() }, shell: process.platform === 'win32' });
  if (r.status !== 0) failed++;
}
console.log(`${rows.length} business schema(s) checked${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
