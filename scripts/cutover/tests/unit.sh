#!/usr/bin/env bash
# Unit-Tests für scripts/cutover. Kein Host, kein Docker: `docker`, `curl` und
# `systemctl` sind Attrappen, die ihre Aufrufe mitschreiben. Geprüft wird die
# Logik, die am Stichtag nichts falsch machen darf — Umzug der Verzeichnisse,
# Secrets, Reihenfolge, Haltepunkte, Pi-Adressen, Rückwege.
#
# Aufruf: bash scripts/cutover/tests/unit.sh
set -uo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUTOVER="$(cd "${HIER}/.." && pwd)"

FEHLER=0
BESTANDEN=0

pruefe() {  # pruefe <name> <befehl...>
  local name="$1"; shift
  # set -e wirkt nur, wenn die Subshell allein steht — in if, && oder || zählte
  # sonst nur die letzte Zeile eines Tests
  local rc
  ( set -e; "$@" ) >"${AUSGABE}" 2>&1
  rc=$?
  if [ "${rc}" -eq 0 ]; then
    BESTANDEN=$((BESTANDEN + 1)); printf '  ok    %s\n' "${name}"
  else
    FEHLER=$((FEHLER + 1)); printf '  FEHLER %s\n' "${name}"; sed 's/^/        | /' "${AUSGABE}"
  fi
}

gleich() { [ "$1" = "$2" ] || { echo "erwartet «$2», bekommen «$1»"; return 1; }; }
enthaelt() { grep -qF -- "$2" <<<"$1" || { echo "«$2» fehlt in:"; echo "$1"; return 1; }; }
enthaelt_nicht() { ! grep -qF -- "$2" <<<"$1" || { echo "«$2» darf nicht vorkommen in:"; echo "$1"; return 1; }; }

# --- Sandbox je Test --------------------------------------------------------

sandbox() {
  SANDBOX="$(mktemp -d)"
  export BASIS="${SANDBOX}/home/acm"
  export AUFRUFE="${SANDBOX}/aufrufe.log"
  mkdir -p "${BASIS}" "${SANDBOX}/bin"
  : > "${AUFRUFE}"
  for werkzeug in docker curl systemctl sudo; do
    gross="$(printf '%s' "${werkzeug}" | tr '[:lower:]' '[:upper:]')"
    cat > "${SANDBOX}/bin/${werkzeug}" <<EOF
#!/usr/bin/env bash
echo "${werkzeug} \$*" >> "${AUFRUFE}"
if [ -n "\${ATTRAPPE_${gross}:-}" ]; then eval "\${ATTRAPPE_${gross}}"; fi
EOF
    chmod +x "${SANDBOX}/bin/${werkzeug}"
  done
  export PATH="${SANDBOX}/bin:${PATH}"
}

altprojekt_anlegen() {  # das Altprojekt, wie es am Host liegt
  local d="${BASIS}/lumeapps"
  mkdir -p "${d}/backend/media/slides/abc" "${d}/directus_uploads" "${d}/postgres_data" "${d}/backups"
  echo folie > "${d}/backend/media/slides/abc/1.png"
  echo datei > "${d}/directus_uploads/x.png"
  printf 'POSTGRES_USER=kpi_user\nPOSTGRES_PASSWORD=geheim-db\nPOSTGRES_DB=kpi_db\nFERNET_KEY=geheim-fernet\nSIGNAGE_DEVICE_JWT_SECRET=geheim-geraet\n' > "${d}/.env"
  echo 'services: {api: {dns: [192.9.200.1]}}' > "${d}/docker-compose.override.yml"
  echo ffc9ba0 > "${d}/DEPLOYED_COMMIT"
}

neuer_klon_anlegen() {  # was `git archive` in 1a hinterlässt
  mkdir -p "${BASIS}/lumeapps-neu/backend/app" "${BASIS}/lumeapps-neu/frontend"
  echo 'services: {}' > "${BASIS}/lumeapps-neu/docker-compose.yml"
}

AUSGABE="$(mktemp)"
. "${CUTOVER}/host.sh"

# --- Hilfen für .env ----------------------------------------------------------

t_env_setzen_ersetzt_und_haengt_an() {
  sandbox
  f="${SANDBOX}/.env"; printf 'A=1\nB=alt\n' > "$f"
  env_setzen "$f" B 'neu mit / und |'
  env_setzen "$f" C 3
  gleich "$(env_lesen "$f" B)" 'neu mit / und |'
  gleich "$(env_lesen "$f" C)" 3
  gleich "$(grep -c '^B=' "$f")" 1
}
pruefe "env_setzen ersetzt vorhandene Schlüssel und hängt neue an" t_env_setzen_ersetzt_und_haengt_an

t_env_lesen_leer_bei_fehlendem_schluessel() {
  sandbox
  f="${SANDBOX}/.env"; printf 'A=1\n' > "$f"
  gleich "$(env_lesen "$f" FEHLT)" ""
}
pruefe "env_lesen liefert leer für fehlende Schlüssel" t_env_lesen_leer_bei_fehlendem_schluessel

# --- 1a -----------------------------------------------------------------------

t_1a_kopiert_env_und_setzt_projektnamen_einmal() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen
  h_1a abc1234
  h_1a abc1234
  n="${BASIS}/lumeapps-neu"
  gleich "$(env_lesen "$n/.env" COMPOSE_PROJECT_NAME)" lumeapps
  gleich "$(grep -c '^COMPOSE_PROJECT_NAME=' "$n/.env")" 1
  gleich "$(env_lesen "$n/.env" POSTGRES_PASSWORD)" geheim-db
  [ -f "$n/docker-compose.override.yml" ]
  gleich "$(cat "$n/DEPLOYED_COMMIT")" abc1234
  gleich "$(stat -c %a "$n/.env" 2>/dev/null || stat -f %Lp "$n/.env")" 600
}
pruefe "1a: .env und Override kopiert, COMPOSE_PROJECT_NAME genau einmal" t_1a_kopiert_env_und_setzt_projektnamen_einmal

t_1a_nimmt_der_alten_datenbank_den_hostport() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen
  printf 'services:\n  api:\n    dns: [192.9.200.1]\n  db:\n    ports:\n      - "127.0.0.1:5432:5432"\n' > "${BASIS}/lumeapps/docker-compose.override.yml"
  h_1a abc1234
  n="${BASIS}/lumeapps-neu"
  gleich "$(cat "$n/docker-compose.cutover.yml" | grep -v '^#')" "services:
  db:
    ports: !reset []"
  # Override bleibt wie am Host (DNS), der alte Baum unverändert
  gleich "$(cat "$n/docker-compose.override.yml")" "$(cat "${BASIS}/lumeapps/docker-compose.override.yml")"
  enthaelt "$C_PROD" "-f docker-compose.cutover.yml"
}
pruefe "1a: gehärtetes Altprojekt ohne Host-Port der Datenbank (5432 für die Plattform)" t_1a_nimmt_der_alten_datenbank_den_hostport

t_compose_version_fuer_reset() {
  compose_kann_reset "Docker Compose version v2.40.3"
  compose_kann_reset "Docker Compose version 2.24.0"
  ! compose_kann_reset "Docker Compose version v2.23.3" || return 1
  ! compose_kann_reset "docker-compose version 1.29.2"
}
pruefe "vorab: !reset braucht Compose ab 2.24" t_compose_version_fuer_reset

t_1a_verweigert_ohne_override() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen
  rm "${BASIS}/lumeapps/docker-compose.override.yml"
  ! h_1a abc1234
}
pruefe "1a: bricht ab, wenn die Override-Datei fehlt (DNS für Personio)" t_1a_verweigert_ohne_override

# --- 1c -----------------------------------------------------------------------

t_1c_zieht_daten_und_folien_um() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen; h_1a abc1234
  h_1c_umschalten
  n="${BASIS}/lumeapps-neu"
  [ -f "$n/backend/media/slides/abc/1.png" ] || { echo "Folien fehlen"; return 1; }
  [ -d "$n/postgres_data" ] && [ -f "$n/directus_uploads/x.png" ]
  [ ! -e "${BASIS}/lumeapps/postgres_data" ] && [ ! -e "${BASIS}/lumeapps/backend/media" ]
  a="$(cat "${AUFRUFE}")"
  enthaelt "$a" "docker compose down"
  enthaelt "$a" "docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.prod.yml -f docker-compose.cutover.yml up -d --build"
}
pruefe "1c: Datenverzeichnisse und backend/media ziehen um, Prod-Aufruf mit Override" t_1c_zieht_daten_und_folien_um

t_1c_verschachtelt_folien_nicht() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen; h_1a abc1234
  mkdir -p "${BASIS}/lumeapps-neu/backend/media"
  ! h_1c_umschalten || return 1
  [ -d "${BASIS}/lumeapps/backend/media/slides" ] || { echo "alte Folien angefasst"; return 1; }
  [ ! -e "${BASIS}/lumeapps-neu/backend/media/media" ]
}
pruefe "1c: bricht ab statt Folien zu verschachteln, wenn Ziel schon existiert" t_1c_verschachtelt_folien_nicht

t_1c_laesst_certs_im_alten_baum() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen; h_1a abc1234
  mkdir -p "${BASIS}/lumeapps/certs" "${BASIS}/lumeapps-neu/certs"
  echo alt > "${BASIS}/lumeapps/certs/internal.key"; echo readme > "${BASIS}/lumeapps-neu/certs/README.md"
  h_1c_umschalten || { echo "Umschalten scheiterte"; return 1; }
  [ -f "${BASIS}/lumeapps/certs/internal.key" ] && [ ! -e "${BASIS}/lumeapps-neu/certs/certs" ]
}
pruefe "1c: certs/ (im neuen Stand eingecheckt) bleibt liegen, nichts verschachtelt" t_1c_laesst_certs_im_alten_baum

t_1c_abbruch_vor_dem_herunterfahren_meldet_2() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen; h_1a abc1234
  mkdir -p "${BASIS}/lumeapps-neu/directus_uploads"
  rc=0; h_1c_umschalten || rc=$?
  gleich "$rc" 2
  enthaelt_nicht "$(cat "${AUFRUFE}")" "down"
}
pruefe "1c: Abbruch vor dem Herunterfahren gibt 2 zurück, nichts gestoppt" t_1c_abbruch_vor_dem_herunterfahren_meldet_2

# Auf dem Host gehört postgres_data dem Postgres-Nutzer (70, drwx------): acm darf
# es nicht in einen anderen Ordner verschieben. Nachgestellt mit einem mv, das
# genau daran scheitert, und einem docker, das als root verschiebt.
mv_scheitert_an_postgres_data() {
  cat > "${SANDBOX}/bin/mv" <<'EOF2'
#!/usr/bin/env bash
case "$*" in *postgres_data*) echo "mv: cannot move: Permission denied" >&2; exit 1;; esac
exec /bin/mv "$@"
EOF2
  chmod +x "${SANDBOX}/bin/mv"
}
docker_verschiebt_als_root() {  # docker run --rm -v BASIS:/h alpine mv /h/x /h/y
  export ATTRAPPE_DOCKER='case "$*" in *" alpine mv "*) set -- $*; q="${@: -2:1}"; z="${@: -1}"; /bin/mv "${BASIS}${q#/h}" "${BASIS}${z#/h}";; esac'
}

t_1c_verschiebt_postgres_data_als_root() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen; h_1a abc1234
  mv_scheitert_an_postgres_data; docker_verschiebt_als_root
  h_1c_umschalten
  [ -d "${BASIS}/lumeapps-neu/postgres_data" ] && [ ! -e "${BASIS}/lumeapps/postgres_data" ]
}
pruefe "1c: postgres_data zieht auch um, wenn acm es nicht verschieben darf" t_1c_verschiebt_postgres_data_als_root

t_1c_startet_nie_ohne_daten() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen; h_1a abc1234
  mv_scheitert_an_postgres_data   # und docker verschiebt nichts
  rc=0; h_1c_umschalten || rc=$?
  [ "$rc" -ne 0 ] || { echo "Umschalten meldete Erfolg ohne Datenbank"; return 1; }
  enthaelt_nicht "$(cat "${AUFRUFE}")" "docker-compose.prod.yml -f docker-compose.cutover.yml up"
  enthaelt "$(tail -1 "${AUFRUFE}")" "-f ${BASIS}/lumeapps-neu/docker-compose.cutover.yml up -d"
  [ -d "${BASIS}/lumeapps/postgres_data" ] && [ -f "${BASIS}/lumeapps/directus_uploads/x.png" ]
}
pruefe "1c: scheitert der Umzug, startet der neue Stack nicht — alles zurück, alter läuft" t_1c_startet_nie_ohne_daten

t_1c_zurueck_stellt_alles_wieder_her() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen; h_1a abc1234
  h_1c_umschalten
  h_1c_zurueck
  [ -f "${BASIS}/lumeapps/backend/media/slides/abc/1.png" ] && [ -d "${BASIS}/lumeapps/postgres_data" ]
  [ ! -e "${BASIS}/lumeapps-neu/postgres_data" ]
  # auch zurück ohne Host-Port der DB: nach Schritt 3 hält die Plattform 5432
  enthaelt "$(tail -1 "${AUFRUFE}")" "docker compose -f docker-compose.yml -f docker-compose.override.yml -f ${BASIS}/lumeapps-neu/docker-compose.cutover.yml up -d"
}
pruefe "1c zurück: Daten und Folien wieder im alten Baum, alter Stack startet" t_1c_zurueck_stellt_alles_wieder_her

t_altverzeichnis_folgt_den_daten() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen; h_1a abc1234
  gleich "$(alt_verzeichnis)" "${BASIS}/lumeapps"
  h_1c_umschalten
  gleich "$(alt_verzeichnis)" "${BASIS}/lumeapps-neu"
}
pruefe "alt_verzeichnis zeigt dorthin, wo postgres_data liegt" t_altverzeichnis_folgt_den_daten

t_lan_ports_nur_von_aussen_erreichbare() {
  zeilen='caddy 0.0.0.0:80->80/tcp, [::]:80->80/tcp
directus 127.0.0.1:8055->8055/tcp
api 8000/tcp
frontend 0.0.0.0:5173->5173/tcp'
  gleich "$(printf '%s\n' "$zeilen" | lan_ports_ausser caddy)" frontend
}
pruefe "1c: nur LAN-weit veröffentlichte Ports zählen, 127.0.0.1 nicht" t_lan_ports_nur_von_aussen_erreichbare

# --- 3 ------------------------------------------------------------------------

plattform_anlegen() {
  local p="${BASIS}/acm-plattform"
  mkdir -p "$p/infra/supabase/upstream/utils" "$p/scripts"
  echo v1 > "$p/infra/supabase/UPSTREAM_TAG"; echo v1 > "$p/infra/supabase/upstream/UPSTREAM_TAG"
  printf 'CADDY_HTTP_PORT=80\nKONG_HTTP_PORT=8000\nPOSTGRES_PORT=5432\nSITE_URL=http://localhost\nSUPABASE_PUBLIC_URL=http://localhost/supabase\nAPI_EXTERNAL_URL=http://localhost/supabase/auth/v1\nJWT_SECRET=\nEMBED_SECRET=\nGEHEIM_SCHLUESSEL=\nEMBED_FRAME_ANCESTORS=*\n' > "$p/.env.example"
  cat > "$p/scripts/init-env.sh" <<'EOF'
cd "$(dirname "$0")/.."; cp .env.example .env; sed -i.bak 's/^JWT_SECRET=.*/JWT_SECRET=plattform-jwt/' .env; rm .env.bak
EOF
}

t_3_env_setzt_adressen_und_erzeugt_secrets() {
  sandbox; plattform_anlegen
  export HOST_IP=192.9.201.9 PLATTFORM_PORT=8081 SIGNAGE_PORT=8080
  h_3_env
  e="${BASIS}/acm-plattform/.env"
  gleich "$(env_lesen "$e" CADDY_HTTP_PORT)" 8081
  gleich "$(env_lesen "$e" SITE_URL)" http://192.9.201.9:8081
  gleich "$(env_lesen "$e" SUPABASE_PUBLIC_URL)" http://192.9.201.9:8081/supabase
  gleich "$(env_lesen "$e" API_EXTERNAL_URL)" http://192.9.201.9:8081/supabase/auth/v1
  gleich "$(env_lesen "$e" KONG_HTTP_PORT)" 8010   # 8000 braucht das alte Dev-Projekt für den Rückweg
  [ -n "$(env_lesen "$e" EMBED_SECRET)" ] && [ -n "$(env_lesen "$e" GEHEIM_SCHLUESSEL)" ]
  # zweiter Lauf behält die Secrets
  vorher="$(env_lesen "$e" EMBED_SECRET)"; h_3_env
  gleich "$(env_lesen "$e" EMBED_SECRET)" "$vorher"
}
pruefe "3: Adressen mit Port und Pfad, Secrets einmalig erzeugt" t_3_env_setzt_adressen_und_erzeugt_secrets

t_4a_zugaenge_trennt_bericht_und_csv() {
  sandbox
  roh="${SANDBOX}/roh"; csv="${SANDBOX}/zugaenge.csv"
  printf 'Übernahme Nutzer\n  Angelegt: 1\n  Gab es schon: 0\n\nZugangsdaten — nur jetzt sichtbar, bitte wegschreiben:\nemail;passwort\nanna@example.com;geheim-pw\n' > "$roh"
  out="$(zugaenge_trennen "$roh" "$csv")"
  gleich "$(cat "$csv")" "email;passwort
anna@example.com;geheim-pw"
  enthaelt "$out" "Angelegt: 1"
  enthaelt_nicht "$out" "geheim-pw"
  gleich "$(zugaenge_anzahl "$csv")" 1
}
pruefe "4a: Zugangsliste enthält nur das CSV, Passwörter nie im Terminal" t_4a_zugaenge_trennt_bericht_und_csv

t_3_portkonflikt_erkannt() {
  sandbox
  export ATTRAPPE_DOCKER='echo "127.0.0.1:5432->5432/tcp"; echo "0.0.0.0:80->80/tcp, [::]:80->80/tcp"; echo "127.0.0.1:8055->8055/tcp"'
  gleich "$(belegte_hostports | tr '\n' ' ')" "80 5432 8055 "
  gleich "$(ports_im_weg 8081 8010 5432 | tr '\n' ' ')" "5432 "
  gleich "$(ports_im_weg 8081 8010 | tr '\n' ' ')" ""
}
pruefe "3: belegte Host-Ports vor dem Start erkannt (alte DB auf 5432)" t_3_portkonflikt_erkannt

# --- 4d -----------------------------------------------------------------------

signage_anlegen() {
  local s="${BASIS}/acm-signage"
  mkdir -p "$s/scripts"
  printf 'SIGNAGE_DEVICE_JWT_SECRET=\nPLATFORM_JWT_SECRET=\nPLATFORM_JWT_ISSUER=http://localhost/supabase/auth/v1\nSIGNAGE_HTTP_PORT=8080\nSIGNAGE_DATA_DIR=./data\n' > "$s/.env.example"
  cat > "$s/scripts/init-env.sh" <<'EOF'
cd "$(dirname "$0")/.."; cp .env.example .env
sed -i.bak 's/^SIGNAGE_DEVICE_JWT_SECRET=.*/SIGNAGE_DEVICE_JWT_SECRET=frisch-erzeugt/' .env; rm .env.bak
EOF
}

t_4d_env_uebernimmt_geraete_secret_und_aussteller() {
  sandbox; altprojekt_anlegen; plattform_anlegen; signage_anlegen
  export HOST_IP=192.9.201.9 PLATTFORM_PORT=8081 SIGNAGE_PORT=8080
  h_3_env
  out="$(h_4d_env)"
  e="${BASIS}/acm-signage/.env"
  gleich "$(env_lesen "$e" SIGNAGE_DEVICE_JWT_SECRET)" geheim-geraet
  gleich "$(env_lesen "$e" PLATFORM_JWT_SECRET)" plattform-jwt
  gleich "$(env_lesen "$e" PLATFORM_JWT_ISSUER)" http://192.9.201.9:8081/supabase/auth/v1
  enthaelt_nicht "$out" geheim-geraet
  enthaelt_nicht "$out" plattform-jwt
}
pruefe "4d: Geräte-Secret aus Altprojekt, Plattform-JWT und Aussteller, nichts ausgegeben" t_4d_env_uebernimmt_geraete_secret_und_aussteller

t_4d_env_zieht_aussteller_nach() {
  sandbox; altprojekt_anlegen; plattform_anlegen; signage_anlegen
  export HOST_IP=192.9.201.9 PLATTFORM_PORT=8081 SIGNAGE_PORT=8080
  h_3_env; h_4d_env >/dev/null
  export PLATTFORM_PORT=80; h_3_env
  out="$(h_4d_env)"
  gleich "$(env_lesen "${BASIS}/acm-signage/.env" PLATFORM_JWT_ISSUER)" http://192.9.201.9:80/supabase/auth/v1
  enthaelt "$out" "geändert"
}
pruefe "4d: geänderter Aussteller der Plattform wird nachgezogen und gemeldet" t_4d_env_zieht_aussteller_nach

t_4d_verweigert_ohne_altes_secret() {
  sandbox; altprojekt_anlegen; plattform_anlegen; signage_anlegen
  export HOST_IP=192.9.201.9 PLATTFORM_PORT=8081 SIGNAGE_PORT=8080
  sed -i.bak '/SIGNAGE_DEVICE_JWT_SECRET/d' "${BASIS}/lumeapps/.env"
  h_3_env
  ! h_4d_env
}
pruefe "4d: ohne altes Geräte-Secret kein Start (sonst Kopplungscode überall)" t_4d_verweigert_ohne_altes_secret

t_einbettung_prueft_frame_ancestors() {
  sandbox; plattform_anlegen
  export HOST_IP=192.9.201.9 PLATTFORM_PORT=8081 SIGNAGE_PORT=8080
  h_3_env
  e="${BASIS}/acm-plattform/.env"
  einbettung_erlaubt "$e"
  env_setzen "$e" EMBED_FRAME_ANCESTORS "'self' http://anderswo:8080"
  ! einbettung_erlaubt "$e" || return 1
  env_setzen "$e" EMBED_FRAME_ANCESTORS "'self' http://192.9.201.9:8080"
  einbettung_erlaubt "$e"
}
pruefe "4d: EMBED_FRAME_ANCESTORS muss den Player-Ursprung zulassen" t_einbettung_prueft_frame_ancestors

# --- Pis ----------------------------------------------------------------------

. "${CUTOVER}/pi.sh"

pi_anlegen() {  # adresse
  export PI_UNIT_DIR="${SANDBOX}/units"
  mkdir -p "${PI_UNIT_DIR}"
  printf '[Service]\nEnvironment=SIGNAGE_API_BASE=%s\nExecStart=/usr/bin/python3 -m sidecar\n' "$1" > "${PI_UNIT_DIR}/signage-sidecar.service"
  printf '[Service]\nExecStart=/usr/bin/chromium \\\n    --app=%s/player/ \\\n    --kiosk\n' "$1" > "${PI_UNIT_DIR}/signage-player.service"
}

t_pi_adresse_liest_units() {
  sandbox; pi_anlegen http://192.9.201.9:8000
  gleich "$(p_adresse)" "http://192.9.201.9:8000"
}
pruefe "Pi: Adresse aus der Sidecar-Unit gelesen" t_pi_adresse_liest_units

t_pi_umstellen_schreibt_beide_units_und_sichert() {
  sandbox; pi_anlegen http://192.9.201.9
  export ATTRAPPE_CURL='echo "{\"ready\": true, \"online\": true, \"cached_items\": 3}"'
  export PI_WARTEN=1
  p_umstellen http://192.9.201.9:8080
  enthaelt "$(cat "${PI_UNIT_DIR}/signage-sidecar.service")" "SIGNAGE_API_BASE=http://192.9.201.9:8080"
  enthaelt "$(cat "${PI_UNIT_DIR}/signage-player.service")" "--app=http://192.9.201.9:8080/player/"
  enthaelt "$(cat "${PI_UNIT_DIR}/signage-sidecar.service.vor-cutover")" "SIGNAGE_API_BASE=http://192.9.201.9"
  a="$(cat "${AUFRUFE}")"
  enthaelt "$a" "systemctl --user daemon-reload"
  enthaelt "$a" "systemctl --user restart signage-sidecar signage-player"
}
pruefe "Pi umstellen: beide Units neu, Sicherung angelegt, Dienste neu gestartet" t_pi_umstellen_schreibt_beide_units_und_sichert

t_pi_umstellen_zweimal_behaelt_erste_sicherung() {
  sandbox; pi_anlegen http://192.9.201.9
  export ATTRAPPE_CURL='echo "{\"ready\": true, \"online\": true}"' PI_WARTEN=1
  p_umstellen http://192.9.201.9:8080
  p_umstellen http://192.9.201.9:8080
  enthaelt "$(cat "${PI_UNIT_DIR}/signage-sidecar.service.vor-cutover")" "SIGNAGE_API_BASE=http://192.9.201.9"$'\n'
}
pruefe "Pi umstellen zweimal: Sicherung bleibt die ursprüngliche" t_pi_umstellen_zweimal_behaelt_erste_sicherung

t_pi_umstellen_scheitert_wenn_offline() {
  sandbox; pi_anlegen http://192.9.201.9
  export ATTRAPPE_CURL='echo "{\"ready\": true, \"online\": false}"' PI_WARTEN=1
  ! p_umstellen http://192.9.201.9:8080
}
pruefe "Pi umstellen: Fehler, wenn der Sidecar die neue Adresse nicht erreicht" t_pi_umstellen_scheitert_wenn_offline

t_pi_zurueck() {
  sandbox; pi_anlegen http://192.9.201.9
  export ATTRAPPE_CURL='echo "{\"ready\": true, \"online\": true}"' PI_WARTEN=1
  p_umstellen http://192.9.201.9:8080
  p_zurueck
  gleich "$(p_adresse)" http://192.9.201.9
  [ ! -e "${PI_UNIT_DIR}/signage-sidecar.service.vor-cutover" ]
}
pruefe "Pi zurück: alte Units wieder aktiv" t_pi_zurueck

# --- Port 80 ------------------------------------------------------------------

port80_lage() {  # Plattform, Signage und gehärtetes Altprojekt vor dem Umzug
  sandbox; altprojekt_anlegen; neuer_klon_anlegen
  export HOST_IP=192.9.201.9 PLATTFORM_PORT=8081 SIGNAGE_PORT=8080
  mkdir -p "${BASIS}/acm-plattform" "${BASIS}/acm-signage"
  # 1c hat die Daten verschoben: lumeapps-neu ist das aktive Verzeichnis
  mv "${BASIS}/lumeapps/postgres_data" "${BASIS}/lumeapps-neu/"
  printf 'services:\n  db:\n    ports: !reset []\n' > "${BASIS}/lumeapps-neu/docker-compose.cutover.yml"
  printf 'CADDY_HTTP_PORT=8081\nSITE_URL=http://192.9.201.9:8081\nSUPABASE_PUBLIC_URL=http://192.9.201.9:8081/supabase\nAPI_EXTERNAL_URL=http://192.9.201.9:8081/supabase/auth/v1\n' > "${BASIS}/acm-plattform/.env"
  printf 'PLATFORM_JWT_ISSUER=http://192.9.201.9:8081/supabase/auth/v1\nSIGNAGE_HTTP_PORT=8080\n' > "${BASIS}/acm-signage/.env"
  # Nicht der Prüfgegenstand: die Medien-Abfrage, das Warten, die Endprüfung.
  # schreibt ihre Abfragen mit, damit der Test sie prüfen kann
  signage_psql() {
    echo "signage_psql $1" >> "${AUFRUFE}"
    case "$1" in
      select*) printf '22222222\thttp://192.9.201.9:8081/embed/worldcup\n' ;;
    esac
  }
  warte_auf_stack() { return 0; }
  h_port80_pruefen() { return 0; }
}

t_port80_zieht_alle_adressen_mit() {
  port80_lage
  h_port80 >/dev/null
  pe="${BASIS}/acm-plattform/.env"; se="${BASIS}/acm-signage/.env"
  gleich "$(env_lesen "$pe" CADDY_HTTP_PORT)" 80
  gleich "$(env_lesen "$pe" SITE_URL)" http://192.9.201.9
  gleich "$(env_lesen "$pe" SUPABASE_PUBLIC_URL)" http://192.9.201.9/supabase
  gleich "$(env_lesen "$pe" API_EXTERNAL_URL)" http://192.9.201.9/supabase/auth/v1
  # Zeichen für Zeichen derselbe Aussteller, sonst antwortet Signage mit 401.
  gleich "$(env_lesen "$se" PLATFORM_JWT_ISSUER)" "$(env_lesen "$pe" API_EXTERNAL_URL)"
}
pruefe "port80: Adressen der Plattform und Aussteller im Signage-Stack wandern gemeinsam" t_port80_zieht_alle_adressen_mit

t_port80_raeumt_port_80_beim_altprojekt() {
  port80_lage
  h_port80 >/dev/null
  c="$(cat "${BASIS}/lumeapps-neu/docker-compose.cutover.yml")"
  enthaelt "$c" '"8082:80"'
  enthaelt "$c" 'ports: !reset []'
}
pruefe "port80: Altprojekt räumt Port 80, die alte Datenbank bleibt ohne Host-Port" t_port80_raeumt_port_80_beim_altprojekt

t_port80_schreibt_die_eingebetteten_adressen_um() {
  port80_lage
  h_port80 >/dev/null
  enthaelt "$(cat "${AUFRUFE}")" "update signage_media set uri = replace(uri, ':8081/', '/')"
}
pruefe "port80: eingebettete Seiten verlieren den alten Port" t_port80_schreibt_die_eingebetteten_adressen_um

t_port80_sichert_einmal_und_ueberschreibt_nicht() {
  port80_lage
  h_port80 >/dev/null
  h_port80 >/dev/null
  gleich "$(env_lesen "${BASIS}/acm-plattform/.env.vor-port80" CADDY_HTTP_PORT)" 8081
  gleich "$(env_lesen "${BASIS}/acm-signage/.env.vor-port80" PLATFORM_JWT_ISSUER)" http://192.9.201.9:8081/supabase/auth/v1
}
pruefe "port80: zweimal gefahren, die Sicherung bleibt der Stand von vorher" t_port80_sichert_einmal_und_ueberschreibt_nicht

t_port80_zurueck_stellt_alles_her() {
  port80_lage
  h_port80 >/dev/null
  h_port80_zurueck >/dev/null
  pe="${BASIS}/acm-plattform/.env"; se="${BASIS}/acm-signage/.env"
  gleich "$(env_lesen "$pe" CADDY_HTTP_PORT)" 8081
  gleich "$(env_lesen "$pe" API_EXTERNAL_URL)" http://192.9.201.9:8081/supabase/auth/v1
  gleich "$(env_lesen "$se" PLATFORM_JWT_ISSUER)" http://192.9.201.9:8081/supabase/auth/v1
  enthaelt_nicht "$(cat "${BASIS}/lumeapps-neu/docker-compose.cutover.yml")" '8082:80'
  [ ! -e "$pe.vor-port80" ]
}
pruefe "port80 zurück: Adressen, Aussteller und Altprojekt-Port wiederhergestellt" t_port80_zurueck_stellt_alles_her

t_port80_zurueck_ohne_sicherung_bricht_ab() {
  port80_lage
  ! h_port80_zurueck >/dev/null 2>&1
}
pruefe "port80 zurück: ohne Sicherung kein Rückweg" t_port80_zurueck_ohne_sicherung_bricht_ab

t_port80_pruefung_haelt_den_anlauf_aus() {
  port80_lage
  . "${CUTOVER}/host.sh"   # die echte Prüfung zurückholen (port80_lage stubbt sie)
  # Der Signage-Stack lief am 2026-09-24 beim ersten Versuch noch an: /player/
  # antwortete mit 502, die Prüfung urteilte über den Anlauf statt über das
  # Ergebnis. Die Attrappe stellt genau das nach.
  zaehler="${SANDBOX}/player-versuche"; echo 0 > "$zaehler"
  export PORT80_WARTEN=20
  export ATTRAPPE_CURL='
    case "$*" in
      */player/*)
        n=$(( $(cat '"$zaehler"') + 1 )); echo $n > '"$zaehler"'
        if [ $n -le 2 ]; then printf 502; else printf 200; fi ;;
      *:8080/health*) echo "{\"status\": \"ok\"}" ;;
      */login*|*/api/health*) printf 200 ;;
      *) printf 307 ;;
    esac'
  signage_psql() { echo 0; }
  h_port80_pruefen
  # Erst der dritte Versuch war erfolgreich — die Prüfung muss durchgehalten haben.
  [ "$(cat "$zaehler")" -ge 3 ] || { echo "nur $(cat "$zaehler") Versuche"; return 1; }
}
pruefe "port80: die Prüfung wartet den Anlauf des Signage-Stacks ab" t_port80_pruefung_haelt_den_anlauf_aus

t_port80_pruefung_meldet_echten_fehlschlag() {
  port80_lage
  . "${CUTOVER}/host.sh"
  export PORT80_WARTEN=3
  export ATTRAPPE_CURL='case "$*" in */player/*) printf 502 ;; */login*|*/api/health*) printf 200 ;; *) printf 307 ;; esac'
  signage_psql() { echo 0; }
  ! h_port80_pruefen >/dev/null 2>&1
}
pruefe "port80: bleibt es bei 502, meldet die Prüfung den Fehlschlag" t_port80_pruefung_meldet_echten_fehlschlag

t_port80_bindung_wird_von_compose_wirklich_gesetzt() {
  # Der Test, der gefehlt hat: Am 2026-09-24 stand `"8082:80"` korrekt in der
  # Datei, aber `ports: !reset` mit Liste LÖSCHT die Bindung, statt sie zu
  # ersetzen (dafür gibt es `!override`). Das Altprojekt lief danach ohne jeden
  # Host-Port — als Rückfall wertlos. Ein Test gegen den Dateitext erkennt nur
  # die eigene Ausgabe wieder; geprüft wird deshalb die aufgelöste Konfiguration.
  # Ohne die Attrappen der Test-Sandbox: hier ist das echte docker gefragt.
  echtes_docker="$(PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin command -v docker || true)"
  [ -n "${echtes_docker}" ] || { echo "docker nicht gefunden"; return 1; }
  sandbox_aus="$(mktemp -d)"
  cat > "${sandbox_aus}/docker-compose.yml" <<'YAML'
services:
  db:
    image: postgres:17-alpine
    ports:
      - "127.0.0.1:5432:5432"
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
YAML
  # dieselbe Datei, die h_port80 schreibt
  cat > "${sandbox_aus}/docker-compose.cutover.yml" <<'YAML'
services:
  db:
    ports: !reset []
  caddy:
    ports: !override
      - "8082:80"
YAML
  aufgeloest="$(cd "${sandbox_aus}" && "${echtes_docker}" compose -f docker-compose.yml -f docker-compose.cutover.yml config 2>/dev/null)"
  [ -n "${aufgeloest}" ] || { echo "compose config lieferte nichts"; return 1; }
  # caddy muss auf 8082 veröffentlicht sein …
  echo "${aufgeloest}" | grep -q 'published: "8082"' || { echo "keine Bindung auf 8082:"; echo "${aufgeloest}"; return 1; }
  # … und die Datenbank gar nicht.
  ! echo "${aufgeloest}" | grep -q 'published: "5432"' || { echo "die alte Datenbank hat noch einen Host-Port"; return 1; }
  rm -rf "${sandbox_aus}"
}
pruefe "port80: compose löst die Bindung des Altprojekts wirklich auf 8082 auf" t_port80_bindung_wird_von_compose_wirklich_gesetzt

t_schritt3_nach_port80_laesst_die_adressen_stehen() {
  # Am 2026-09-24 im Betrieb passiert: Nach dem Portwechsel wurde `schritt 3`
  # gefahren, um neuen Code auszuliefern. h_3_env setzte die Adressen aus der
  # Konfiguration neu — die Plattform sprang von Port 80 zurück auf 8081, Port
  # 80 war leer, und alle fünf Tafeln liefen ins Nichts.
  port80_lage
  h_port80 >/dev/null
  pe="${BASIS}/acm-plattform/.env"
  gleich "$(env_lesen "$pe" CADDY_HTTP_PORT)" 80

  # Jetzt der Auslieferungsschritt, wie er nach einem Merge gefahren wird.
  mkdir -p "${BASIS}/acm-plattform/infra/supabase/upstream"
  echo v1 > "${BASIS}/acm-plattform/infra/supabase/UPSTREAM_TAG"
  echo v1 > "${BASIS}/acm-plattform/infra/supabase/upstream/UPSTREAM_TAG"
  h_3_env >/dev/null

  # Die Adressen müssen die des Portwechsels geblieben sein.
  gleich "$(env_lesen "$pe" CADDY_HTTP_PORT)" 80
  gleich "$(env_lesen "$pe" SITE_URL)" http://192.9.201.9
  gleich "$(env_lesen "$pe" API_EXTERNAL_URL)" http://192.9.201.9/supabase/auth/v1
  # Der Aussteller im Signage-Stack darf dadurch nicht auseinanderlaufen.
  gleich "$(env_lesen "${BASIS}/acm-signage/.env" PLATFORM_JWT_ISSUER)" "$(env_lesen "$pe" API_EXTERNAL_URL)"
}
pruefe "Schritt 3 nach dem Portwechsel: Adressen bleiben auf Port 80" t_schritt3_nach_port80_laesst_die_adressen_stehen

t_schritt3_vor_port80_setzt_die_adressen_wie_bisher() {
  # Ohne vorangegangenen Portwechsel muss Schritt 3 die Adressen weiterhin setzen.
  port80_lage
  pe="${BASIS}/acm-plattform/.env"
  printf 'CADDY_HTTP_PORT=irgendwas\n' > "$pe"
  mkdir -p "${BASIS}/acm-plattform/infra/supabase/upstream"
  echo v1 > "${BASIS}/acm-plattform/infra/supabase/UPSTREAM_TAG"
  echo v1 > "${BASIS}/acm-plattform/infra/supabase/upstream/UPSTREAM_TAG"
  h_3_env >/dev/null
  gleich "$(env_lesen "$pe" CADDY_HTTP_PORT)" 8081
  gleich "$(env_lesen "$pe" SITE_URL)" http://192.9.201.9:8081
}
pruefe "Schritt 3 ohne Portwechsel: Adressen werden wie bisher gesetzt" t_schritt3_vor_port80_setzt_die_adressen_wie_bisher

# --- Ablauf auf dem Mac ------------------------------------------------------

CUTOVER_NICHT_STARTEN=1 . "${CUTOVER}/cutover.sh"

t_einstufung_der_pi_adressen() {
  export HOST_IP=192.9.201.9 SIGNAGE_PORT=8080
  gleich "$(pi_einstufen http://192.9.201.9:8000)" api
  gleich "$(pi_einstufen http://192.9.201.9)" caddy
  gleich "$(pi_einstufen http://192.9.201.9:80)" caddy
  gleich "$(pi_einstufen http://192.9.201.9:8080)" neu
  gleich "$(pi_einstufen http://kpi.intern:8080)" unbekannt
}
pruefe "0b: Pi-Adressen eingestuft (API direkt, alter Caddy, schon neu)" t_einstufung_der_pi_adressen

t_reihenfolge() {
  gleich "$(reihenfolge caddy | tr '\n' ' ')" "vorab 0 0b 1a 1b 1c 2 3 4a 4b 4d 5 port80 6 pruefen "
  gleich "$(reihenfolge api | tr '\n' ' ')" "vorab 0 0b 3 4d 5 1a 1b 1c 2 4a 4b port80 6 pruefen "
}
pruefe "Reihenfolge: Signage zuerst, wenn ein Pi direkt auf :8000 zeigt" t_reihenfolge

t_haltepunkt_braucht_ja() {
  sandbox
  export CUTOVER_EINGABE="${SANDBOX}/eingabe"
  echo ja > "${CUTOVER_EINGABE}"; haltepunkt "Test" >/dev/null
  echo j > "${CUTOVER_EINGABE}"; ! haltepunkt "Test" >/dev/null 2>&1 || return 1
  : > "${CUTOVER_EINGABE}"; ! haltepunkt "Test" >/dev/null 2>&1
}
pruefe "Haltepunkt: nur ein ausgeschriebenes «ja» geht weiter" t_haltepunkt_braucht_ja

t_fernaufruf_lokal_uebergibt_variablen_gequotet() {
  sandbox; export HOST=local HOST_IP="192.9.201.9" PLATTFORM_PORT=8081 SIGNAGE_PORT=8080
  f="${SANDBOX}/.env"; : > "$f"
  fern env_setzen "$f" A 'zwei worte $dollar "und" '"'"'so'"'"
  gleich "$(env_lesen "$f" A)" 'zwei worte $dollar "und" '"'"'so'"'"
  enthaelt "$(fern h_konfig)" "HOST_IP=192.9.201.9"
  enthaelt "$(fern h_konfig)" "BASIS=${BASIS}"
}
pruefe "Fernaufruf: Argumente und Konfiguration kommen unverändert an" t_fernaufruf_lokal_uebergibt_variablen_gequotet

echo
echo "${BESTANDEN} bestanden, ${FEHLER} fehlgeschlagen"
[ "${FEHLER}" -eq 0 ]
