#!/bin/sh
# Creates local secrets that do not exist yet. Never overwrites existing values.
# Optional operator secrets are created empty (= not configured) so Compose can start.
set -eu
cd "$(dirname "$0")/.."
umask 077
mkdir -p .secrets
gen() { [ -s ".secrets/$1" ] || openssl rand -hex 32 > ".secrets/$1"; }
empty() { [ -e ".secrets/$1" ] || : > ".secrets/$1"; }
gen postgres_password
gen app_master_key
gen session_secret
gen runner_token
for f in google_client_secret google_picker_api_key smtp_password vapid_private_key ngrok_authtoken; do empty "$f"; done
echo "secrets ready in .secrets/ (back up app_master_key and session_secret)"
