#!/bin/bash
# Richtet den Pi beim Start ein und hält sshd im Vordergrund.
set -euo pipefail

home=/home/signage
install -d -m 0700 -o signage -g signage "$home/.ssh"
install -m 0600 -o signage -g signage /etc/e2e/authorized_keys "$home/.ssh/authorized_keys"

# Units nur beim ersten Start ablegen — ein Neustart des Containers soll
# nicht überschreiben, was das Umschalt-Skript geändert hat.
units="$home/.config/systemd/user"
if [ ! -f "$units/signage-sidecar.service" ]; then
  install -d -o signage -g signage "$home/.config" "$home/.config/systemd" "$units"
  install -m 0644 -o signage -g signage /etc/e2e/units/*.service "$units/"
fi

# Wie ein Boot: systemd liest die Units ein und startet den Sidecar.
su signage -c 'SYSTEMCTL_NO_LOG=1 systemctl --user daemon-reload && SYSTEMCTL_NO_LOG=1 systemctl --user start signage-sidecar.service signage-player.service'

exec /usr/sbin/sshd -D -e
