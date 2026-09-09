#!/usr/bin/env bash
# Erzeugt .env aus .env.example und füllt alle Secrets über den Supabase-Generator.
# Idempotent: bricht ab, wenn .env schon existiert (nie Secrets überschreiben).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

[ -f .env ] && { echo ".env existiert bereits — nichts geändert." >&2; exit 1; }
[ -d infra/supabase/upstream ] || { echo "Upstream fehlt: bash infra/supabase/fetch-upstream.sh <tag>" >&2; exit 1; }

cp .env.example .env
# generate-keys.sh schreibt per sed in ./.env des aktuellen Verzeichnisses.
sh infra/supabase/upstream/utils/generate-keys.sh --update-env >/dev/null
rm -f .env.old
chmod 600 .env
echo ".env angelegt (Secrets generiert). SITE_URL/SUPABASE_PUBLIC_URL/API_EXTERNAL_URL bei Bedarf anpassen."
