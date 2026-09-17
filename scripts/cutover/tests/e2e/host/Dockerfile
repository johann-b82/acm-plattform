# Nachbau des Produktionshosts 192.9.201.9 für den Umschalt-Test.
#
# Ubuntu, weil der echte Host über systemd-resolved (127.0.0.53) auflöst.
# Docker läuft im Container (privileged), der Benutzer `acm` ist in der
# Gruppe `docker`, hat aber kein Passwort und damit kein nutzbares sudo.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        docker.io docker-compose-v2 \
        openssh-server sudo \
        bash git tar gzip curl wget ca-certificates python3 openssl rsync \
        sed grep coreutils findutils procps iproute2 iptables less \
    && rm -rf /var/lib/apt/lists/*

# ubuntu:24.04 bringt den Benutzer `ubuntu` mit uid 1000 mit; `acm` soll die
# 1000 haben wie am Host (und wie `node` im Directus-Image).
RUN userdel -r ubuntu 2>/dev/null || true \
    && useradd -m -u 1000 -s /bin/bash -G docker acm \
    && usermod -p '*' acm \
    && install -d -m 0755 -o root -g root /srv \
    && mkdir -p /run/sshd \
    && ssh-keygen -A \
    && sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config

COPY entrypoint.sh /usr/local/bin/e2e-entrypoint
COPY seed-lumeapps.sh /usr/local/bin/seed-lumeapps
RUN chmod 0755 /usr/local/bin/e2e-entrypoint /usr/local/bin/seed-lumeapps

VOLUME ["/var/lib/docker"]
EXPOSE 22
ENTRYPOINT ["/usr/local/bin/e2e-entrypoint"]
