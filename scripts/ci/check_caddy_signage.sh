#!/usr/bin/env bash
# Der Player-Weg muss unter demselben Origin liegen wie die Plattform, und die
# Reihenfolge der handle-Blöcke muss stimmen.
#
# Hintergrund: Der Player hält sein Gerätetoken im localStorage, der am Origin
# hängt. Läuft der Player-Weg über einen anderen Port, ist der Speicher leer
# und jeder Bildschirm zeigt einen Kopplungscode. Caddy wertet handle-Blöcke
# in Reihenfolge aus — stünde /api/signage/* zuerst, ginge die Geräte-API über
# `web`, das eine angemeldete Person verlangt, und die Tafeln bekämen 401.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATEI="${ROOT}/infra/caddy/Caddyfile"
fehler=0

zeile_von() {  # muster → Zeilennummer des ersten Treffers, sonst leer
  grep -nE "$1" "${DATEI}" | head -1 | cut -d: -f1
}

melde() { echo "  ✗ $1" >&2; fehler=1; }

for pfad in '/player/\*' '/api/signage/player/\*' '/api/signage/pair/\*'; do
  [ -n "$(zeile_von "handle ${pfad}")" ] || melde "kein handle-Block für ${pfad//\\/}"
done

spieler="$(zeile_von 'handle /api/signage/player/\*')"
verwaltung="$(zeile_von 'handle /api/signage/\*')"
if [ -n "${spieler}" ] && [ -n "${verwaltung}" ] && [ "${spieler}" -gt "${verwaltung}" ]; then
  melde "handle /api/signage/player/* (Zeile ${spieler}) steht NACH /api/signage/* (Zeile ${verwaltung}) — die Geräte-API liefe über web und die Tafeln bekämen 401"
fi

# Der Geräteweg darf nicht über die Anwendung laufen: fällt sie aus, sollen die
# Tafeln weiterlaufen. Geprüft wird der Inhalt *jedes einzelnen* Blocks, von
# seiner öffnenden bis zur zugehörigen schließenden Klammer.
block_inhalt() {  # handle-Muster → Zeilen zwischen den Klammern
  awk -v muster="$1" '
    $0 ~ muster && /\{/ { tiefe = 1; next }
    tiefe > 0 {
      tiefe += gsub(/\{/, "{") - gsub(/\}/, "}")
      if (tiefe <= 0) exit
      print
    }' "${DATEI}"
}

for pfad in 'handle /player/\*' 'handle /api/signage/player/\*' 'handle /api/signage/pair/\*'; do
  inhalt="$(block_inhalt "${pfad}")"
  [ -n "${inhalt}" ] || continue
  if echo "${inhalt}" | grep -q 'web:3000'; then
    melde "${pfad//\\/} zeigt auf web:3000 statt direkt auf den Signage-Stack"
  fi
  echo "${inhalt}" | grep -qE 'import signage_direkt|reverse_proxy' \
    || melde "${pfad//\\/} reicht nirgendwohin weiter"
done

# SSE: ohne das puffert Caddy den Stream und die Tafeln bleiben stehen.
grep -q 'flush_interval -1' "${DATEI}" || melde "flush_interval -1 fehlt — der SSE-Stream würde gepuffert"

# Caddy muss den Signage-Stack überhaupt erreichen können.
grep -q 'host.docker.internal:host-gateway' "${ROOT}/docker-compose.yml" \
  || melde "dem caddy-Dienst fehlt extra_hosts host.docker.internal"

if [ "${fehler}" -eq 0 ]; then echo "  ✓ Player-Weg liegt unter demselben Origin, Reihenfolge stimmt"; fi
exit "${fehler}"
