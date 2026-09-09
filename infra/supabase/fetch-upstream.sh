#!/usr/bin/env bash
# Holt das offizielle Supabase-Docker-Verzeichnis gepinnt auf einen Tag nach ./upstream/.
# Nicht eingecheckt (.gitignore). Usage: bash fetch-upstream.sh <git-tag>
set -euo pipefail

TAG="${1:?Usage: fetch-upstream.sh <git-tag>  (z. B. ein Release-Tag von supabase/supabase)}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${HERE}/upstream"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

git clone --depth 1 --branch "${TAG}" --filter=blob:none --sparse \
  https://github.com/supabase/supabase.git "${WORK}/supabase"
git -C "${WORK}/supabase" sparse-checkout set docker

rm -rf "${DEST}"
cp -R "${WORK}/supabase/docker" "${DEST}"
echo "${TAG}" > "${DEST}/UPSTREAM_TAG"
echo "Supabase docker/ (${TAG}) liegt unter ${DEST}"
