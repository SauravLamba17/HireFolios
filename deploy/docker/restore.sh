#!/usr/bin/env sh
# Hirefolios restore (Linux / macOS host). Replaces ALL current data with a backup folder.
#   deploy/restore.sh /var/backups/hirefolios/2026-11-11_1815 [BACKUP_DIR]
# Set CONFIRM=RESTORE to skip the prompt. A backup of the current state is taken first.
set -eu
FROM=${1:?Usage: deploy/restore.sh <backup folder> [BACKUP_DIR]}
BACKUP_DIR=${2:-/var/backups/hirefolios}
ROOT=$(cd "$(dirname "$0")" && pwd)
ENV_FILE="$ROOT/.env.production"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }
cd "$ROOT"
setting() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | head -n1 | tr -d '"\r'; }
compose() { docker compose --env-file "$ENV_FILE" "$@"; }

[ -f "$FROM/database.dump" ] && [ -f "$FROM/uploads.tar.gz" ] || { echo "$FROM must contain database.dump and uploads.tar.gz" >&2; exit 1; }
UPLOADS=$(setting UPLOAD_HOST_DIR)
UPLOADS=${UPLOADS%/}
[ -n "$UPLOADS" ] || { echo "UPLOAD_HOST_DIR is not set" >&2; exit 1; }

echo "This REPLACES all current candidates, staff accounts, settings and files"
echo "with the backup in $FROM. Anything entered after that backup was made will be lost."
ANSWER=${CONFIRM:-}
[ -n "$ANSWER" ] || { printf "Type RESTORE (capitals) to continue: "; read -r ANSWER; }
[ "$ANSWER" = "RESTORE" ] || { echo "Cancelled. Nothing was changed."; exit 1; }

echo "Backing up the current state first..."
"$ROOT/deploy/backup.sh" "$BACKUP_DIR" 36500 # no pruning: it could remove the backup being restored

ASIDE="$UPLOADS.before-restore-$(date +%Y-%m-%d_%H%M%S)"
compose stop app
rollback() {
  echo "Restore failed." >&2
  if [ -d "$ASIDE" ]; then rm -rf "$UPLOADS"; mv "$ASIDE" "$UPLOADS"; echo "The uploads folder was put back as it was." >&2; fi
  compose start app
}
trap rollback EXIT
[ -d "$UPLOADS" ] && mv "$UPLOADS" "$ASIDE"
mkdir -p "$UPLOADS"
tar -xzf "$FROM/uploads.tar.gz" -C "$UPLOADS"
compose cp "$FROM/database.dump" db:/tmp/restore.dump
# One transaction: if anything fails, the database stays as it was.
compose exec -T db sh -c 'pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists --no-owner --single-transaction /tmp/restore.dump'
compose exec -T db rm -f /tmp/restore.dump
trap - EXIT
compose start app
echo "Restored from $FROM."
[ -d "$ASIDE" ] && echo "The previous uploads are kept in $ASIDE. Delete it once you have checked the restore."
exit 0
