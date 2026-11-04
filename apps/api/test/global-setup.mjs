import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { adminUrl, API_DIR, TEST_DB, testUrl } from './db-url.mjs';

export const OWNER_PASSWORD = 'owner-test-123';

/** A fresh, migrated and seeded database for every test run. The dev database is never touched. */
export default async function setup() {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.$disconnect();
  }
  const env = { ...process.env, DATABASE_URL: testUrl(), SEED_OWNER_PASSWORD: OWNER_PASSWORD };
  execSync('npx prisma migrate deploy', { cwd: API_DIR, env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { cwd: API_DIR, env, stdio: 'pipe' });
}
