// Build step on Vercel: build the shared package, generate the database client, bring the database up to date
// (and create the first owner when SEED_OWNER_PASSWORD is set), then compile the API.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';

// Changing the schema needs a direct connection, not the pooled one the running API uses.
const direct = process.env.DATABASE_URL_UNPOOLED ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!direct) {
  console.error('No database address. Connect a Neon database to this project first (Storage tab), then deploy again.');
  process.exit(1);
}

function run(args, env = {}) {
  const r = spawnSync('pnpm', args, { stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run(['exec', 'tsc', '-p', '../../packages/shared/tsconfig.json']);
run(['exec', 'prisma', 'generate'], { DATABASE_URL: direct });
run(['exec', 'prisma', 'migrate', 'deploy'], { DATABASE_URL: direct });
// Each business has its own schema; bring them all up to date too.
run(['exec', 'node', 'scripts/migrate-tenants.mjs'], { DATABASE_URL: direct });
// Creates the original owner and the platform admin when missing (passwords from SEED_OWNER_PASSWORD / PLATFORM_ADMIN_PASSWORD, else printed once here).
run(['exec', 'tsx', 'prisma/seed.ts'], { DATABASE_URL: direct });
run(['exec', 'nest', 'build']);
// New businesses are created by replaying the migrations inside the function, so they travel with it.
cpSync('prisma/migrations', 'dist/migrations', { recursive: true });

// Vercel wants an output folder even though everything is served by the function.
mkdirSync('public', { recursive: true });
writeFileSync('public/index.txt', 'Distribution API');
