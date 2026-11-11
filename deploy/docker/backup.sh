#!/usr/bin/env sh
# Hirefolios backup (Linux / macOS host): database dump + uploads archive into BACKUP_DIR/<date_time>.
#   deploy/backup.sh [BACKUP_DIR] [KEEP_DAYS] [OFFSITE_DIR]
# cron, 6:15 pm Mon-Sat:  15 18 * * 1-6  /opt/hirefolios/deploy/backup.sh >> /var/log/hirefolios-backup.log 2>&1
set -eu
BACKUP_DIR=${1:-/var/backups/hirefolios}
KEEP_DAYS=${2:-14}
OFFSITE_DIR=${3:-}
ROOT=$(cd "$(dirname "$0")" && pwd)
ENV_FILE="$ROOT/.env.production"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }
cd "$ROOT"

setting() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | head -n1 | tr -d '"\r'; }
compose() { docker compose --env-file "$ENV_FILE" "$@"; }
prune() { # only folders this script made (YYYY-MM-DD_HHMM)
  find "$1" -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]_[0-9][0-9][0-9][0-9]' -mtime "+$KEEP_DAYS" -exec rm -rf {} +
}

UPLOADS=$(setting UPLOAD_HOST_DIR)
[ -d "$UPLOADS" ] || { echo "UPLOAD_HOST_DIR '$UPLOADS' not found" >&2; exit 1; }
STAMP=$(date +%Y-%m-%d_%H%M)
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"
LOG="$BACKUP_DIR/backup.log"
trap 'echo "$STAMP FAILED" >> "$LOG"' EXIT

compose exec -T db sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -f /tmp/hirefolios.dump'
compose cp db:/tmp/hirefolios.dump "$DEST/database.dump"
compose exec -T db rm -f /tmp/hirefolios.dump
tar -czf "$DEST/uploads.tar.gz" -C "$UPLOADS" --exclude=./.last-backup .
[ "$(wc -c < "$DEST/database.dump")" -ge 1024 ] || { echo "database.dump is too small" >&2; exit 1; }

if [ -n "$OFFSITE_DIR" ]; then
  mkdir -p "$OFFSITE_DIR"
  cp -r "$DEST" "$OFFSITE_DIR/$STAMP"
  prune "$OFFSITE_DIR"
fi
prune "$BACKUP_DIR"
date -u +%Y-%m-%dT%H:%M:%SZ > "$UPLOADS/.last-backup"
trap - EXIT
echo "$STAMP OK $(du -sh "$DEST" | cut -f1)" >> "$LOG"
echo "Backup saved: $DEST"
