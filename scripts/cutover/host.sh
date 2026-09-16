# Funktionen, die auf dem Host laufen. cutover.sh schickt diese Datei samt
# Aufruf per ssh an `bash -s`; die Unit-Tests laden sie direkt.
#
# Regeln:
# - Nur Bash 3.2 und POSIX-Werkzeuge, kein `sed -i` (GNU/BSD verschieden).
# - Secrets werden gelesen und weitergereicht, nie ausgegeben.
# - Jede Funktion lässt sich wiederholen.
#
# Erwartete Variablen: BASIS, HOST_IP, PLATTFORM_PORT, SIGNAGE_PORT.

# certs/ zieht nicht mit: im alten Baum liegt dort nur das kompromittierte
# mkcert-Material (nirgends eingebunden), im neuen Stand ist certs/ eingecheckt.
DATENVERZEICHNISSE="postgres_data directus_database directus_extensions directus_uploads caddy_data caddy_config backups frontend_node_modules"
C_PROD="docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.prod.yml"

sag() { printf '  %s\n' "$*"; }
gut() { printf '  ✓ %s\n' "$*"; }
schlecht() { printf '  ✗ %s\n' "$*" >&2; }
abbruch() { printf 'FEHLER: %s\n' "$*" >&2; return 1; }

# --- .env ---------------------------------------------------------------------

env_lesen() {  # datei schluessel → letzter Wert, leer wenn nicht da
  [ -f "$1" ] || return 0
  K="$2" awk 'index($0, ENVIRON["K"] "=") == 1 { v = substr($0, length(ENVIRON["K"]) + 2) } END { print v }' "$1"
}

env_setzen() {  # datei schluessel wert — Rechte und Inode bleiben
  local tmp; tmp="$(mktemp)"
  K="$2" V="$3" awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    index($0, k "=") == 1 { if (!d) { print k "=" v; d = 1 }; next }
    { print }
    END { if (!d) print k "=" v }' "$1" > "${tmp}"
  cat "${tmp}" > "$1"; rm -f "${tmp}"
}

zufall_url() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'; }
zufall_fernet() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n'; }

# Erledigte Schritte merkt sich der Host, nicht der Mac: wer den Lauf von einem
# anderen Rechner fortsetzt, sieht denselben Stand.
h_marke_setzen() { mkdir -p "${BASIS}/.cutover" && printf '%s %s\n' "${2:-erledigt}" "$(date '+%F %T')" > "${BASIS}/.cutover/$1"; }
h_marke_lesen() { [ -f "${BASIS}/.cutover/$1" ] && cut -d' ' -f1 "${BASIS}/.cutover/$1"; }
h_marken() { [ -d "${BASIS}/.cutover" ] && (cd "${BASIS}/.cutover" && grep -H . * 2>/dev/null | sed 's/:/  /'); true; }
h_existiert() { [ -e "${BASIS}/$1" ]; }
h_lesen() { cat "${BASIS}/$1"; }

h_konfig() {
  echo "BASIS=${BASIS}"; echo "HOST_IP=${HOST_IP}"
  echo "PLATTFORM_PORT=${PLATTFORM_PORT}"; echo "SIGNAGE_PORT=${SIGNAGE_PORT}"
}

# --- Altprojekt ---------------------------------------------------------------

alt_verzeichnis() {  # dort, wo die Daten liegen
  if [ -d "${BASIS}/lumeapps-neu/postgres_data" ]; then echo "${BASIS}/lumeapps-neu"; else echo "${BASIS}/lumeapps"; fi
}

alt_compose() {  # compose im aktiven Altprojekt, mit den richtigen Dateien
  local d; d="$(alt_verzeichnis)"
  if [ "${d}" = "${BASIS}/lumeapps-neu" ]; then (cd "${d}" && ${C_PROD} "$@"); else (cd "${d}" && docker compose "$@"); fi
}

alt_db_container() {
  docker ps --filter label=com.docker.compose.project=lumeapps \
    --filter label=com.docker.compose.service=db --format '{{.Names}}' | head -1
}

alt_quelle() {  # DSN der alten Datenbank, aus deren .env
  local e u p d c
  e="$(alt_verzeichnis)/.env"
  u="$(env_lesen "$e" POSTGRES_USER)"; p="$(env_lesen "$e" POSTGRES_PASSWORD)"; d="$(env_lesen "$e" POSTGRES_DB)"
  c="$(alt_db_container)"
  [ -n "$u" ] && [ -n "$p" ] && [ -n "$d" ] || { abbruch "POSTGRES_* fehlen in $e"; return 1; }
  [ -n "$c" ] || { abbruch "Datenbank-Container des Altprojekts läuft nicht (Projekt lumeapps)"; return 1; }
  p="$(P="$p" python3 -c 'import os, urllib.parse; print(urllib.parse.quote(os.environ["P"], safe=""))')"
  echo "postgresql://${u}:${p}@${c}:5432/${d}"
}

# Hängt einen Container für die Dauer eines Befehls ins Netz des Altprojekts.
mit_altnetz() {  # container befehl...
  local c="$1"; shift
  docker network inspect lumeapps_default >/dev/null 2>&1 || { abbruch "Netz lumeapps_default fehlt — Projektname des Altprojekts prüfen"; return 1; }
  docker network connect lumeapps_default "$c" 2>/dev/null || true
  local rc=0
  "$@" || rc=$?
  docker network disconnect lumeapps_default "$c" >/dev/null 2>&1 || true
  return $rc
}

# --- Stack-Zustand ------------------------------------------------------------

warte_auf_stack() {  # verzeichnis sekunden
  local d="$1" frist=$(( $(date +%s) + $2 )) zeilen offen kaputt
  while :; do
    zeilen="$(cd "$d" && docker compose ps -a --format '{{.Service}} {{.State}} {{.Health}} {{.ExitCode}}')"
    kaputt="$(printf '%s\n' "$zeilen" | awk '($2=="exited" && $NF!="0") || $3=="unhealthy" {print $1}')"
    offen="$(printf '%s\n' "$zeilen" | awk '$3=="starting" || $2=="created" || $2=="restarting" {print $1}')"
    if [ -z "$offen" ] && [ -z "$kaputt" ] && [ -n "$zeilen" ]; then gut "alle Dienste bereit ($d)"; return 0; fi
    if [ "$(date +%s)" -ge "$frist" ]; then
      [ -n "$kaputt" ] && schlecht "fehlerhaft: $(echo $kaputt)"
      [ -n "$offen" ] && schlecht "nicht bereit: $(echo $offen)"
      return 1
    fi
    sleep 5
  done
}

# --- vorab (nur lesen) --------------------------------------------------------

h_vorab() {
  local rc=0
  sag "Rechner: $(uname -m), $(nproc 2>/dev/null || echo ?) CPUs"
  sag "Speicher frei: $(awk '/MemAvailable/ {printf "%.1f GB", $2/1048576}' /proc/meminfo 2>/dev/null || echo ?)"
  sag "Platte frei unter ${BASIS}: $(df -h "${BASIS}" | awk 'NR==2 {print $4}')"
  docker info >/dev/null 2>&1 && gut "Docker ohne root" || { schlecht "docker nicht nutzbar"; rc=1; }
  docker compose version >/dev/null 2>&1 && gut "docker compose v2" || { schlecht "docker compose fehlt"; rc=1; }
  for w in tar curl python3 openssl awk; do command -v "$w" >/dev/null || { schlecht "$w fehlt"; rc=1; }; done
  local a; a="$(alt_verzeichnis)"
  sag "Altprojekt aktiv in: $a"
  [ -f "$a/.env" ] && gut ".env da" || { schlecht "$a/.env fehlt"; rc=1; }
  [ -f "$a/docker-compose.override.yml" ] && gut "Override da" || { schlecht "$a/docker-compose.override.yml fehlt"; rc=1; }
  [ -n "$(alt_db_container)" ] && gut "alte Datenbank läuft: $(alt_db_container)" || { schlecht "alte Datenbank läuft nicht"; rc=1; }
  docker network inspect lumeapps_default >/dev/null 2>&1 && gut "Netz lumeapps_default" || { schlecht "Netz lumeapps_default fehlt"; rc=1; }
  for d in acm-plattform acm-signage lumeapps-neu; do [ -e "${BASIS}/$d" ] && sag "vorhanden: ${BASIS}/$d"; done
  sag "belegte Ports: $(docker ps --format '{{.Ports}}' | tr ',' '\n' | sed -n 's/.*:\([0-9]*\)->.*/\1/p' | sort -un | tr '\n' ' ')"
  return $rc
}

# --- 0: Sicherung -------------------------------------------------------------

h_sicherung() {
  local a neu; a="$(alt_verzeichnis)"
  alt_compose exec -T backup /usr/local/bin/dump.sh
  neu="$(ls -t "$a/backups" 2>/dev/null | grep -v '\.tmp$' | head -1)"
  [ -n "$neu" ] && [ -s "$a/backups/$neu" ] || { abbruch "kein Abzug in $a/backups"; return 1; }
  [ -n "$(find "$a/backups/$neu" -mmin -15)" ] || { abbruch "neuester Abzug $neu ist älter als 15 Minuten"; return 1; }
  gut "Abzug $neu ($(du -h "$a/backups/$neu" | cut -f1))"
}

# --- 1a: neuer Stand daneben --------------------------------------------------

h_1a() {  # commit — Code liegt schon in lumeapps-neu (git archive vom Mac)
  local alt="${BASIS}/lumeapps" neu="${BASIS}/lumeapps-neu"
  [ -f "$neu/docker-compose.yml" ] || { abbruch "$neu enthält keinen Code"; return 1; }
  [ -f "$alt/.env" ] || { abbruch "$alt/.env fehlt"; return 1; }
  [ -f "$alt/docker-compose.override.yml" ] || { abbruch "$alt/docker-compose.override.yml fehlt — ohne sie bricht der Personio-Abgleich"; return 1; }
  [ -f "$neu/.env" ] || cp "$alt/.env" "$neu/.env"
  [ -f "$neu/docker-compose.override.yml" ] || cp "$alt/docker-compose.override.yml" "$neu/"
  [ -n "$(env_lesen "$neu/.env" COMPOSE_PROJECT_NAME)" ] || env_setzen "$neu/.env" COMPOSE_PROJECT_NAME lumeapps
  chmod 600 "$neu/.env"
  echo "$1" > "$neu/DEPLOYED_COMMIT"
  gut "lumeapps-neu vorbereitet (Stand $1, Projektname $(env_lesen "$neu/.env" COMPOSE_PROJECT_NAME))"
}

h_1b_pruefen() {
  local d="${BASIS}/lumeapps-neu/frontend/dist"
  [ -s "$d/index.html" ] && [ -s "$d/player/index.html" ] || { abbruch "index.html oder player/index.html fehlt in $d"; return 1; }
  gut "Oberfläche und Player-Bundle liegen bereit"
}

# --- 1c: umschalten -----------------------------------------------------------

h_1c_umschalten() {  # 2 = vor dem Herunterfahren abgebrochen, nichts verändert
  local alt="${BASIS}/lumeapps" neu="${BASIS}/lumeapps-neu" d
  if [ ! -d "$alt/postgres_data" ] && [ -d "$neu/postgres_data" ]; then
    sag "schon umgeschaltet — stelle nur sicher, dass der Stack läuft"
    (cd "$neu" && ${C_PROD} up -d --build); return
  fi
  [ -d "$alt/postgres_data" ] || { abbruch "$alt/postgres_data fehlt"; return 2; }
  [ "$(env_lesen "$neu/.env" COMPOSE_PROJECT_NAME)" = lumeapps ] || { abbruch "COMPOSE_PROJECT_NAME in $neu/.env ist nicht lumeapps (Schritt 1a)"; return 2; }
  if [ -e "$alt/backend/media" ] && [ -e "$neu/backend/media" ]; then
    abbruch "$neu/backend/media gibt es schon — die Folien würden verschachtelt. Von Hand klären."; return 2
  fi
  for d in ${DATENVERZEICHNISSE}; do
    if [ -e "$alt/$d" ] && [ -e "$neu/$d" ]; then abbruch "$neu/$d gibt es schon"; return 2; fi
  done

  (cd "$alt" && docker compose down)
  for d in ${DATENVERZEICHNISSE}; do [ -e "$alt/$d" ] && mv "$alt/$d" "$neu/"; done
  if [ -e "$alt/backend/media" ]; then mkdir -p "$neu/backend" && mv "$alt/backend/media" "$neu/backend/"; fi
  (cd "$neu" && ${C_PROD} up -d --build)
}

h_1c_zurueck() {
  local alt="${BASIS}/lumeapps" neu="${BASIS}/lumeapps-neu" d
  (cd "$neu" && ${C_PROD} down)
  for d in ${DATENVERZEICHNISSE}; do
    if [ -e "$neu/$d" ] && [ ! -e "$alt/$d" ]; then mv "$neu/$d" "$alt/"; fi
  done
  if [ -e "$neu/backend/media" ] && [ ! -e "$alt/backend/media" ]; then mv "$neu/backend/media" "$alt/backend/"; fi
  (cd "$alt" && docker compose up -d)
}

h_1c_pruefen() {
  local neu="${BASIS}/lumeapps-neu" rc=0 x
  warte_auf_stack "$neu" 600 || rc=1
  cd "$neu"
  x="$(${C_PROD} ps --format '{{.Service}} {{.Ports}}' | awk '$1!="caddy" && /->/ {print $1}')"
  [ -z "$x" ] && gut "nur caddy veröffentlicht Ports" || { schlecht "veröffentlichen Ports: $x"; rc=1; }
  [ "$(${C_PROD} exec -T api id -u | tr -d '\r')" = 10001 ] && gut "api läuft als 10001" || { schlecht "api nicht als 10001"; rc=1; }
  ${C_PROD} exec -T api test ! -e /app/tests && gut "keine Testsuite im Bild" || { schlecht "/app/tests vorhanden"; rc=1; }
  ${C_PROD} exec -T api python -c 'import socket; socket.gethostbyname("api.personio.de")' >/dev/null 2>&1 \
    && gut "api.personio.de löst im Container auf" || { schlecht "DNS im Container kaputt — Override fehlt im Aufruf"; rc=1; }
  curl -sI http://127.0.0.1/ | grep -qi 'x-content-type-options: *nosniff' && gut "nosniff" || { schlecht "Header nosniff fehlt"; rc=1; }
  x="$(curl -s http://127.0.0.1/api/hr/embed/birthdays/this-week | head -c 2000)"
  printf '%s' "$x" | grep -qE 'birthday|age_turning' && { schlecht "Geburtstags-Embed liefert noch Geburtsdaten"; rc=1; } || gut "Geburtstags-Embed ohne Geburtsdaten"
  if [ -d "$neu/backend/media/slides" ]; then
    ${C_PROD} exec -T api test -d /app/media/slides && gut "PPTX-Folien im Container" || { schlecht "Folien fehlen im Container"; rc=1; }
  fi
  docker network inspect lumeapps_default >/dev/null 2>&1 && gut "Netz heißt lumeapps_default" || { schlecht "Netz lumeapps_default fehlt"; rc=1; }
  return $rc
}

# --- 3: Plattform -------------------------------------------------------------

h_3_env() {
  local p="${BASIS}/acm-plattform" e tag
  e="$p/.env"; tag="$(cat "$p/infra/supabase/UPSTREAM_TAG")"
  if [ "$(cat "$p/infra/supabase/upstream/UPSTREAM_TAG" 2>/dev/null)" != "$tag" ]; then
    (cd "$p" && bash infra/supabase/fetch-upstream.sh "$tag") >/dev/null
  fi
  [ -f "$e" ] || (cd "$p" && bash scripts/init-env.sh) >/dev/null
  local url="http://${HOST_IP}:${PLATTFORM_PORT}"
  env_setzen "$e" CADDY_HTTP_PORT "${PLATTFORM_PORT}"
  env_setzen "$e" SITE_URL "$url"
  env_setzen "$e" SUPABASE_PUBLIC_URL "$url/supabase"
  env_setzen "$e" API_EXTERNAL_URL "$url/supabase/auth/v1"
  env_setzen "$e" SIGNAGE_API_URL "http://host.docker.internal:${SIGNAGE_PORT}"
  [ -n "$(env_lesen "$e" EMBED_SECRET)" ] || env_setzen "$e" EMBED_SECRET "$(zufall_url)"
  [ -n "$(env_lesen "$e" GEHEIM_SCHLUESSEL)" ] || env_setzen "$e" GEHEIM_SCHLUESSEL "$(zufall_fernet)"
  chmod 600 "$e"
  gut "Plattform-.env: $url, Aussteller $url/supabase/auth/v1"
  local leer="" k
  for k in PERSONIO_CLIENT_ID PERSONIO_CLIENT_SECRET SMTP_HOST ATR_SMB_PASSWORT ATR_SCAN_TOKEN ANTHROPIC_API_KEY; do
    grep -q "^$k=" "$e" && [ -z "$(env_lesen "$e" "$k")" ] && leer="$leer $k"
  done
  [ -z "$leer" ] || sag "noch leer (von Hand nachtragen, falls gebraucht):$leer"
}

h_3_start() {
  local p="${BASIS}/acm-plattform" code
  (cd "$p" && docker compose up -d --build)
  warte_auf_stack "$p" 900 || return 1
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PLATTFORM_PORT}/")"
  case "$code" in 2*|3*) gut "Plattform antwortet auf :${PLATTFORM_PORT} ($code)";; *) abbruch "Plattform antwortet mit $code"; return 1;; esac
}

h_3_admin() {  # email passwort
  (cd "${BASIS}/acm-plattform" && bash scripts/bootstrap-admin.sh "$1" "$2")
}

# --- 4a/4b: Fachdaten und Dateien ---------------------------------------------

compute_container() { (cd "${BASIS}/acm-plattform" && docker compose ps -q compute); }

compute_cli() {  # befehl args... — mit ALT_FERNET_KEY und Quelle
  local q k
  q="$(alt_quelle)" || return 1
  k="$(env_lesen "$(alt_verzeichnis)/.env" FERNET_KEY)"
  [ -n "$k" ] || { abbruch "FERNET_KEY fehlt in der .env des Altprojekts — SNMP-Communities wären unlesbar"; return 1; }
  (cd "${BASIS}/acm-plattform" && docker compose exec -T -e ALT_FERNET_KEY="$k" compute python -m app.cli "$1" --quelle "$q" "${@:2}")
}

h_4a_trocken() {
  local c; c="$(compute_container)"; [ -n "$c" ] || { abbruch "compute läuft nicht"; return 1; }
  mit_altnetz "$c" compute_cli uebernahme --trocken || return 1
  mit_altnetz "$c" compute_cli uebernahme-nutzer --trocken
}

h_4a_echt() {
  local c liste; c="$(compute_container)"; [ -n "$c" ] || { abbruch "compute läuft nicht"; return 1; }
  mit_altnetz "$c" compute_cli uebernahme --leeren || return 1
  liste="${BASIS}/acm-plattform/zugaenge-$(date +%Y%m%d-%H%M%S).csv"
  ( umask 077; mit_altnetz "$c" compute_cli uebernahme-nutzer > "$liste" ) || { abbruch "Nutzer-Übernahme gescheitert, Teilausgabe in $liste"; return 1; }
  gut "neue Zugänge: $(( $(wc -l < "$liste") - 1 )) Personen, Passwörter in $liste (0600) — verteilen, dann löschen"
  mit_altnetz "$c" compute_cli abgleich
}

h_4b() {
  local c a; c="$(compute_container)"; a="$(alt_verzeichnis)"
  [ -n "$c" ] || { abbruch "compute läuft nicht"; return 1; }
  (cd "${BASIS}/acm-plattform" && docker compose cp "$a/directus_uploads" compute:/tmp/directus) || return 1
  local rc=0
  mit_altnetz "$c" compute_cli uebernahme-dateien --directus /tmp/directus || rc=1
  (cd "${BASIS}/acm-plattform" && docker compose exec -T compute rm -rf /tmp/directus) || true
  return $rc
}

# --- 4d: Signage --------------------------------------------------------------

h_4d_env() {
  local s="${BASIS}/acm-signage" p="${BASIS}/acm-plattform/.env" e alt_secret geaendert=""
  e="$s/.env"
  [ -f "$p" ] || { abbruch "$p fehlt — erst Schritt 3"; return 1; }
  alt_secret="$(env_lesen "$(alt_verzeichnis)/.env" SIGNAGE_DEVICE_JWT_SECRET)"
  [ -n "$alt_secret" ] || { abbruch "SIGNAGE_DEVICE_JWT_SECRET fehlt im Altprojekt — ohne es zeigt jeder Bildschirm einen Kopplungscode"; return 1; }
  [ -f "$e" ] || (cd "$s" && bash scripts/init-env.sh "$p") >/dev/null

  setze_wenn_anders() {  # schluessel wert
    if [ "$(env_lesen "$e" "$1")" != "$2" ]; then env_setzen "$e" "$1" "$2"; geaendert="$geaendert $1"; fi
  }
  setze_wenn_anders SIGNAGE_DEVICE_JWT_SECRET "$alt_secret"
  setze_wenn_anders PLATFORM_JWT_SECRET "$(env_lesen "$p" JWT_SECRET)"
  setze_wenn_anders PLATFORM_JWT_ISSUER "$(env_lesen "$p" API_EXTERNAL_URL)"
  setze_wenn_anders SIGNAGE_HTTP_PORT "${SIGNAGE_PORT}"
  chmod 600 "$e"
  if [ -n "$geaendert" ]; then gut "Signage-.env geändert:$geaendert"; else gut "Signage-.env unverändert"; fi
}

signage_medien_besitzer() {  # signage-api läuft als 10001; acm legt die Verzeichnisse an
  local s="${BASIS}/acm-signage"
  mkdir -p "$s/data/media" "$s/data/postgres" "$s/data/caddy"
  docker run --rm -v "$s/data/media:/m" alpine chown -R 10001:10001 /m
}

h_4d_start() {
  local s="${BASIS}/acm-signage"
  signage_medien_besitzer
  (cd "$s" && docker compose up -d --build)
  warte_auf_stack "$s" 900 || return 1
  curl -sf "http://127.0.0.1:${SIGNAGE_PORT}/health" | grep -q ok && gut "Signage antwortet auf :${SIGNAGE_PORT}" \
    || { abbruch "Signage /health antwortet nicht"; return 1; }
}

signage_uebernahme() {  # [--trocken]
  local s="${BASIS}/acm-signage" a c q
  a="$(alt_verzeichnis)"
  c="$(cd "$s" && docker compose ps -q signage-api)"; [ -n "$c" ] || { abbruch "signage-api läuft nicht"; return 1; }
  q="$(alt_quelle)" || return 1
  rm -rf "$s/data/media/uebernahme" 2>/dev/null || docker run --rm -v "$s/data/media:/m" alpine rm -rf /m/uebernahme
  mkdir -p "$s/data/media/uebernahme" 2>/dev/null || docker run --rm -v "$s/data/media:/m" alpine sh -c "mkdir -p /m/uebernahme && chown $(id -u) /m/uebernahme"
  cp -r "$a/directus_uploads" "$s/data/media/uebernahme/uploads"
  if [ -d "$a/backend/media/slides" ]; then cp -r "$a/backend/media/slides" "$s/data/media/uebernahme/slides"; else mkdir -p "$s/data/media/uebernahme/slides"; fi
  signage_medien_besitzer
  mit_altnetz "$c" sh -c 'cd "$1" && docker compose exec -T signage-api python -m app.uebernahme --quelle "$2" \
      --alte-medien /app/media/uebernahme/uploads --alte-folien /app/media/uebernahme/slides \
      --plattform-url "$3" ${4:+"$4"}' _ "$s" "$q" "http://${HOST_IP}:${PLATTFORM_PORT}" "${1:-}"
}

h_4d_trocken() { signage_uebernahme --trocken; }

h_4d_echt() {
  local s="${BASIS}/acm-signage" rc=0
  signage_uebernahme || rc=$?
  docker run --rm -v "$s/data/media:/m" alpine rm -rf /m/uebernahme
  return $rc
}

einbettung_erlaubt() {  # plattform-.env
  local v; v="$(env_lesen "$1" EMBED_FRAME_ANCESTORS)"
  case "$v" in ""|"*") return 0;; esac
  printf '%s' "$v" | grep -qF "http://${HOST_IP}:${SIGNAGE_PORT}"
}

h_4d_pruefen() {
  local p="${BASIS}/acm-plattform" rc=0
  einbettung_erlaubt "$p/.env" && gut "EMBED_FRAME_ANCESTORS lässt den Player zu" \
    || { schlecht "EMBED_FRAME_ANCESTORS schließt http://${HOST_IP}:${SIGNAGE_PORT} aus — HR-Tafeln bleiben leer"; rc=1; }
  (cd "$p" && docker compose exec -T web wget -qO- "$(env_lesen "$p/.env" SIGNAGE_API_URL)/health") | grep -q ok \
    && gut "Plattform erreicht den Signage-Stack" || { schlecht "web erreicht SIGNAGE_API_URL nicht"; rc=1; }
  [ "$(env_lesen "${BASIS}/acm-signage/.env" PLATFORM_JWT_ISSUER)" = "$(env_lesen "$p/.env" API_EXTERNAL_URL)" ] \
    && gut "Aussteller stimmt überein" || { schlecht "PLATFORM_JWT_ISSUER ≠ API_EXTERNAL_URL"; rc=1; }
  return $rc
}

# --- Abschluss ----------------------------------------------------------------

h_pruefen() {
  local rc=0 d
  for d in "${BASIS}/acm-plattform" "${BASIS}/acm-signage"; do warte_auf_stack "$d" 60 || rc=1; done
  (cd "${BASIS}/acm-plattform" && bash scripts/backup.sh) && gut "Sicherung der Plattform läuft durch" || { schlecht "scripts/backup.sh gescheitert"; rc=1; }
  sag "Geräte laut Signage-Datenbank (zuletzt gesehen):"
  (cd "${BASIS}/acm-signage" && docker compose exec -T signage-db sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " | " -c "select name, coalesce(to_char(last_seen_at, '"'"'YYYY-MM-DD HH24:MI'"'"'), '"'"'nie'"'"') from signage_devices order by name"') \
    | sed 's/^/    /' || rc=1
  return $rc
}
