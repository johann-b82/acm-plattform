# Nachbau eines Signage-Pis für den Umschalt-Test: nur das, was ein Skript
# über SSH anfasst — Benutzer `signage`, die beiden systemd-User-Units,
# `systemctl` und die Sidecar-Gesundheitsprüfung auf localhost:8080.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        openssh-server python3 curl ca-certificates sed grep coreutils procps \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1001 -s /bin/bash signage \
    && usermod -p '*' signage \
    && mkdir -p /run/sshd /var/lib/signage \
    && chown signage:signage /var/lib/signage \
    && ssh-keygen -A \
    && sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config

COPY systemctl /usr/local/bin/systemctl
COPY sidecar_standin.py /opt/signage/sidecar_standin.py
COPY entrypoint.sh /usr/local/bin/e2e-entrypoint
RUN chmod 0755 /usr/local/bin/systemctl /usr/local/bin/e2e-entrypoint

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/e2e-entrypoint"]
