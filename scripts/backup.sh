#!/usr/bin/env bash
# Consistent backup: DB + retained files + secrets + owner CLI auth volumes.
# Usage: scripts/backup.sh [backup-root]   (default ./backups; keep it outside Git and protected)
# The worker is stopped during the backup so no run/scheduler writes happen; web stays read-only-safe.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="${1:-./backups}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$ROOT/$TS"
PROJECT="${COMPOSE_PROJECT_NAME:-yeeun}"
NODE_IMAGE="node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9"
FILES="${FILE_STORAGE_HOST_PATH:-./file}"
umask 077
mkdir -p "$DEST"
ABS_DEST="$(cd "$DEST" && pwd)"
ABS_FILES="$(cd "$FILES" && pwd)"

echo "[backup] stopping worker (no new claims/scheduler ticks)"
docker compose stop worker >/dev/null
trap 'echo "[backup] restarting worker"; docker compose start worker >/dev/null' EXIT

echo "[backup] database"
docker compose exec -T db pg_dump -U yeeun -d yeeun -Fc > "$DEST/db.dump"

echo "[backup] retained files"
tar -C "$ABS_FILES" -cf "$ABS_DEST/files.tar" .

echo "[backup] secrets"
mkdir -p "$DEST/secrets"
cp -p .secrets/* "$DEST/secrets/"

for v in cli-auth-claude cli-auth-codex; do
	echo "[backup] volume $v"
	MSYS_NO_PATHCONV=1 docker run --rm -v "${PROJECT}_${v}:/src:ro" -v "$ABS_DEST:/dst" "$NODE_IMAGE" \
		tar -C /src -czf "/dst/$v.tgz" .
done

echo "[backup] manifest"
(cd "$DEST" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
docker compose exec -T db psql -U yeeun -d yeeun -Atc \
	"select 'runs='||count(*) from runs union all select 'artifacts='||count(*) from artifacts union all select 'schedules='||count(*) from schedules union all select 'occurrences='||count(*) from schedule_occurrences" \
	> "$DEST/COUNTS"
echo "[backup] done: $DEST (contains secrets and auth tokens — store encrypted/offline)"
