#!/usr/bin/env bash
# Guard: Log-Hygiene (docs/logging.md). Verhindert, dass die Schreiblast
# zurückkommt, die im Altprojekt die Platte gefüllt hat.
#   1. Jeder Dienst im Root-Compose und im Supabase-Override trägt den Anker
#   2. max-size <= 10m, max-file <= 3
#   3. compute-Dockerfile: uvicorn mit --no-access-log
#   4. Caddyfile: log-Block mit level ERROR
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

failures=()

check_services() {
  local file="$1"
  local services
  services=$(awk '
    /^services:/ { in_s=1; next }
    in_s && /^[^ ]/ { in_s=0 }
    in_s && /^  [a-zA-Z0-9_-]+:/ { sub(/:.*/, ""); sub(/^  /, ""); print }
  ' "$file")
  for svc in $services; do
    local block
    block=$(awk -v svc="$svc" '
      $0 ~ "^  " svc ":" { in_b=1; next }
      in_b && /^  [a-zA-Z0-9_-]+:/ { in_b=0 }
      in_b { print }
    ' "$file")
    grep -qE '^[[:space:]]+logging: \*default-logging' <<<"$block" \
      || failures+=("$file: Dienst '$svc' ohne 'logging: *default-logging'")
  done
  local ms mf
  ms=$(grep -E '^[[:space:]]+max-size:' "$file" | head -1 | grep -oE '[0-9]+' || true)
  mf=$(grep -E '^[[:space:]]+max-file:' "$file" | head -1 | grep -oE '[0-9]+' || true)
  { [ -n "$ms" ] && [ "$ms" -le 10 ]; } || failures+=("$file: max-size muss <= 10m sein (ist '${ms:-unset}')")
  { [ -n "$mf" ] && [ "$mf" -le 3 ]; } || failures+=("$file: max-file muss <= 3 sein (ist '${mf:-unset}')")
}

check_services docker-compose.yml
check_services infra/supabase/docker-compose.override.yml

# Jeder Upstream-Dienst muss im Override vorkommen (sonst läuft er ohne Anker).
if [ -f infra/supabase/upstream/docker-compose.yml ]; then
  for svc in $(awk '/^services:/{s=1;next} s&&/^[^ ]/{s=0} s&&/^  [a-zA-Z0-9_-]+:/{sub(/:.*/,"");sub(/^  /,"");print}' infra/supabase/upstream/docker-compose.yml); do
    grep -qE "^  ${svc}:" infra/supabase/docker-compose.override.yml \
      || failures+=("infra/supabase/docker-compose.override.yml: Upstream-Dienst '$svc' fehlt (kein Logging-Anker)")
  done
fi

grep -qE '"--no-access-log"' services/compute/Dockerfile || failures+=("services/compute/Dockerfile: CMD ohne --no-access-log")
awk '/^[[:space:]]*log \{/,/^[[:space:]]*\}/' infra/caddy/Caddyfile | grep -qE '^[[:space:]]*level ERROR' \
  || failures+=("infra/caddy/Caddyfile: log-Block ohne 'level ERROR'")

if [ "${#failures[@]}" -gt 0 ]; then
  echo "FAIL: Log-Hygiene"
  printf '  - %s\n' "${failures[@]}"
  exit 1
fi
echo "PASS: Log-Hygiene"
