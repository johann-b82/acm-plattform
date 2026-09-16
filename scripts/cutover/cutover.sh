#!/usr/bin/env bash
# Stichtag nach docs/cutover.md, vom Mac aus gesteuert.
#
#   bash scripts/cutover/cutover.sh plan                 Reihenfolge und Stand
#   bash scripts/cutover/cutover.sh lauf [--bis SCHRITT]  alles Offene der Reihe nach
#   bash scripts/cutover/cutover.sh schritt SCHRITT       genau einen Schritt (auch erneut)
#   bash scripts/cutover/cutover.sh zurueck 1c            Altprojekt zurück in den alten Baum
#   bash scripts/cutover/cutover.sh zurueck 5 [PI]        Pis zurück auf die alte Adresse
#
# Konfiguration: scripts/cutover/cutover.conf (Vorlage cutover.conf.example),
# anderer Ort mit -c DATEI. Erledigte Schritte merkt sich der Host unter
# $BASIS/.cutover — ein abgebrochener Lauf setzt dort fort.
#
# Vor jedem Ausfall, jedem echten Datenlauf und jedem Pi hält das Skript an
# und verlangt ein ausgeschriebenes «ja». Secrets liest es auf dem Host aus den
# .env-Dateien; sie laufen nie über den Mac und erscheinen in keiner Ausgabe.
#
# Läuft mit dem Bash 3.2 von macOS.
set -uo pipefail

CUTOVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Konfiguration ------------------------------------------------------------

konfiguration_laden() {  # datei
  [ -f "$1" ] || { echo "Konfiguration fehlt: $1 (Vorlage: ${CUTOVER_DIR}/cutover.conf.example)" >&2; exit 2; }
  # shellcheck disable=SC1090
  . "$1"
  : "${HOST:?HOST fehlt}" "${HOST_IP:?HOST_IP fehlt}"
  BASIS="${BASIS:-/home/acm}"
  PLATTFORM_PORT="${PLATTFORM_PORT:-8081}"
  SIGNAGE_PORT="${SIGNAGE_PORT:-8080}"
  HOST_SSH_OPTS="${HOST_SSH_OPTS:-}"
  PIS="${PIS:-}"; PI_SSH_OPTS="${PI_SSH_OPTS:-}"
  REPO_LUMEAPPS="${REPO_LUMEAPPS:?REPO_LUMEAPPS fehlt}"; REF_LUMEAPPS="${REF_LUMEAPPS:-origin/main}"
  REPO_PLATTFORM="${REPO_PLATTFORM:?REPO_PLATTFORM fehlt}"; REF_PLATTFORM="${REF_PLATTFORM:-origin/main}"
  REPO_SIGNAGE="${REPO_SIGNAGE:?REPO_SIGNAGE fehlt}"; REF_SIGNAGE="${REF_SIGNAGE:-origin/main}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-}"
  PORTPRUEFUNG="${PORTPRUEFUNG:-an}"
  CACHE="${CACHE:-${HOME}/.cache/acm-cutover}"
  export BASIS HOST_IP PLATTFORM_PORT SIGNAGE_PORT
}

# --- Transport ----------------------------------------------------------------

ssh_host() {  # befehl-als-string
  # shellcheck disable=SC2086
  if [ "${HOST}" = local ]; then bash -c "$1"; else ssh ${HOST_SSH_OPTS} "${HOST}" "$1"; fi
}

fern() {  # funktion args... — läuft auf dem Host, mit host.sh
  local a skript
  skript="$(
    printf 'BASIS=%q HOST_IP=%q PLATTFORM_PORT=%q SIGNAGE_PORT=%q\n' "${BASIS}" "${HOST_IP}" "${PLATTFORM_PORT}" "${SIGNAGE_PORT}"
    printf 'set -o pipefail\n'
    cat "${CUTOVER_DIR}/host.sh"
    for a in "$@"; do printf '%q ' "$a"; done; echo
  )"
  # shellcheck disable=SC2086
  if [ "${HOST}" = local ]; then printf '%s\n' "${skript}" | bash -s
  else printf '%s\n' "${skript}" | ssh ${HOST_SSH_OPTS} "${HOST}" bash -s; fi
}

pi_fern() {  # pi funktion args...
  local pi="$1" a skript; shift
  skript="$(
    [ -n "${PI_UNIT_DIR:-}" ] && printf 'PI_UNIT_DIR=%q\n' "${PI_UNIT_DIR}"
    [ -n "${PI_WARTEN:-}" ] && printf 'PI_WARTEN=%q\n' "${PI_WARTEN}"
    cat "${CUTOVER_DIR}/pi.sh"
    for a in "$@"; do printf '%q ' "$a"; done; echo
  )"
  # shellcheck disable=SC2086
  if [ "${pi}" = local ]; then printf '%s\n' "${skript}" | bash -s
  else printf '%s\n' "${skript}" | ssh ${PI_SSH_OPTS} "${pi}" bash -s; fi
}

code_zum_host() {  # repo ref zielverzeichnis — git archive, der Host braucht kein GitHub-Konto
  local ziel; ziel="$(printf '%q' "$3")"
  git -C "$1" archive --format=tar "$2" | ssh_host "mkdir -p ${ziel} && tar -x -C ${ziel}"
}

# --- Bedienung ----------------------------------------------------------------

titel() { printf '\n══ %s ══\n' "$*"; }

haltepunkt() {  # text
  local eingabe="${CUTOVER_EINGABE:-/dev/tty}" antwort=""
  printf '\n┌─ HALT ─────────────────────────────────────────────\n'
  printf '%s\n' "$1" | sed 's/^/│ /'
  printf '└─ Weiter? «ja» eintippen: '
  read -r antwort < "${eingabe}" || antwort=""
  [ "${antwort}" = ja ] || { echo "Abgebrochen."; return 1; }
}

# --- Pi-Adressen --------------------------------------------------------------

pi_einstufen() {  # url → api | caddy | neu | unbekannt
  local rest hostteil name port
  rest="${1#*://}"; hostteil="${rest%%/*}"; name="${hostteil%%:*}"
  if [ "${hostteil}" = "${name}" ]; then case "$1" in https://*) port=443;; *) port=80;; esac
  else port="${hostteil##*:}"; fi
  [ "${name}" = "${HOST_IP}" ] || { echo unbekannt; return; }
  case "${port}" in
    8000) echo api;;
    "${SIGNAGE_PORT}") echo neu;;
    80) echo caddy;;
    *) echo unbekannt;;
  esac
}

reihenfolge() {  # api | caddy
  if [ "$1" = api ]; then
    printf '%s\n' vorab 0 0b 3 4d 5 1a 1b 1c 2 4a 4b 6 pruefen
  else
    printf '%s\n' vorab 0 0b 1a 1b 1c 2 3 4a 4b 4d 5 6 pruefen
  fi
}

# --- Schritte -----------------------------------------------------------------

schritt_vorab() {
  local rc=0 r pi
  for r in "${REPO_LUMEAPPS}:${REF_LUMEAPPS}" "${REPO_PLATTFORM}:${REF_PLATTFORM}" "${REPO_SIGNAGE}:${REF_SIGNAGE}"; do
    git -C "${r%%:*}" rev-parse --verify -q "${r#*:}^{commit}" >/dev/null \
      && echo "  ✓ $(basename "${r%%:*}") @ ${r#*:} = $(git -C "${r%%:*}" rev-parse --short "${r#*:}")" \
      || { echo "  ✗ ${r#*:} fehlt in ${r%%:*} (git fetch?)"; rc=1; }
  done
  for w in npm rsync nc; do command -v "$w" >/dev/null || { echo "  ✗ $w fehlt auf dem Mac"; rc=1; }; done
  fern h_vorab || rc=1
  for pi in ${PIS}; do
    pi_fern "${pi}" p_adresse >/dev/null 2>&1 && echo "  ✓ Pi ${pi} erreichbar" || { echo "  ✗ Pi ${pi} nicht erreichbar"; rc=1; }
  done
  [ -n "${PIS}" ] || echo "  – keine Pis konfiguriert: 0b und 5 fragen von Hand"
  return $rc
}

schritt_0() { fern h_sicherung; }

schritt_0b() {
  local pi adresse stufe ergebnis=caddy
  if [ -z "${PIS}" ]; then
    printf 'Adresse aus SIGNAGE_API_BASE eines Pis (z. B. http://%s:8000): ' "${HOST_IP}"
    read -r adresse < "${CUTOVER_EINGABE:-/dev/tty}" || return 1
    ergebnis="$(pi_einstufen "${adresse}")"
  else
    for pi in ${PIS}; do
      adresse="$(pi_fern "${pi}" p_adresse)" || { echo "  ✗ ${pi} nicht lesbar"; return 1; }
      stufe="$(pi_einstufen "${adresse}")"
      echo "  ${pi}: ${adresse} → ${stufe}"
      case "${stufe}" in
        api) ergebnis=api;;
        unbekannt) ergebnis=unbekannt; break;;
      esac
    done
  fi
  case "${ergebnis}" in
    unbekannt) echo "  ✗ Adresse zeigt weder auf :8000, :80 noch den neuen Stack — von Hand klären"; return 1;;
    api) echo "  → Pis sprechen direkt mit :8000. Signage zieht vor der Härtung um.";;
    *) echo "  → Pis gehen über Caddy (oder sind schon umgestellt). Reihenfolge wie in docs/cutover.md.";;
  esac
  fern h_marke_setzen 0b "${ergebnis}"
}

schritt_1a() {
  fern h_existiert lumeapps-neu && { echo "  ✗ ${BASIS}/lumeapps-neu gibt es schon, 1a ist aber nicht als erledigt markiert — von Hand prüfen"; return 1; }
  local sha; sha="$(git -C "${REPO_LUMEAPPS}" rev-parse --short "${REF_LUMEAPPS}")"
  code_zum_host "${REPO_LUMEAPPS}" "${REF_LUMEAPPS}" "${BASIS}/lumeapps-neu" || return 1
  fern h_1a "${sha}"
}

schritt_1b() {
  local sha dist tmp
  sha="$(fern h_lesen lumeapps-neu/DEPLOYED_COMMIT)" || return 1
  dist="${CACHE}/lumeapps-${sha}/dist"
  if [ ! -f "${dist}/player/index.html" ]; then
    echo "  baue Oberfläche ${sha} auf dem Mac (nicht auf dem Host: 6 GB Heap)"
    tmp="$(mktemp -d)"
    git -C "${REPO_LUMEAPPS}" archive "${sha}" | tar -x -C "${tmp}" || return 1
    (cd "${tmp}/frontend" && npm ci --no-audit --no-fund && NODE_OPTIONS="--max-old-space-size=6144" npm run build) || return 1
    mkdir -p "$(dirname "${dist}")" && rm -rf "${dist}" && mv "${tmp}/frontend/dist" "${dist}" && rm -rf "${tmp}"
  else
    echo "  Oberfläche ${sha} schon gebaut: ${dist}"
  fi
  # shellcheck disable=SC2086
  if [ "${HOST}" = local ]; then rsync -a --delete "${dist}/" "${BASIS}/lumeapps-neu/frontend/dist/"
  else rsync -a --delete -e "ssh ${HOST_SSH_OPTS}" "${dist}/" "${HOST}:${BASIS}/lumeapps-neu/frontend/dist/"; fi || return 1
  fern h_1b_pruefen
}

schritt_1c() {
  haltepunkt "Das Altprojekt geht herunter und startet gehärtet aus ${BASIS}/lumeapps-neu.
Ausfall: Sekunden bis eine Minute. Bildschirme, die über Caddy laufen, sind kurz schwarz.
Rückweg: cutover.sh zurueck 1c" || return 1
  fern h_1c_umschalten || { echo "  ✗ Umschalten gescheitert"; umschalten_zurueck_anbieten; return 1; }
  if ! fern h_1c_pruefen; then umschalten_zurueck_anbieten; return 1; fi
  if [ "${PORTPRUEFUNG}" != aus ]; then
    local p rc=0
    nc -z -G 3 "${HOST_IP}" 80 && echo "  ✓ :80 offen" || { echo "  ✗ :80 zu"; rc=1; }
    for p in 5173 8000; do nc -z -G 3 "${HOST_IP}" "$p" && { echo "  ✗ :$p noch offen"; rc=1; } || echo "  ✓ :$p zu"; done
    [ $rc -eq 0 ] || { umschalten_zurueck_anbieten; return 1; }
  fi
  echo "  Beobachten in der ersten Stunde: Sitzungen laufen nach 8 statt 24 Stunden ab; Kiosk-Fotos nur für gezeigte Personen."
}

umschalten_zurueck_anbieten() {
  haltepunkt "Prüfung nicht bestanden. Zurück in den alten Baum?" && fern h_1c_zurueck
}

schritt_2() {
  haltepunkt "Zertifikat rotieren — von Hand, docs/cutover.md § 2 und lumeapps/certs/README.md.
Neues Material nach /home/acm/certs, in Caddy per Pfad einbinden.
«ja», wenn erledigt oder bewusst verschoben."
}

schritt_3() {
  code_zum_host "${REPO_PLATTFORM}" "${REF_PLATTFORM}" "${BASIS}/acm-plattform" || return 1
  fern h_3_env || return 1
  fern h_3_start || return 1
  if [ -n "${ADMIN_EMAIL}" ]; then
    local pw="${CUTOVER_ADMIN_PASSWORT:-}"
    if [ -z "${pw}" ]; then
      printf 'Passwort für den Plattform-Admin %s (wird nicht angezeigt): ' "${ADMIN_EMAIL}"
      stty -echo < /dev/tty 2>/dev/null; read -r pw < /dev/tty; stty echo < /dev/tty 2>/dev/null; echo
    fi
    [ -n "${pw}" ] || { echo "  ✗ kein Passwort"; return 1; }
    fern h_3_admin "${ADMIN_EMAIL}" "${pw}"
  fi
}

schritt_4a() {
  fern h_4a_trocken || return 1
  haltepunkt "Oben die Zählung des Trockenlaufs. Jetzt echt:
- Zieltabellen der Plattform werden geleert und neu befüllt (--leeren)
- neue Zugänge bekommen Passwörter, Liste nur auf dem Host
- Abgleich alt gegen neu, Abbruch bei Abweichung" || return 1
  fern h_4a_echt
}

schritt_4b() {
  fern h_4b || return 1
  echo "  Von Hand (docs/cutover.md § 4b/4c): Firmenlogo in den Eimer «plattform», ATR-Eingangsordner unter /einstellungen#atr."
}

schritt_4d() {
  code_zum_host "${REPO_SIGNAGE}" "${REF_SIGNAGE}" "${BASIS}/acm-signage" || return 1
  fern h_4d_env || return 1
  fern h_4d_start || return 1
  fern h_4d_trocken || return 1
  haltepunkt "Oben die Zählung des Trockenlaufs. Jetzt echt: neun signage_*-Tabellen in einer Transaktion, Medien und Folien umziehen." || return 1
  fern h_4d_echt || return 1
  fern h_4d_pruefen || return 1
  echo "  Von Hand: HR-Tafeln unter /einstellungen#anzeigen neu erzeugen und in die Playlist-Einträge setzen (docs/cutover.md § 4d)."
}

schritt_5() {
  local neu="http://${HOST_IP}:${SIGNAGE_PORT}" pi erster="" rest=""
  if [ -z "${PIS}" ]; then
    haltepunkt "Keine Pis konfiguriert. Auf jedem Pi (docs/cutover.md § 5):
  sudo SIGNAGE_API_URL=${neu} /opt/signage/scripts/provision-pi.sh
und Sidecar + Player neu starten. «ja», wenn alle online sind."
    return
  fi
  for pi in ${PIS}; do if [ -z "${erster}" ]; then erster="${pi}"; else rest="${rest} ${pi}"; fi; done
  haltepunkt "Erster Pi ${erster} → ${neu}. Der Bildschirm lädt neu." || return 1
  pi_umstellen "${erster}" "${neu}" || return 1
  [ -n "${rest}" ] || return 0
  haltepunkt "${erster} ist online. Jetzt die übrigen:${rest}" || return 1
  for pi in ${rest}; do pi_umstellen "${pi}" "${neu}" || return 1; done
}

pi_umstellen() {  # pi adresse
  pi_fern "$1" p_umstellen "$2" && return 0
  haltepunkt "$1 kommt nicht online. Zurück auf die alte Adresse?" && pi_fern "$1" p_zurueck
  return 1
}

schritt_6() {
  haltepunkt "Host-Vorlagen brauchen sudo mit Passwort — von Hand, und der Docker-Daemon startet neu (beide Stacks kurz weg):
  sudo cp ${BASIS}/acm-plattform/infra/host/daemon.json /etc/docker/daemon.json
  sudo cp ${BASIS}/acm-plattform/infra/host/journald-docker.conf /etc/systemd/journald.conf.d/
  sudo systemctl restart systemd-journald docker
«ja», wenn erledigt oder bewusst verschoben."
}

schritt_pruefen() {
  local rc=0 pi
  fern h_pruefen || rc=1
  for pi in ${PIS}; do
    pi_fern "${pi}" p_adresse | sed "s|^|  ${pi}: |"
  done
  cat <<EOF
  Von Hand gegenprüfen:
  - Bildschirme zeigen Inhalt, PPTX-Folien und HR-Tafeln nicht leer
  - Anmeldung einer übernommenen Person, Kacheln passen zur Gruppe
  - Kennzahlen Vertrieb wie im Altprojekt
  - Log-Wachstum nach einem Tag
EOF
  return $rc
}

# --- Ablauf -------------------------------------------------------------------

ausfuehren() {  # schritt
  titel "Schritt $1"
  if "schritt_$1"; then
    [ "$1" = vorab ] || [ "$1" = 0b ] || fern h_marke_setzen "$1"
    return 0
  fi
  echo "✗ Schritt $1 nicht abgeschlossen. Fortsetzen mit: cutover.sh lauf"
  return 1
}

modus() { fern h_marke_lesen 0b 2>/dev/null || echo caddy; }

befehl_plan() {
  local s m stand; m="$(modus)"
  stand="$(fern h_marken)"
  echo "Modus nach 0b: ${m}"
  for s in $(reihenfolge "${m}"); do
    if printf '%s\n' "${stand}" | grep -q "^${s}  "; then echo "  ✓ ${s}"; else echo "  · ${s}"; fi
  done
}

befehl_lauf() {  # [--bis schritt]
  local bis="" s
  [ "${1:-}" = --bis ] && bis="${2:?Schritt fehlt}"
  ausfuehren vorab || return 1
  for s in 0 0b; do
    if [ -z "$(fern h_marke_lesen "$s" 2>/dev/null)" ]; then ausfuehren "$s" || return 1; fi
    [ "$s" = "$bis" ] && return 0
  done
  for s in $(reihenfolge "$(modus)" | sed '1,3d'); do
    if [ -n "$(fern h_marke_lesen "$s" 2>/dev/null)" ]; then echo "· $s schon erledigt"
    else ausfuehren "$s" || return 1; fi
    [ "$s" = "$bis" ] && return 0
  done
  titel "Fertig"
}

main() {
  local conf="${CUTOVER_DIR}/cutover.conf"
  [ "${1:-}" = -c ] && { conf="$2"; shift 2; }
  konfiguration_laden "${conf}"
  case "${1:-}" in
    plan) befehl_plan;;
    lauf) shift; befehl_lauf "$@";;
    schritt) ausfuehren "${2:?Schritt fehlt}";;
    zurueck)
      case "${2:-}" in
        1c) haltepunkt "Altprojekt zurück nach ${BASIS}/lumeapps (Ausfall)." && fern h_1c_zurueck;;
        5) local pi; for pi in ${3:-${PIS}}; do pi_fern "${pi}" p_zurueck || return 1; done;;
        *) echo "zurueck 1c | zurueck 5 [PI]" >&2; return 2;;
      esac;;
    *) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; return 2;;
  esac
}

[ -n "${CUTOVER_NICHT_STARTEN:-}" ] || main "$@"
