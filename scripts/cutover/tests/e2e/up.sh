#!/usr/bin/env bash
# Baut die Testumgebung auf und wartet, bis das Altprojekt im Host läuft.
# Wiederholbar: ein zweiter Aufruf baut nichts neu ein, was schon steht.
#
# Umgebungsvariablen:
#   LUMEAPPS_DIR     lokales lumeapps-Repo    (Standard: ~/Documents/lumeapps)
#   ACM_SIGNAGE_DIR  lokales acm-signage-Repo (Standard: ~/Documents/acm-signage)
set -euo pipefail

cd "$(dirname "$0")"
E2E=$(pwd)
LUMEAPPS_DIR=${LUMEAPPS_DIR:-$HOME/Documents/lumeapps}
ACM_SIGNAGE_DIR=${ACM_SIGNAGE_DIR:-$HOME/Documents/acm-signage}
OLD_COMMIT=ffc9ba0
PROJECT=cutover-e2e
C=(docker compose -p "$PROJECT" -f "$E2E/docker-compose.yml")
KEY="$E2E/.ssh/id_ed25519"
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5)

log() { printf '[up %4ss] %s\n' "$SECONDS" "$*"; }
die() { printf '[up] FEHLER: %s\n' "$*" >&2; exit 1; }

wait_for() { # <sekunden> <beschreibung> <befehl...>
  local limit=$1 what=$2; shift 2
  local start=$SECONDS
  until "$@" >/dev/null 2>&1; do
    (( SECONDS - start < limit )) || die "$what nach ${limit}s nicht erreicht"
    sleep 5
  done
}

# --- 1. SSH-Schlüssel ---------------------------------------------------------
mkdir -p .ssh .work/seed .work/pi-units
chmod 700 .ssh
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C cutover-e2e -f "$KEY"

# --- 2. Saatgut für den Host --------------------------------------------------
if [ ! -f .work/seed/lumeapps-src.tar ]; then
  log "git archive $OLD_COMMIT aus $LUMEAPPS_DIR"
  git -C "$LUMEAPPS_DIR" archive --format=tar -o "$E2E/.work/seed/lumeapps-src.tar" "$OLD_COMMIT"
fi

if [ ! -d .work/seed/player ]; then
  # Das Bundle ist nicht im Repo (dist/ ist ignoriert). Bauen braucht ~6 GB
  # Heap, deshalb das lokal vorhandene Bundle übernehmen.
  [ -f "$LUMEAPPS_DIR/frontend/dist/player/index.html" ] \
    || die "$LUMEAPPS_DIR/frontend/dist/player fehlt — dort einmal 'npm run build:player' laufen lassen"
  log "Player-Bundle aus $LUMEAPPS_DIR/frontend/dist/player"
  cp -R "$LUMEAPPS_DIR/frontend/dist/player" .work/seed/player.partial
  mv .work/seed/player.partial .work/seed/player
fi

# Die Datenbank ist mit dem FERNET_KEY der lokalen lumeapps-.env verschlüsselt
# (SNMP-Communities). Ohne denselben Schlüssel lehnt die Übernahme sie ab.
( umask 077; sed -n 's/^FERNET_KEY=//p' "$LUMEAPPS_DIR/.env" | head -1 > .work/seed/fernet_key )

if [ ! -f .work/seed/kpi.dump ]; then
  src="$LUMEAPPS_DIR/postgres_data"
  [ -f "$src/PG_VERSION" ] || die "$src fehlt — ohne Entwicklungsdatenbank kein Bestand"
  if docker ps -q | xargs -r docker inspect --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' | grep -qx "$src"; then
    die "$src wird gerade von einem laufenden Container benutzt — lumeapps lokal erst stoppen"
  fi
  pg_user=$(sed -n 's/^POSTGRES_USER=//p' "$LUMEAPPS_DIR/.env")
  pg_db=$(sed -n 's/^POSTGRES_DB=//p' "$LUMEAPPS_DIR/.env")
  log "Dump der Entwicklungsdatenbank ($pg_db) aus einer Kopie von $src"
  rm -rf .work/pgcopy
  cp -R "$src" .work/pgcopy
  docker rm -f "$PROJECT-dump" >/dev/null 2>&1 || true
  docker run -d --name "$PROJECT-dump" -v "$E2E/.work/pgcopy:/var/lib/postgresql/data" postgres:17-alpine >/dev/null
  wait_for 60 "Dump-Postgres" docker exec "$PROJECT-dump" pg_isready -U "$pg_user" -d "$pg_db"
  sleep 2
  docker exec "$PROJECT-dump" pg_dump -U "$pg_user" -d "$pg_db" -Fc --no-owner --no-privileges \
    > .work/seed/kpi.dump.partial
  docker rm -f "$PROJECT-dump" >/dev/null
  rm -rf .work/pgcopy
  mv .work/seed/kpi.dump.partial .work/seed/kpi.dump
fi

# --- 3. Units für den Pi, wie deploy_systemd_units sie schreibt ----------------
for unit in signage-sidecar.service signage-player.service; do
  sed -e "s|__SIGNAGE_API_URL__|http://host:80|g" -e "s|__SIGNAGE_UID__|1001|g" \
    "$ACM_SIGNAGE_DIR/scripts/systemd/$unit" > ".work/pi-units/$unit"
done

# --- 4. Container --------------------------------------------------------------
log "docker compose up (host, pi)"
"${C[@]}" up -d --build

wait_for 120 "SSH am Host" ssh -p 2222 "${SSH_OPTS[@]}" acm@127.0.0.1 true
wait_for 120 "Docker im Host" ssh -p 2222 "${SSH_OPTS[@]}" acm@127.0.0.1 docker info
wait_for 60 "SSH am Pi" ssh -p 2223 "${SSH_OPTS[@]}" signage@127.0.0.1 true

# --- 5. Altprojekt im Host einrichten ------------------------------------------
log "Altprojekt einrichten (beim ersten Mal: Images ziehen und bauen, ~5–20 min)"
"${C[@]}" exec -T -u acm -w /home/acm host seed-lumeapps

# --- 6. Warten, bis es antwortet ------------------------------------------------
http_ok() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1")" = 200 ]; }
all_healthy() {
  ssh -p 2222 "${SSH_OPTS[@]}" acm@127.0.0.1 \
    'cd ~/lumeapps && docker compose ps --format "{{.Service}} {{.State}} {{.Health}}"' \
    | awk '$2 != "running" || ($3 != "" && $3 != "healthy") { bad = 1 } END { exit bad }'
}
log "warte auf Caddy :80 → frontend (Vite installiert beim ersten Start node_modules)"
wait_for 1800 "http://127.0.0.1:18080/" http_ok http://127.0.0.1:18080/
wait_for 300 "http://127.0.0.1:18080/player/" http_ok http://127.0.0.1:18080/player/
wait_for 300 "alle Dienste healthy" all_healthy

ssh -p 2222 "${SSH_OPTS[@]}" acm@127.0.0.1 'cd ~/lumeapps && docker compose ps --format "table {{.Name}}\t{{.Status}}"'

log "fertig"
cat <<EOF

Konfiguration für das Umschalt-Skript:

HOST=acm@127.0.0.1
HOST_SSH_OPTS="-p 2222 -i $KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
HOST_IP=host        # Adresse, unter der Pis den Host erreichen
PIS="signage@127.0.0.1"
PI_SSH_OPTS="-p 2223 -i $KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

Vom Mac aus: Host :80 → http://127.0.0.1:18080, :8081 → 18081, :8080 → 18082
EOF
