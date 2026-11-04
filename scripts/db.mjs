// Helpers shared by backup.mjs and restore.mjs: where the database is and how to run the
// PostgreSQL tools against it (installed locally, or inside the docker compose "db" service).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** DATABASE_URL from the environment, else from apps/api/.env. */
export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = join(ROOT, 'apps/api/.env');
  if (existsSync(env)) {
    const m = readFileSync(env, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (m) return m[1];
  }
  throw new Error('DATABASE_URL is not set and apps/api/.env has none');
}

export function parseUrl(url) {
  const u = new URL(url);
  return { host: u.hostname, port: u.port || '5432', user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), db: u.pathname.slice(1).split('?')[0] };
}

const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;

/**
 * How to run pg_dump / pg_restore / psql. BACKUP_MODE=local|docker forces one; otherwise the
 * docker compose "db" service is used when it is running, else the tools on the PATH.
 */
export function tools(conn) {
  const mode = process.env.BACKUP_MODE
    ?? (has('docker', ['compose', 'ps', '--status', 'running', '--services']) && execFileSync('docker', ['compose', 'ps', '--status', 'running', '--services'], { cwd: ROOT, encoding: 'utf8' }).split('\n').includes('db') ? 'docker' : 'local');
  if (mode === 'docker') {
    // Inside the container the server is on its own port 5432.
    return {
      mode,
      cmd: (tool, args) => ['docker', ['compose', 'exec', '-T', '-e', `PGPASSWORD=${conn.password}`, 'db', tool, '-U', conn.user, ...args]],
    };
  }
  if (!has('pg_dump')) throw new Error('pg_dump was not found. Install the PostgreSQL client tools, or start the database with docker compose.');
  return {
    mode,
    cmd: (tool, args) => [tool, ['-h', conn.host, '-p', conn.port, '-U', conn.user, ...args]],
    env: { PGPASSWORD: conn.password },
  };
}

/** Runs a tool, optionally feeding a file on stdin or writing stdout to a file descriptor. */
export function run(t, tool, args, { input, output } = {}) {
  const [cmd, argv] = t.cmd(tool, args);
  const r = spawnSync(cmd, argv, {
    cwd: ROOT, env: { ...process.env, ...(t.env ?? {}) }, maxBuffer: 1 << 30,
    stdio: [input ?? 'ignore', output ?? 'pipe', 'pipe'],
  });
  if (r.status !== 0) throw new Error(`${tool} failed: ${(r.stderr ?? '').toString().trim() || `exit ${r.status}`}`);
  return r.stdout ? r.stdout.toString() : '';
}
