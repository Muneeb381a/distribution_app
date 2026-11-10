import { BadRequestException, Controller, ForbiddenException, Get, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { currentTenant, MAIN_TENANT } from '../tenancy/tenant-context.js';

/** A backup is a dump of the whole database, every business included, so only the original business may use it. */
const isMain = () => (currentTenant()?.code ?? MAIN_TENANT) === MAIN_TENANT;

// apps/api/dist/backup/backup.module.js -> the repository root, where scripts/backup.mjs and backups/ live.
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FILE = /^[\w.-]+-\d{4}-\d{2}-\d{2}_\d{4}\.dump$/;

export interface BackupFile { name: string; bytes: number; at: string }

/**
 * Backups of the whole database, taken by the same script as `pnpm backup` (checked, pruned, optionally copied
 * to a USB or cloud folder). This service runs it on a schedule and on demand, and lists what exists.
 *
 * Automatic: a PC is often off at night, so instead of a fixed clock time it takes a backup whenever the last one is
 * older than BACKUP_EVERY_HOURS (default 24), checked shortly after start-up and then every 30 minutes.
 */
@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Backup');
  private timer?: NodeJS.Timeout;
  private running: Promise<{ ok: boolean; message: string; warning?: boolean }> | null = null;

  constructor(private audit: AuditService) {}

  /** Backups need pg_dump and a folder that stays; a serverless host has neither (Neon keeps its own history there). */
  private supported() { return isMain() && !process.env.VERCEL && existsSync(this.scriptPath()); }
  private dir() { return resolve(ROOT, process.env.BACKUP_DIR ?? 'backups'); }
  private everyHours() { return Number(process.env.BACKUP_EVERY_HOURS ?? 24); }
  private scriptPath() { return join(ROOT, 'scripts', 'backup.mjs'); }

  onModuleInit() {
    // Tests and one-off tools must not start dumping databases in the background.
    if (process.env.NODE_ENV === 'test' || process.env.VITEST || process.env.BACKUP_AUTO === 'off' || process.env.VERCEL) return;
    if (!existsSync(this.scriptPath())) { this.log.warn('scripts/backup.mjs was not found, automatic backups are off'); return; }
    setTimeout(() => void this.autoIfDue(), 45_000).unref();
    this.timer = setInterval(() => void this.autoIfDue(), 30 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  list(): BackupFile[] {
    if (!isMain()) return [];
    const d = this.dir();
    if (!existsSync(d)) return [];
    return readdirSync(d).filter((f) => FILE.test(f)).map((name) => {
      const st = statSync(join(d, name));
      return { name, bytes: st.size, at: st.mtime.toISOString() };
    }).sort((a, b) => b.at.localeCompare(a.at));
  }

  status() {
    const files = this.list();
    const last = files[0] ?? null;
    let detail: { tables?: number } = {};
    try { detail = JSON.parse(readFileSync(join(this.dir(), 'last-backup.json'), 'utf8')); } catch { /* none yet */ }
    const ageHours = last ? (Date.now() - new Date(last.at).getTime()) / 3_600_000 : null;
    return {
      last: last ? { ...last, tables: detail.tables ?? null } : null,
      ageHours,
      count: files.length,
      everyHours: this.everyHours(),
      supported: this.supported(),
      auto: this.supported() && process.env.BACKUP_AUTO !== 'off',
      copyDir: process.env.BACKUP_COPY_DIR ?? null,
      copyReachable: process.env.BACKUP_COPY_DIR ? existsSync(resolve(process.env.BACKUP_COPY_DIR)) : null,
      running: !!this.running,
    };
  }

  /** Runs the backup script once; a second request while one is running waits for that one. */
  run(): Promise<{ ok: boolean; message: string; warning?: boolean }> {
    if (!this.supported()) return Promise.resolve({ ok: false, message: !isMain() ? 'Your data is backed up by the software provider.' : 'Backups cannot be taken from this host. The database host keeps its own history; ask it for a restore point.' });
    if (this.running) return this.running;
    this.running = new Promise((done) => {
      execFile(process.execPath, [this.scriptPath()], { cwd: ROOT, env: process.env, timeout: 10 * 60_000, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
        const out = `${stdout ?? ''}${stderr ?? ''}`.trim().split('\n').filter(Boolean);
        const code = (err as (Error & { code?: number }) | null)?.code;
        if (!err) done({ ok: true, message: out.find((l) => l.startsWith('OK:')) ?? 'Backup saved' });
        // Exit code 2 = saved here, but the copy folder (USB / cloud) could not be reached.
        else if (code === 2) done({ ok: true, warning: true, message: out.find((l) => l.startsWith('WARNING')) ?? 'Saved, but the copy folder is not reachable' });
        else done({ ok: false, message: out.slice(-2).join(' ') || err.message });
      });
    }).finally(() => { this.running = null; }) as Promise<{ ok: boolean; message: string; warning?: boolean }>;
    return this.running;
  }

  private async autoIfDue() {
    try {
      const s = this.status();
      if (s.running || (s.ageHours !== null && s.ageHours < this.everyHours())) return;
      const r = await this.run();
      if (r.ok) this.log.log(`Automatic backup: ${r.message}`); else this.log.error(`Automatic backup failed: ${r.message}`);
      await this.audit.log(null, 'BACKUP_AUTO', 'Backup', undefined, undefined, { ok: r.ok, message: r.message }).catch(() => {});
    } catch (e) {
      this.log.error(`Automatic backup failed: ${(e as Error).message}`);
    }
  }

  filePath(name: string) {
    if (!isMain()) throw new ForbiddenException('Backups are kept by the software provider');
    if (!FILE.test(name)) throw new BadRequestException('That is not a backup file name');
    const p = join(this.dir(), name);
    if (!existsSync(p)) throw new NotFoundException('That backup no longer exists');
    return p;
  }
}

@Controller('backups')
class BackupController {
  constructor(private svc: BackupService, private audit: AuditService) {}

  /** A backup holds every business's data, so it is the platform owner's alone. */
  private ownerOnly(u: AuthUser) { return u.roleName === 'Owner'; }

  @Get('status') @RequirePermissions('SETTINGS_EDIT')
  status(@CurrentUser() u: AuthUser) { return this.ownerOnly(u) ? this.svc.status() : { ...this.svc.status(), supported: false, auto: false, last: null, count: 0 }; }

  @Get() @RequirePermissions('SETTINGS_EDIT')
  list(@CurrentUser() u: AuthUser) { return this.ownerOnly(u) ? { status: this.svc.status(), files: this.svc.list() } : { status: { ...this.svc.status(), supported: false, auto: false, last: null, count: 0 }, files: [] }; }

  @Post() @RequirePermissions('SETTINGS_EDIT')
  async backupNow(@CurrentUser() u: AuthUser) {
    if (!this.ownerOnly(u)) throw new ForbiddenException('Only the owner can take a backup');
    const r = await this.svc.run();
    await this.audit.log(u.id, 'BACKUP', 'Backup', undefined, undefined, { ok: r.ok, message: r.message });
    if (!r.ok) throw new BadRequestException(`The backup failed: ${r.message}`);
    return { ...r, status: this.svc.status(), files: this.svc.list() };
  }

  @Get(':name/download') @RequirePermissions('SETTINGS_EDIT')
  async download(@Param('name') name: string, @Res({ passthrough: true }) res: Response, @CurrentUser() u: AuthUser) {
    if (!this.ownerOnly(u)) throw new ForbiddenException('Only the owner can download a backup');
    const p = this.svc.filePath(name);
    await this.audit.log(u.id, 'BACKUP_DOWNLOAD', 'Backup', undefined, undefined, { name });
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"` });
    return new StreamableFile(createReadStream(p));
  }
}

@Module({ controllers: [BackupController], providers: [BackupService], exports: [BackupService] })
export class BackupModule {}
