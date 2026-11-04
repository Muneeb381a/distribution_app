#!/usr/bin/env node
// Backs up the whole database to backups/distribution-YYYY-MM-DD_HHMM.dump (PostgreSQL custom
// format: compressed, restorable with restore.mjs), checks the file can be read back, keeps the last
// 14 days plus one per month for 12 months, and copies it to BACKUP_COPY_DIR if set (a USB drive or a
// Google Drive / OneDrive folder, so a copy lives off this PC).
//
//   node scripts/backup.mjs            (or: pnpm backup)
//
// Settings (environment): DATABASE_URL (else apps/api/.env), BACKUP_DIR (default ./backups),
// BACKUP_COPY_DIR, BACKUP_KEEP_DAYS (14), BACKUP_KEEP_MONTHS (12), BACKUP_MODE (local|docker).
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, databaseUrl, parseUrl, run, tools } from './db.mjs';

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

const conn = parseUrl(databaseUrl());
const t = tools(conn);
const dir = resolve(ROOT, process.env.BACKUP_DIR ?? 'backups');
mkdirSync(dir, { recursive: true });
const file = join(dir, `${conn.db}-${stamp}.dump`);

console.log(`Backing up ${conn.db} (${t.mode}) to ${file}`);
const fd = openSync(file, 'w');
try {
  run(t, 'pg_dump', ['-Fc', '--no-owner', '--no-privileges', conn.db], { output: fd });
} finally {
  closeSync(fd);
}

// A backup that cannot be read is no backup: list its contents and count the tables in it.
const fdIn = openSync(file, 'r');
let tables = 0;
try {
  const list = run(t, 'pg_restore', ['--list'], { input: fdIn });
  tables = list.split('\n').filter((l) => / TABLE DATA /.test(l)).length;
} finally {
  closeSync(fdIn);
}
const size = statSync(file).size;
if (!tables || size < 1024) throw new Error(`Backup looks empty (${tables} tables, ${size} bytes): ${file}`);
console.log(`OK: ${tables} tables, ${(size / 1024).toFixed(0)} KB`);

// Keep the newest BACKUP_KEEP_DAYS days, plus the newest backup of each of the last BACKUP_KEEP_MONTHS months.
const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 14);
const keepMonths = Number(process.env.BACKUP_KEEP_MONTHS ?? 12);
const prune = (folder) => {
  const re = new RegExp(`^${conn.db}-(\\d{4}-\\d{2})-(\\d{2})_\\d{4}\\.dump$`);
  const all = readdirSync(folder).filter((f) => re.test(f)).sort().reverse();
  const days = new Set(), months = new Set(), keep = new Set();
  for (const f of all) {
    const [, month, day] = f.match(re);
    if (days.size < keepDays || days.has(`${month}-${day}`)) { days.add(`${month}-${day}`); keep.add(f); }
    if (!months.has(month) && months.size < keepMonths) { months.add(month); keep.add(f); }
  }
  for (const f of all) if (!keep.has(f)) unlinkSync(join(folder, f));
  return all.length - keep.size;
};
const removed = prune(dir);
if (removed) console.log(`Removed ${removed} old backup${removed === 1 ? '' : 's'}`);

if (process.env.BACKUP_COPY_DIR) {
  const copyDir = resolve(process.env.BACKUP_COPY_DIR);
  if (!existsSync(copyDir)) {
    console.warn(`WARNING: BACKUP_COPY_DIR ${copyDir} is not reachable (USB unplugged?). Only the local copy was made.`);
    process.exitCode = 2;
  } else {
    copyFileSync(file, join(copyDir, `${conn.db}-${stamp}.dump`));
    prune(copyDir);
    console.log(`Copied to ${copyDir}`);
  }
}
writeFileSync(join(dir, 'last-backup.json'), JSON.stringify({ file, at: now.toISOString(), tables, bytes: size }, null, 2));
