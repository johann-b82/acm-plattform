#!/usr/bin/env bash
# Fährt cutover.sh komplett gegen die nachgebaute Umgebung und beantwortet jeden
# Haltepunkt mit «ja». Vorher: bash up.sh. Ausgabe zusätzlich nach .work/lauf.log.
#
#   bash lauf.sh                 alles
#   bash lauf.sh schritt 4d      einzelner Schritt (Argumente gehen an cutover.sh)
set -euo pipefail
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUTOVER="$(cd "${HIER}/../.." && pwd)"
PLATTFORM_REPO="$(git -C "${CUTOVER}" rev-parse --show-toplevel)"
SCHLUESSEL="${HIER}/.ssh/id_ed25519"
SSH_OPTS="-i ${SCHLUESSEL} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

mkdir -p "${HIER}/.work"
cat > "${HIER}/.work/cutover.conf" <<EOF
HOST=acm@127.0.0.1
HOST_SSH_OPTS="-p 2222 ${SSH_OPTS}"
HOST_IP=host
BASIS=/home/acm
PLATTFORM_PORT=8081
SIGNAGE_PORT=8080
PIS="signage@127.0.0.1"
PI_SSH_OPTS="-p 2223 ${SSH_OPTS}"
REPO_LUMEAPPS=${LUMEAPPS_DIR:-$HOME/Documents/lumeapps}
REF_LUMEAPPS=${REF_LUMEAPPS:-origin/main}
REPO_PLATTFORM=${PLATTFORM_REPO}
REF_PLATTFORM=${REF_PLATTFORM:-HEAD}
REPO_SIGNAGE=${ACM_SIGNAGE_DIR:-$HOME/Documents/acm-signage}
REF_SIGNAGE=${REF_SIGNAGE:-origin/main}
ADMIN_EMAIL=admin@e2e.test
PORTPRUEFUNG=aus
EOF

echo ja > "${HIER}/.work/antworten"
export CUTOVER_EINGABE="${HIER}/.work/antworten"
export CUTOVER_ADMIN_PASSWORT="e2e-$(openssl rand -hex 8)"

[ $# -gt 0 ] || set -- lauf
bash "${CUTOVER}/cutover.sh" -c "${HIER}/.work/cutover.conf" "$@" 2>&1 | tee -a "${HIER}/.work/lauf.log"
