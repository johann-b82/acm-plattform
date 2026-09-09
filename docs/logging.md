# Logging und Festplatte

## Befund im Altprojekt

Die Platte des App-Hosts lief voll. Eine einzelne Docker-`json.log` des Caddy-Containers hatte 16 bis 23 GB. Ursache war Schreiblast, nicht ein Leck:

| Quelle | Volumen |
|---|---|
| Caddy-Access-Log, jeder Request | Vite-Dev-Server in Produktion liefert hunderte Modul-Requests pro Seitenaufruf |
| Uvicorn-Access-Log | pro Pi: `/health` alle 10 s, Playlist alle 30 s, Heartbeat alle 60 s, ~13.000 Zeilen/Tag |
| WM-Embeds | `refetchIntervalInBackground: true`, 24/7 alle 30 bis 60 s |
| Docker `json-file` ohne Cap | Standard bis Commit `8999f5a` |

Das Python-Logging der Anwendung hat **keinen Handler**. 17 Modul-Logger propagieren an einen Root-Logger ohne Ausgabe; nur WARNING und höher erreicht stderr über den `lastResort`-Handler. App-Logging war also weder das Problem noch für Operatoren sichtbar.

Weitere Wachstumspfade: `sensor_readings` und `sensor_poll_log` mit 3650 Tagen Retention (~1 Mio. Zeilen pro Sensor und Jahr), `directus_uploads/` ohne Löschpfad (nur 1 von 6 Löschstellen entfernt die Datei), `.tmp`-Reste abgebrochener Backups, verwaiste Slide-Verzeichnisse, Pi-journald ohne Limit auf 16-GB-SD-Karte.

## Umgesetzt im Altprojekt (PR #142)

- Caddy `log { level ERROR }`
- Uvicorn `--no-access-log --log-level warning` (API und Pi-Sidecar)
- Rotation 3×10 MB für alle zehn Compose-Dienste, auch One-Shots
- `sensor_poll_log` 14 Tage (Readings unverändert 3650)
- Heartbeat-Sweeper loggt nur bei Änderung (war 1.440 Zeilen/Tag)
- `backup/dump.sh`: `trap` räumt `.tmp`, Retention matcht `.tmp`, `pg_dump -Z 6 -f` statt Pipe (ein fehlschlagendes `pg_dump` wurde vorher als erfolgreiches Backup umbenannt)
- Pi: journald 200 MB / 7 Tage über `provision-pi.sh`
- CI-Guard E `scripts/ci/check_log_hygiene.sh`

## Regeln für `acm-plattform`

1. Jeder Compose-Dienst trägt den `x-logging`-Anker (`json-file`, 3×10 MB). Ein CI-Guard prüft das.
2. Kein Access-Log auf Erfolgsanfragen. Caddy `level ERROR`, Uvicorn `--no-access-log`, Next.js ohne Request-Logging in Produktion.
3. Supabase-Upstream: `analytics` (Logflare) und `vector` sind deaktiviert. Sie erzeugen eigenes Log-Volumen und eine weitere Datenbank.
4. Python-Logging bekommt einen echten Handler: stdout, Level WARNING, JSON-Zeilen. Fehler werden sichtbar, Rauschen nicht.
5. Kein `log.info` in Schleifen mit Intervall unter einer Stunde ohne Bedingung.
6. Retention gehört in `pg_cron`, nicht in einen App-Scheduler: Sensor-Poll-Log 14 Tage, Heartbeat-Events (Signage) 25 h, Pairing-Sessions 24 h.
7. Dateien, die eine Tabelle referenziert, werden beim Löschen der Zeile mitgelöscht (Storage-Hook oder Service). Ein wöchentlicher Orphan-Sweep prüft das.
8. Tokens gehören nicht in Query-Strings, außer wo `EventSource` es erzwingt. Dort redigiert der Proxy.

## Zeitbasierte Rotation auf dem Host (vorbereitet, nicht angewendet)

Docker `json-file` rotiert nur nach Größe. Für ein echtes Zeitfenster übernimmt journald die Retention. Dateien liegen in `infra/host/`:

- `infra/host/daemon.json`: `{"log-driver": "journald"}` (Fallback-Rotation für Dienste ohne Anker)
- `infra/host/journald-docker.conf`: `SystemMaxUse=500M`, `MaxRetentionSec=7day`

Anwendung nur auf dem Linux-App-Host, mit Freigabe (Entscheidung F). macOS-Entwicklungsrechner haben kein journald, daher bleibt das Compose-File auf `json-file`.

## Triage bei voller Platte

```bash
df -h /
sudo du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail
du -sh /srv/acm/* /srv/signage/*
docker container prune -f
docker image prune -af
```

`docker system prune --volumes` nicht verwenden: Bind-Mounts sind nicht betroffen, aber anonyme Volumes des Supabase-Stacks (z. B. Storage-Cache) schon.
