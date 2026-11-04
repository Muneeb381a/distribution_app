import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_DB = 'distribution_test';

/** The dev database URL from the environment or apps/api/.env. */
export function devUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(join(API_DIR, '.env'), 'utf8');
  const m = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m);
  if (!m) throw new Error('DATABASE_URL not found');
  return m[1];
}

const withDb = (url, db) => url.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);

export const adminUrl = () => withDb(devUrl(), 'postgres');
export const testUrl = () => withDb(devUrl(), TEST_DB);
