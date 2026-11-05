#!/usr/bin/env node
// Restores a backup made by backup.mjs.
//
//   node scripts/restore.mjs backups/distribution-2026-11-04_2100.dump
//       restores into a NEW database (distribution_restore_YYYYMMDD) so you can check it first;
//       nothing in the live database changes.
//   node scripts/restore.mjs <file> --replace-live-data
//       replaces the live database with the backup. Stop the API first. Everything entered
//       after the backup was taken is lost.
import { closeSync, existsSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { databaseUrl, parseUrl, run, tools } from './db.mjs';

const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith('--'));
const replace = args.includes('--replace-live-data');
if (!fileArg) {
  console.error('Usage: node scripts/restore.mjs <backup.dump> [--replace-live-data]');
  process.exit(1);
}
const file = resolve(fileArg);
if (!existsSync(file)) { console.error(`No such file: ${file}`); process.exit(1); }

const conn = parseUrl(databaseUrl());
const t = tools(conn);
const d = new Date();
const target = replace ? conn.db : `${conn.db}_restore_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const sql = (q) => run(t, 'psql', ['-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qc', q]);

if (replace) {
  console.log(`Replacing the live database "${conn.db}" with ${file}`);
  sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${conn.db}' AND pid <> pg_backend_pid()`);
}
sql(`DROP DATABASE IF EXISTS "${target}"`);
sql(`CREATE DATABASE "${target}"`);
const fd = openSync(file, 'r');
try {
  run(t, 'pg_restore', ['--no-owner', '--no-privileges', '-d', target], { input: fd });
} finally {
  closeSync(fd);
}
const count = run(t, 'psql', ['-d', target, '-tAc', 'SELECT (SELECT count(*) FROM "Sale") || \' bills, \' || (SELECT count(*) FROM "Customer") || \' customers\'']).trim();
console.log(`Restored into "${target}": ${count}`);
if (!replace) console.log(`Check it, then drop it with: DROP DATABASE "${target}";  (or run again with --replace-live-data)`);
