#!/usr/bin/env bash
# Brings the server up to date with the latest code. Run it from anywhere:
#   bash deploy/update.sh caddy      (or: tunnel)
set -euo pipefail
cd "$(dirname "$0")/.."
PROFILE="${1:-caddy}"
COMPOSE=(docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env --profile "$PROFILE")

echo "1/4 Taking a backup before changing anything..."
"${COMPOSE[@]}" exec -T api node /app/scripts/backup.mjs || echo "(no running API to back up, continuing)"
echo "2/4 Getting the latest code..."
git pull --ff-only
echo "3/4 Building and restarting..."
"${COMPOSE[@]}" up -d --build
echo "4/4 Cleaning old images..."
docker image prune -f >/dev/null
"${COMPOSE[@]}" ps
