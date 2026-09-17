# Funktionen, die auf einem Pi laufen. cutover.sh schickt diese Datei per ssh
# an `bash -s`. Nur Bash 3.2 und POSIX-Werkzeuge.
#
# Geändert wird nur die Adresse in den zwei Units, nicht neu provisioniert:
# kein apt, kein git, kein Netz nötig, und der Rückweg ist exakt die alte Datei.

PI_UNIT_DIR="${PI_UNIT_DIR:-/home/signage/.config/systemd/user}"
PI_WARTEN="${PI_WARTEN:-60}"
PI_EINHEITEN="signage-sidecar.service signage-player.service"

als_signage() {  # befehl... — direkt, wenn wir signage sind, sonst sudo -n
  if [ "$(id -un)" = signage ] || [ -w "${PI_UNIT_DIR}" ]; then "$@"; else sudo -n -u signage "$@"; fi
}

pi_systemctl() {
  local uid; uid="$(id -u signage 2>/dev/null || id -u)"
  als_signage env XDG_RUNTIME_DIR="/run/user/${uid}" systemctl --user "$@"
}

p_adresse() {
  sed -n 's/^Environment=SIGNAGE_API_BASE=//p' "${PI_UNIT_DIR}/signage-sidecar.service" | head -1
}

p_umstellen() {  # neue-adresse
  local neu="$1" alt f frist
  alt="$(p_adresse)"
  [ -n "$alt" ] || { echo "FEHLER: SIGNAGE_API_BASE nicht gefunden in ${PI_UNIT_DIR}" >&2; return 1; }
  for f in ${PI_EINHEITEN}; do
    [ -e "${PI_UNIT_DIR}/$f.vor-cutover" ] || als_signage cp -p "${PI_UNIT_DIR}/$f" "${PI_UNIT_DIR}/$f.vor-cutover"
  done
  if [ "$alt" != "$neu" ]; then
    for f in ${PI_EINHEITEN}; do
      A="$alt" N="$neu" awk '{ r = ""; while ((i = index($0, ENVIRON["A"])) > 0) { r = r substr($0, 1, i-1) ENVIRON["N"]; $0 = substr($0, i + length(ENVIRON["A"])) } print r $0 }' \
        "${PI_UNIT_DIR}/$f" | als_signage tee "${PI_UNIT_DIR}/$f.neu" >/dev/null
      als_signage mv "${PI_UNIT_DIR}/$f.neu" "${PI_UNIT_DIR}/$f"
    done
  fi
  pi_systemctl daemon-reload
  pi_systemctl restart signage-sidecar signage-player
  echo "  $(hostname): $alt → $neu, Dienste neu gestartet"

  frist=$(( $(date +%s) + PI_WARTEN ))
  while :; do
    if curl -s --max-time 3 http://localhost:8080/health | grep -q '"online": *true'; then
      echo "  ✓ Sidecar online über $neu"; return 0
    fi
    [ "$(date +%s)" -ge "$frist" ] && break
    sleep 3
  done
  echo "  ✗ Sidecar nach ${PI_WARTEN}s nicht online: $(curl -s --max-time 3 http://localhost:8080/health)" >&2
  return 1
}

p_zurueck() {
  local f
  for f in ${PI_EINHEITEN}; do
    [ -e "${PI_UNIT_DIR}/$f.vor-cutover" ] || { echo "FEHLER: keine Sicherung ${PI_UNIT_DIR}/$f.vor-cutover" >&2; return 1; }
  done
  for f in ${PI_EINHEITEN}; do als_signage mv "${PI_UNIT_DIR}/$f.vor-cutover" "${PI_UNIT_DIR}/$f"; done
  pi_systemctl daemon-reload
  pi_systemctl restart signage-sidecar signage-player
  echo "  $(hostname): zurück auf $(p_adresse)"
}
