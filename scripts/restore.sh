#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh into a Compose project (e.g. on a new Linux host).
# Usage: scripts/restore.sh <backup-dir> [project-name]
#   project-name defaults to "yeeun". Use a different name (e.g. yeeun-restore) plus
#   WEB_PORT/FILE_STORAGE_HOST_PATH to rehearse next to a running instance.
# Never run this against a project whose volumes you want to keep: it refuses non-empty DB volumes.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?backup dir required}"
PROJECT="${2:-yeeun}"
NODE_IMAGE="node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9"
FILES="${FILE_STORAGE_HOST_PATH:-./file}"
export COMPOSE_PROJECT_NAME="$PROJECT"

echo "[restore] verifying backup hashes"
(cd "$SRC" && sha256sum -c --quiet SHA256SUMS)
ABS_SRC="$(cd "$SRC" && pwd)"

if docker volume inspect "${PROJECT}_postgres-data" >/dev/null 2>&1; then
	echo "[restore] refusing: volume ${PROJECT}_postgres-data already exists" >&2
	exit 1
fi

echo "[restore] secrets -> .secrets (existing files are kept, differing files abort)"
mkdir -p .secrets
for f in "$SRC"/secrets/*; do
	n="$(basename "$f")"
	if [ -e ".secrets/$n" ] && ! cmp -s "$f" ".secrets/$n"; then
		echo "[restore] .secrets/$n differs from backup; resolve manually" >&2
		exit 1
	fi
	[ -e ".secrets/$n" ] || cp -p "$f" ".secrets/$n"
done
chmod 600 .secrets/* 2>/dev/null || true

echo "[restore] retained files -> $FILES"
mkdir -p "$FILES"
ABS_FILES="$(cd "$FILES" && pwd)"
if [ -n "$(ls -A "$ABS_FILES" | grep -v '^.gitkeep$' || true)" ]; then
	echo "[restore] refusing: $FILES is not empty" >&2
	exit 1
fi
tar -C "$ABS_FILES" -xf "$ABS_SRC/files.tar"

for v in cli-auth-claude cli-auth-codex; do
	echo "[restore] volume $v"
	docker volume create "${PROJECT}_${v}" >/dev/null
	MSYS_NO_PATHCONV=1 docker run --rm -v "${PROJECT}_${v}:/dst" -v "$ABS_SRC:/src:ro" "$NODE_IMAGE" \
		sh -c "tar -C /dst -xzf /src/$v.tgz && chown -R 1000:1000 /dst"
done

echo "[restore] database"
docker compose up -d --wait db
docker compose exec -T db pg_restore -U yeeun -d yeeun --no-owner --exit-on-error < "$SRC/db.dump"
docker compose exec -T db psql -U yeeun -d yeeun -Atc \
	"select 'runs='||count(*) from runs union all select 'artifacts='||count(*) from artifacts union all select 'schedules='||count(*) from schedules union all select 'occurrences='||count(*) from schedule_occurrences" \
	> /tmp/yeeun-restore-counts
if ! diff -q /tmp/yeeun-restore-counts "$SRC/COUNTS" >/dev/null; then
	echo "[restore] row counts differ from backup" >&2
	diff /tmp/yeeun-restore-counts "$SRC/COUNTS" >&2 || true
	exit 1
fi

echo "[restore] verifying retained file hashes recorded in the DB"
docker compose exec -T db psql -U yeeun -d yeeun -Atc \
	"select relative_path || ' ' || sha256 from artifacts union all select relative_path || ' ' || sha256 from retained_copies union all select relative_path || ' ' || sha256 from source_snapshots where status <> 'deleted'" |
	while read -r rel sum; do
		[ -n "$rel" ] || continue
		got="$(sha256sum "$ABS_FILES/$rel" | cut -d' ' -f1)"
		[ "$got" = "$sum" ] || { echo "[restore] hash mismatch: $rel" >&2; exit 1; }
	done

if [ -n "${RESTORE_NO_START:-}" ]; then echo "[restore] data restored; app not started (RESTORE_NO_START)"; exit 0; fi
echo "[restore] starting application"
docker compose up -d --build --wait
echo "[restore] done. The first scheduler tick coalesces missed occurrences into one catch-up run per task."
