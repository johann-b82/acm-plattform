# Host-Vorlagen (nicht angewendet)

Entscheidung F (2026-09-09): vorbereiten, nicht umsetzen. Anwendung auf dem Linux-App-Host erst nach Freigabe.

| Datei | Ziel auf dem Host | Wirkung |
|---|---|---|
| `daemon.json` | `/etc/docker/daemon.json` | Docker schreibt Container-Logs nach journald; journald übernimmt die Retention nach Zeit |
| `journald-docker.conf` | `/etc/systemd/journald.conf.d/50-docker.conf` | 500 MB Deckel, 7 Tage Aufbewahrung |

Anwendung:

```bash
sudo install -m 0644 daemon.json /etc/docker/daemon.json
sudo install -D -m 0644 journald-docker.conf /etc/systemd/journald.conf.d/50-docker.conf
sudo systemctl restart systemd-journald
sudo systemctl restart docker      # startet alle Container neu — Wartungsfenster
```

`docker compose logs` funktioniert mit dem journald-Treiber weiter. Das Compose-File behält `json-file` als Anker, weil Entwicklungsrechner (macOS) kein journald haben; auf dem Host gewinnt `daemon.json` nur für Dienste ohne expliziten `logging`-Block. Wer die Zeitregel auch für die Anker-Dienste will, setzt den Treiber im Compose-File auf `journald` in einem Host-spezifischen Override (`docker-compose.prod.yml`).
