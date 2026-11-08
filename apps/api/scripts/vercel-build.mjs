// Build step on Vercel: build the shared package, generate the database client, bring the database up to date
// (and create the first owner when SEED_OWNER_PASSWORD is set), then compile the API.
import { spawnSync } from 'node:child_process';

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
if (process.env.SEED_OWNER_PASSWORD) run(['exec', 'tsx', 'prisma/seed.ts'], { DATABASE_URL: direct });
run(['exec', 'nest', 'build']);
