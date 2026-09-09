#!/usr/bin/env bash
# Guard: der service_role-Key darf nie ins Browser-Bundle.
# Prüft Quellcode (kein SERVICE_ROLE in Client-Code / NEXT_PUBLIC_*) und, falls
# gebaut, die statischen Chunks in apps/web/.next/static.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
failures=()

if grep -rnE 'NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE|NEXT_PUBLIC_[A-Z_]*SECRET' apps/web/src .env.example docker-compose.yml 2>/dev/null; then
  failures+=("SERVICE_ROLE/SECRET als NEXT_PUBLIC_* gefunden")
fi
if [ -d apps/web/.next/static ] && grep -rlE 'SERVICE_ROLE_KEY|service_role' apps/web/.next/static >/dev/null 2>&1; then
  failures+=("service_role im Browser-Bundle apps/web/.next/static gefunden")
fi

if [ "${#failures[@]}" -gt 0 ]; then
  echo "FAIL: service_role-Guard"; printf '  - %s\n' "${failures[@]}"; exit 1
fi
echo "PASS: service_role-Guard"
