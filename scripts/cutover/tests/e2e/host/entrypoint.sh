#!/bin/bash
# Startet sshd und den Docker-Daemon im Host-Container.
set -euo pipefail

install -d -m 0700 -o acm -g acm /home/acm/.ssh
install -m 0600 -o acm -g acm /etc/e2e/authorized_keys /home/acm/.ssh/authorized_keys

# cgroup v2 im Container: Prozesse in eine Unter-Gruppe schieben, damit der
# innere Daemon Controller delegieren kann (dasselbe Vorgehen wie `docker:dind`).
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  mkdir -p /sys/fs/cgroup/init
  xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || :
  sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers \
    > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || :
fi

rm -f /var/run/docker.pid
/usr/sbin/sshd
# Kein Access-Log, begrenzte Protokolle: der Daemon schreibt nach stdout des
# äußeren Containers, der selbst per Logging-Anker begrenzt ist.
exec dockerd --host=unix:///var/run/docker.sock --log-level=warn
