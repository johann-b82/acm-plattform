#!/usr/bin/env bash
# Baut den Stack und raeumt danach die Reste des vorigen Standes weg.
#
# Warum ueberhaupt ein Wrapper um `docker compose up -d --build`:
# Jeder Build haengt neue Layer an und laesst die alten als verwaiste
# ("dangling") Images und als Build-Cache liegen. Beides wird nie von selbst
# frei. Auf einem Entwicklungsrechner, auf dem taeglich gebaut wird, sind das
# schnell zweistellige Gigabyte — gemessen: 2,8 GB Build-Cache aus einem
# einzigen Tag.
#
# Aufgeraeumt wird erst NACH einem erfolgreichen Build (set -e). Schlaegt der
# Build fehl, bleibt der Cache liegen — genau dann wird er fuer den naechsten
# Versuch gebraucht.
#
# Bewusst NICHT `docker builder prune -a`: das loescht auch den Cache des
# gerade gelaufenen Builds, und der naechste Build faengt bei null an. Es
# faellt nur, was aelter ist als BUILD_CACHE_TTL.
#
# Bewusst NICHT `docker system prune --volumes`: das traefe die anonymen
# Volumes des Supabase-Stacks. Siehe docs/logging.md.
#
# Aufruf:  bash scripts/build.sh [dienst ...]
#          BUILD_CACHE_TTL=24h bash scripts/build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

# Alles aelter als dieses Fenster fliegt raus. Eine Woche laesst den Cache
# eines normalen Arbeitstages stehen und raeumt trotzdem regelmaessig ab.
TTL="${BUILD_CACHE_TTL:-168h}"

docker compose up -d --build "$@"

echo
echo "Build fertig — raeume den vorigen Stand ab (Cache aelter als ${TTL})."

# Verwaiste Images: die unbenannten Vorgaenger der eben gebauten Abbilder.
# Nur `dangling`, nie `-a` — `-a` naehme auch die gepinnten Supabase-Abbilder
# mit, die gerade kein Container haelt, und der naechste Start zoege sie neu.
docker image prune -f

# Build-Cache nach Alter. `-f` fragt nicht nach.
docker builder prune -f --filter "until=${TTL}"

echo
docker system df

# Auf Windows (WSL2-Backend) gibt das Aufraeumen den Platz nur innerhalb der
# virtuellen Platte frei. Die Datei docker_data.vhdx auf C: behaelt ihren
# Hoechststand und schrumpft nie von selbst — das ist der eigentliche Grund,
# warum dort die Systemplatte volllaeuft. Sie muss getrennt kompaktiert
# werden. Siehe docs/setup.md, Abschnitt "Platz zurueckgewinnen".
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    echo
    echo "Hinweis Windows: Das gibt den Platz nur INNERHALB der virtuellen"
    echo "Platte frei. docker_data.vhdx auf C: schrumpft dabei nicht."
    echo "Zum Kompaktieren siehe docs/setup.md, 'Platz zurueckgewinnen'."
    ;;
esac
