#!/usr/bin/env bash
# Baut die Testumgebung vollständig ab, samt Volumes (innerer Docker, /home/acm).
# Fasst nur das Compose-Projekt `cutover-e2e` an. Schlüssel und Saatgut unter
# .ssh/ und .work/ und die gebauten Images bleiben liegen; `--all` löscht auch die.
set -euo pipefail

cd "$(dirname "$0")"
docker compose -p cutover-e2e -f docker-compose.yml down -v --remove-orphans
docker rm -f cutover-e2e-dump >/dev/null 2>&1 || true

if [ "${1:-}" = --all ]; then
  docker image rm cutover-e2e-host cutover-e2e-pi 2>/dev/null || true
  rm -rf .ssh .work
fi
