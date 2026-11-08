#!/usr/bin/env bash
# Copies the backups to another place (Google Drive, OneDrive, Dropbox...) with rclone, so they survive the server.
# One-time setup: see "Backup ki dusri copy" in deploy/DEPLOY.md. Then add it to cron, for example every night at 2:30:
#   30 2 * * *  /home/ubuntu/distribution_app/deploy/offsite-backup.sh >> /var/log/dist-offsite.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE="${RCLONE_REMOTE:-gdrive:distribution-backups}"
DIR="${BACKUP_HOST_DIR:-backups}"
# Only new files are copied and nothing on the remote is deleted, so an empty folder here can never wipe the copies.
rclone copy "$DIR" "$REMOTE" --include "*.dump" --include "last-backup.json" --max-age 3d --verbose
echo "$(date -Is) copied $DIR to $REMOTE"
