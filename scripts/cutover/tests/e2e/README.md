# Testumgebung für das Umschalten

Ein nachgebauter Produktionshost und ein nachgebauter Signage-Pi, beide per SSH erreichbar. Das Umschalt-Skript läuft dagegen genauso wie gegen `192.9.201.9` — nur mit anderen Adressen.

```bash
bash up.sh      # erster Lauf ~4–5 min (gemessen; ohne Build-Cache länger), danach ~15 s
bash down.sh    # alles weg samt Volumes; --all löscht auch Schlüssel, Saatgut und Images
```

Nur das Compose-Projekt `cutover-e2e` wird angefasst. Voraussetzungen: `~/Documents/lumeapps` (Repo mit `ffc9ba0`, lokaler `postgres_data`, gebautes `frontend/dist/player`, lokaler `lumeapps`-Stack **gestoppt**) und `~/Documents/acm-signage`. Abweichende Orte über `LUMEAPPS_DIR` und `ACM_SIGNAGE_DIR`.

## Lauf

```bash
bash up.sh
bash lauf.sh                   # cutover.sh lauf, jeder Haltepunkt mit «ja»
bash lauf.sh schritt 4d        # einzelner Schritt
bash lauf.sh zurueck 1c        # Rückweg
bash down.sh
```

`lauf.sh` schreibt `.work/cutover.conf` und protokolliert nach `.work/lauf.log`.

Durchgelaufen am 2026-09-16: `vorab` bis `pruefen` grün, danach 4a wiederholt (kein neuer Zugang, 83 Tabellen stimmen), `zurueck 5` und erneut 5, `zurueck 1c` nach Schritt 3 (altes Projekt läuft wieder mit Bestand) und erneut 1c. Gefunden und behoben: leere Datenbank nach 1c (`mv` ohne Rechte), `certs/certs`, Kong auf 8000 blockierte den Rückweg, Zugangsliste mit Bericht vermischt, Endlosschleife beim Pi-Adresstausch.

Nachgereicht am selben Tag, mit der DB-Bindung `127.0.0.1:5432` im Override wie am Host gemessen: 1a legt `docker-compose.cutover.yml` an, 1c läuft ohne Host-Port der alten Datenbank, `zurueck 1c` startet das alte Projekt neben der Plattform (die 5432 hält), erneut 1c und `pruefen` grün.

Die Testdaten brauchen zwei Anpassungen, die in Produktion nicht nötig sind: eine ATR-Vorlage mit Dateinamen (`fixtures/atr-fixtures.sql`) und derselbe `FERNET_KEY` wie beim kopierten Bestand (`up.sh` übernimmt ihn aus der lokalen `lumeapps/.env` nach `.work/seed/`).

## Konfiguration fürs Skript

`up.sh` gibt sie am Ende aus:

```bash
HOST=acm@127.0.0.1
HOST_SSH_OPTS="-p 2222 -i <e2e>/.ssh/id_ed25519 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
HOST_IP=host        # so erreichen Pis den Host
PIS="signage@127.0.0.1"
PI_SSH_OPTS="-p 2223 -i <e2e>/.ssh/id_ed25519 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
```

## Ports

Alle nur auf `127.0.0.1` des Mac.

| Mac | Ziel | Zweck |
|---|---|---|
| 2222 | host:22 | SSH `acm` |
| 2223 | pi:22 | SSH `signage` |
| 18080 | host:80 | Caddy am Host — alt lumeapps, nach dem Umschalten die Plattform |
| 18081 | host:8081 | Host-Port 8081 |
| 18082 | host:8080 | Host-Port 8080 (Signage-Stack) |

Pi und Host liegen im Netz `10.213.0.0/24` (host `.10`, pi `.20`); der Pi erreicht den Host als `http://host:80`, `http://host:8080`. Die Ports `8000` und `5173`, die das Altprojekt veröffentlicht, sind nur im Host-Container offen, nicht am Mac.

## Der Host

Nachgebildet nach `docs/cutover.md`, Abschnitt „Der Host, wie er wirklich aussieht“:

- Ubuntu 24.04, Docker im Container (privileged), `docker compose` v2.
- Benutzer `acm` (uid 1000, Gruppe `docker`), kein Passwort, `sudo` damit unbenutzbar.
- `/srv` leer, gehört root, für `acm` nicht beschreibbar.
- `/home/acm/lumeapps`: **kein Git-Repo**, `DEPLOYED_COMMIT` = `ffc9ba0`, Quelle aus `git archive ffc9ba0`, gestartet mit schlichtem `docker compose up -d` (Dev-Compose: `api` mit `--reload` und schreibbarem `backend/`, Ports 8000/5173/80), `docker-compose.override.yml` nur am Host mit `dns:` für `api`, `.env` aus `.env.example` mit frisch erzeugten Geheimnissen (auch `SIGNAGE_DEVICE_JWT_SECRET`, `FERNET_KEY`). Projektname `lumeapps` → Netz `lumeapps_default`, Container `lumeapps-db-1`.
- GitHub und Docker Hub sind erreichbar (über das Netz des Mac).

Innerer Docker und `/home/acm` liegen in Volumes; `down.sh` löscht sie.

### Bestand in der alten Datenbank

1. `up.sh` kopiert `lumeapps/postgres_data`, startet darauf kurz einen Postgres (`cutover-e2e-dump`) und zieht einen `pg_dump`. Das Alembic-Schema von `ffc9ba0` und dem lokalen Stand ist identisch (`v1_125_inspection_total_target`). Mit dabei: eine Playlist mit fünf `url`-Medien (`/embed/worldcup…`), Directus-Rollen und -Admin, Audits, Sensoren.
2. Im Host wird der Dump in die frische `kpi_db` (Benutzer `kpi_user`) eingespielt. Directus-Admin bekommt E-Mail, Passwort und Token aus der neuen `.env`, `DIRECTUS_ADMINISTRATOR_ROLE_UUID` wird aus der Datenbank übernommen.
3. `fixtures/signage-fixtures.sql` ergänzt, was die Übernahme in `acm-signage` braucht: gekoppeltes Gerät mit Tag, Bild- und PPTX-Medium mit Directus-UUID als `uri` (Dateien unter `directus_uploads/<uuid>.png|.pptx`), Folien unter `backend/media/slides/<media_id>/slide-00N.png`, Playlist mit Tag, Zeitplan, abgelaufene Kopplung.
4. `frontend/dist/player` stammt aus dem lokalen lumeapps-Checkout (gebaut, nicht Teil des Archivs).

## Der Pi

- Debian slim, Benutzer `signage` (uid 1001).
- `~/.config/systemd/user/signage-sidecar.service` und `signage-player.service` aus `acm-signage/scripts/systemd/`, ersetzt wie `deploy_systemd_units`: `__SIGNAGE_API_URL__` → `http://host:80`, `__SIGNAGE_UID__` → `1001`. Nur beim ersten Start abgelegt.
- `systemctl` ist ein Stub (`/usr/local/bin/systemctl`), jeder Aufruf steht in `/tmp/systemctl.log`. `daemon-reload` liest die Units ein; `restart` benutzt den **eingelesenen** Stand — ohne `daemon-reload` bleibt die alte Adresse, wie bei systemd. Außerdem `start`, `stop`, `is-active`, `cat`.
- `restart signage-sidecar` startet einen Stellvertreter auf `127.0.0.1:8080`. `GET /health` liefert `{"ready": true, "online": …, "cached_items": 0, "api_base": "…"}`. `online` heißt: `GET <SIGNAGE_API_BASE>/health` antwortet mit Status < 500 — dieselbe Regel wie im echten Sidecar, aber sofort statt alle 10 s. `api_base` gibt es nur im Stellvertreter.

```bash
ssh -p 2223 -i .ssh/id_ed25519 signage@127.0.0.1 'curl -s localhost:8080/health; cat /tmp/systemctl.log'
```

## Abweichungen von Produktion

- Host-DNS ist Dockers eingebetteter Resolver (`127.0.0.11`) statt `127.0.0.53`; der innere Daemon fällt für Container ebenfalls auf öffentliche Resolver zurück. Ob der Override fehlt, fällt hier also **nicht** über einen DNS-Fehler auf — nur über `docker compose config | grep dns:`.
- Override-DNS `1.1.1.1`/`9.9.9.9` statt `192.9.200.1/.2`.
- Datenbestand ist die lokale Entwicklungsdatenbank plus Fixtures, nicht der Produktionsbestand; keine Sicherungen in `backups/`.
- Player-Bundle aus dem lokalen Checkout, nicht aus `ffc9ba0` gebaut.
- Arbeitsspeicher ist der von Docker Desktop, nicht 7,3 GB eines eigenen Hosts. Gemessen im Betrieb: Host-Container ~1,8 GB (davon Vite ~0,9 GB), Pi ~35 MB; der innere Docker belegt ~7 GB Platte.
- Pi ohne labwc, Chromium und echten Sidecar; der Gerätetoken fehlt.
