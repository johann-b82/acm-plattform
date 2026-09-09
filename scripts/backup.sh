#!/usr/bin/env bash
# Sicherung der Plattform-Datenbank.
#
# Gesichert werden `public`, `auth` und `storage` — mehr nicht, aber auch
# nicht weniger. Die Anmeldedaten liegen in `auth`, die Dateien in `storage`;
# ein Abzug ohne sie liesse sich nicht zu einer benutzbaren Plattform
# zurueckspielen. Alles andere (`cron`, `realtime`, `vault`, `extensions`)
# legt das Supabase-Abbild beim Start selbst an — im Abzug fuehrt es beim
# Zurueckspielen nur zu Kollisionen. Gemessen: 47 Fehlermeldungen mit dem
# vollen Abzug, 7 harmlose mit diesem.
#
# Bewusst nicht eingeplant (Entscheidung F: vorbereiten, nicht anwenden).
# Zum Einplanen siehe docs/setup.md, Abschnitt "Sicherung".
#
# Aufruf: scripts/backup.sh [zielverzeichnis]
set -euo pipefail
umask 077   # Befund 18 im Altprojekt: Sicherungen lagen mit 0644 herum.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

ZIEL="${1:-${BACKUP_DIR:-./backups}}"
AUFBEWAHRUNG_TAGE="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "${ZIEL}"

DATUM="$(date +%F-%H%M)"
AUS="${ZIEL}/acm-${DATUM}.dump"
TMP="${AUS}.tmp"

# Ein abgebrochener Lauf darf keine halbe Datei hinterlassen, die spaeter wie
# eine gueltige Sicherung aussieht. Im Altprojekt sammelten sich genau solche
# Reste an, weil die Aufraeumregel sie nicht traf.
trap 'rm -f "${TMP}"' EXIT

echo "[sicherung] Abzug nach ${AUS}"
# pg_dump laeuft im Datenbank-Container, damit Werkzeug und Server dieselbe
# Version haben. Kein `| gzip`: unter `set -e` zaehlt nur der letzte Befehl
# einer Pipe, ein fehlgeschlagener Abzug wuerde als Erfolg umbenannt.
# Format `custom` ist bereits komprimiert und erlaubt gezieltes Zurueckspielen.
docker compose exec -T db pg_dump -U postgres -d postgres -Fc -Z 6 \
    -n public -n auth -n storage > "${TMP}"

# Ein leerer oder abgeschnittener Abzug ist kein gueltiger Abzug.
docker compose exec -T db pg_restore --list < "${TMP}" > /dev/null

mv "${TMP}" "${AUS}"
trap - EXIT

find "${ZIEL}" -maxdepth 1 -name 'acm-*.dump*' -mtime "+${AUFBEWAHRUNG_TAGE}" -delete
echo "[sicherung] fertig: $(du -h "${AUS}" | cut -f1)"
