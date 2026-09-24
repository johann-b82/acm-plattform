#!/usr/bin/env bash
# Jede App, deren Stufe der Web-Code prüft, muss in `public.apps` stehen.
#
# Fehlt der Eintrag, ist das doppelt unsichtbar: kein Kachel auf dem Starter,
# und weil `app_grants.app_id` auf `apps.id` verweist, lässt sich die Stufe
# gar nicht vergeben — die Seite bleibt Plattform-Admins vorbehalten, die
# überall `admin` bekommen. Genau so war Digital Signage erreichbar, aber nicht
# zuteilbar.
#
# Der Abgleich läuft hier und nicht in der pytest-Suite: dort liegt nur
# `services/compute` im Bild, die Web-Quellen fehlen, und der Test würde still
# übersprungen.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fehler=0

# hasLevel(apps, "signage", "admin") → signage
aus_code="$(grep -rhoE 'hasLevel\(\s*[A-Za-z_.]+\s*,\s*"[a-z_]+"' \
              "${ROOT}/apps/web/src" --include='*.ts' --include='*.tsx' 2>/dev/null \
            | grep -oE '"[a-z_]+"$' | tr -d '"' | sort -u || true)"

# insert- und update-Zeilen der Migrationen: ('signage', 'Digital Signage', …
in_db="$(grep -rhoE "\('[a-z_]+',\s*'[^']+',\s*'/[a-z_/]*'" \
           "${ROOT}/services/compute/alembic/versions" 2>/dev/null \
         | grep -oE "^\('[a-z_]+'" | tr -d "('" | sort -u || true)"

if [ -z "${aus_code}" ]; then
  echo "  ✗ keine hasLevel-Aufrufe gefunden — prüft dieses Skript noch das Richtige?" >&2
  exit 1
fi

fehlend="$(comm -23 <(echo "${aus_code}") <(echo "${in_db}") || true)"
if [ -n "${fehlend}" ]; then
  echo "  ✗ der Web-Code prüft Stufen, die keine App in public.apps haben:" >&2
  echo "${fehlend}" | sed 's/^/      /' >&2
  echo "    Ohne Eintrag gibt es weder Kachel noch vergebbare Stufe." >&2
  fehler=1
fi

if [ "${fehler}" -eq 0 ]; then
  echo "  ✓ jede geprüfte App-Stufe hat ihren Eintrag ($(echo "${aus_code}" | tr '\n' ' '))"
fi
exit "${fehler}"
