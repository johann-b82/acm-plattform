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
  enthaelt "$a" "docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.prod.yml up -d --build"
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

t_1c_zurueck_stellt_alles_wieder_her() {
  sandbox; altprojekt_anlegen; neuer_klon_anlegen; h_1a abc1234
  h_1c_umschalten
  h_1c_zurueck
  [ -f "${BASIS}/lumeapps/backend/media/slides/abc/1.png" ] && [ -d "${BASIS}/lumeapps/postgres_data" ]
  [ ! -e "${BASIS}/lumeapps-neu/postgres_data" ]
  enthaelt "$(tail -1 "${AUFRUFE}")" "docker compose up -d"
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
  printf 'CADDY_HTTP_PORT=80\nSITE_URL=http://localhost\nSUPABASE_PUBLIC_URL=http://localhost/supabase\nAPI_EXTERNAL_URL=http://localhost/supabase/auth/v1\nJWT_SECRET=\nEMBED_SECRET=\nGEHEIM_SCHLUESSEL=\nEMBED_FRAME_ANCESTORS=*\n' > "$p/.env.example"
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
  [ -n "$(env_lesen "$e" EMBED_SECRET)" ] && [ -n "$(env_lesen "$e" GEHEIM_SCHLUESSEL)" ]
  # zweiter Lauf behält die Secrets
  vorher="$(env_lesen "$e" EMBED_SECRET)"; h_3_env
  gleich "$(env_lesen "$e" EMBED_SECRET)" "$vorher"
}
pruefe "3: Adressen mit Port und Pfad, Secrets einmalig erzeugt" t_3_env_setzt_adressen_und_erzeugt_secrets

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
  gleich "$(reihenfolge caddy | tr '\n' ' ')" "vorab 0 0b 1a 1b 1c 2 3 4a 4b 4d 5 6 pruefen "
  gleich "$(reihenfolge api | tr '\n' ' ')" "vorab 0 0b 3 4d 5 1a 1b 1c 2 4a 4b 6 pruefen "
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
