# Backups

The database holds every bill, khata and stock movement. Back it up **every day** and keep a copy
**off the shop PC** (USB drive, or a Google Drive / OneDrive folder). A backup you have never
restored is a guess — test a restore once a month (step 3).

## 1. Take a backup

From the project folder:

```bash
pnpm backup
```

This writes `backups/distribution-YYYY-MM-DD_HHMM.dump`, then reads the file back to make sure it is
complete (it prints the number of tables). It keeps the last **14 days** plus **one backup per month
for 12 months** and deletes older ones.

It works whether PostgreSQL runs in Docker (`docker compose up -d`) or is installed directly; set
`BACKUP_MODE=docker` or `BACKUP_MODE=local` to choose.

| Setting | Default | What it does |
|---|---|---|
| `BACKUP_DIR` | `backups` | Where backups are written |
| `BACKUP_COPY_DIR` | — | Also copy each backup here (USB drive, Google Drive / OneDrive folder) |
| `BACKUP_KEEP_DAYS` | `14` | Daily backups to keep |
| `BACKUP_KEEP_MONTHS` | `12` | Monthly backups to keep |
| `DATABASE_URL` | from `apps/api/.env` | Which database to back up |

If `BACKUP_COPY_DIR` is set but missing (USB unplugged), the local backup is still made, a warning is
printed and the script ends with exit code 2 so a scheduled task shows it as failed.

## 2. Run it every day by itself

**Windows (Task Scheduler)** — the usual shop PC:

1. Open *Task Scheduler* → *Create Basic Task…* → name it "Distribution backup".
2. Trigger: *Daily*, at a time the PC is on (e.g. 9:00 PM after closing).
3. Action: *Start a program*
   - Program: `cmd`
   - Arguments: `/c set BACKUP_COPY_DIR=G:\My Drive\Distribution backups&& pnpm backup >> backups\backup.log 2>&1`
   - Start in: the project folder, e.g. `C:\distribution_app`
4. Tick *Open the Properties dialog*, then on *General* choose *Run whether user is logged on or not*.

**Linux / macOS (cron)** — `crontab -e`:

```bash
0 21 * * * cd /opt/distribution_app && BACKUP_COPY_DIR=/mnt/usb/backups pnpm backup >> backups/backup.log 2>&1
```

`backups/last-backup.json` always says when the last good backup was made.

## 3. Restore

**Check a backup (safe, nothing live changes):**

```bash
pnpm restore backups/distribution-2026-11-04_2100.dump
```

It is restored into a new database `distribution_restore_YYYYMMDD` and prints how many bills and
customers it has. Look at it (point a copy of the API at it if you want), then drop it:
`DROP DATABASE "distribution_restore_YYYYMMDD";`

**Replace the live data (after a disk failure, a wrong import…):**

1. Stop the API.
2. Run:

   ```bash
   pnpm restore backups/distribution-2026-11-04_2100.dump --replace-live-data
   ```

3. Start the API again. Anything entered after that backup was taken is gone — re-enter it from the
   paper bills / thermal slips.

Offline bills still waiting in a PC's outbox are not in any backup until they sync; let every PC sync
before restoring.
