# Ablauf vor Ort

Stand 10. September 2026. Reihenfolge ist Absicht: jeder Schritt lässt sich einzeln abbrechen, ohne den nächsten zu blockieren.

Was hier steht, ist entweder lokal nachgestellt oder ausdrücklich als ungeprüft markiert. Die Marke sagt, worauf Verlass ist.

| Marke | Bedeutung |
|---|---|
| **geprüft** | lokal gegen den vollständigen Stack gefahren |
| **am Host geprüft** | auf `acm@192.9.201.9` selbst nachgesehen |
| **ungeprüft** | braucht den Host, ist hier nur beschrieben |

## Der Host, wie er wirklich aussieht

**am Host geprüft** (2026-09-10, aus dem LAN)

Vier Dinge weichen von dem ab, was hier vorher stand. Jedes einzelne hätte den Ablauf gekostet.

| | |
|---|---|
| **Pfad** | `/home/acm/lumeapps`, **nicht** `/srv/lumeapps` |
| **Kein Git** | Das Verzeichnis ist kein Repository. Der Stand steht in der Datei `DEPLOYED_COMMIT` — aktuell `ffc9ba0`, also vor allen sieben Sicherheits-PRs. GitHub ist vom Host aus erreichbar (`git ls-remote` liefert `531c5fe`), ein frischer Klon daneben ist also möglich. |
| **`docker-compose.override.yml`** | Liegt nur auf dem Host, nicht im Repo, und gibt dem `api`-Dienst echte DNS-Server (`192.9.200.1/.2`). Der Host selbst löst über `127.0.0.53` auf — das kann ein Container nicht benutzen. **Ohne diese Datei löst `api.personio.de` im Container nicht mehr auf, und der Personio-Abgleich bricht.** |
| **Quellbaum ist live** | Der `api`-Container mountet `backend/` **schreibbar** und läuft mit `--reload`. Wer dort Dateien hineinkopiert, deployt sofort — und nicht atomar. Vorbereiten geht nur in einem zweiten Verzeichnis. |
| **Arbeitsspeicher** | 7,3 GB gesamt, ~5,2 GB frei bei laufendem Stack. Der Frontend-Bau will 6 GB Heap. Auf diesem Host bauen heißt, den laufenden Betrieb gegen die Wand zu fahren. |
| **`/srv` ist leer und gehört root** | `acm` darf dort nicht schreiben, und `sudo` verlangt ein Passwort. Die neuen Stacks kommen deshalb nach `/home/acm/acm-plattform` und `/home/acm/acm-signage`, nicht nach `/srv/acm` und `/srv/signage`. Docker selbst geht ohne root (`acm` ist in der Gruppe `docker`), und alle Pfade in den Compose-Dateien sind relativ — der Ort ist frei wählbar. Wer `/srv` will, legt es einmalig von Hand an: `sudo mkdir -p /srv/acm && sudo chown acm:acm /srv/acm`. |

### Die Falle mit dem Override

`docker compose` lädt `docker-compose.override.yml` **nur automatisch, solange kein `-f` angegeben ist**. Sobald der Aufruf `-f docker-compose.yml -f docker-compose.prod.yml` lautet, ist der Override weg. Am Host belegt:

```bash
docker compose -f docker-compose.yml config | grep -c dns:   # 0
docker compose config | grep -c dns:                          # 1
```

Jeder Aufruf mit dem Prod-Overlay nennt die Override-Datei deshalb **mit**:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.prod.yml <befehl>
```

Der Kürze halber steht unten `$C` dafür:

```bash
cd /home/acm/lumeapps
C="docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.prod.yml"
```

---

## 0. Vorher: Sicherung der alten Datenbank

**am Host geprüft** — der nächtliche Lauf funktioniert wieder: `kpi-2026-09-09.sql.gz` (31 MB) und `kpi-2026-09-10.sql.gz` (33 MB) liegen in `backups/`.

Die 0 Byte großen `.tmp`-Dateien vom 7. und 8. September stammen aus den Tagen, an denen die Platte voll war; seit der Vergrößerung des Logical Volume läuft es. Sie können weg.

Vor dem Umschalten trotzdem einen frischen Abzug ziehen — der nächtliche ist bis zu 24 Stunden alt:

```bash
cd /home/acm/lumeapps && docker compose exec -T backup /usr/local/bin/dump.sh
ls -la backups/ | tail -3
```

Ohne diesen Schritt gibt es keinen Weg zurück. Erst danach weitermachen.

---

## 1. Altprojekt härten

**geprüft** — lokal gegen den vollständigen Stack: keine Host-Ports außer `:80`, API als `uid 10001`, kein `--reload`, gebaute Oberfläche unter `/`, Anmeldung mit echtem Directus-Token erfolgreich.

**Vorher am Host gemessen** (2026-09-10, aus dem LAN), damit hinterher vergleichbar ist, was sich geändert hat:

| Befund | Zustand heute |
|---|---|
| 1 Vite-Dev-Server | `:5173` offen, liefert `/@vite/client` |
| 2 API direkt im LAN | `:8000` offen, `/docs` gibt die vollständige Routenliste her |
| 4 Personaldaten | `/api/hr/embed/birthdays/this-week` liefert ohne Anmeldung Name, Abteilung, **Geburtsdatum mit Jahrgang** und Alter |

Richtig gebunden sind schon jetzt Directus (`:8055`) und Postgres (`:5432`) — beide nur auf 127.0.0.1.

### 1a. Neuen Stand holen

Das Verzeichnis ist kein Repository (siehe oben). Zwei Wege, beide gangbar:

Frischer Klon **daneben**. Nichts am laufenden Verzeichnis anfassen:

```bash
cd /home/acm
git clone https://github.com/johann-b82/lumeapps.git lumeapps-neu
cd lumeapps-neu
cp ../lumeapps/.env ../lumeapps/docker-compose.override.yml .
git rev-parse --short HEAD > DEPLOYED_COMMIT
```

Die Datenverzeichnisse (`postgres_data`, `directus_*`, `caddy_*`, `backups`,
`certs`, `frontend_node_modules`) bleiben vorerst im alten Verzeichnis — sie
ziehen erst beim Umschalten um, wenn nichts mehr darauf schreibt.

> **Nicht per rsync über das laufende Verzeichnis.**
>
> Am Host nachgesehen: der `api`-Container hat `/home/acm/lumeapps/backend`
> **schreibbar** unter `/app` gemountet und läuft mit `--reload`:
>
> ```
> /home/acm/lumeapps/backend -> /app (rw)
> uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --reload
> ```
>
> Jede Datei, die dort landet, startet die laufende Produktion sofort neu — mit
> dem Code, der in genau diesem Moment im Verzeichnis liegt. Ein rsync ist keine
> Vorbereitung, sondern ein Deployment, und noch dazu ein nicht atomares: der
> Reloader kann mitten im Kopieren feuern und einen halb getauschten Baum
> hochfahren. Also Weg A, daneben klonen, und erst beim Umschalten tauschen.

`.env` und `docker-compose.override.yml` bleiben dabei unangetastet — sie werden
kopiert, nicht überschrieben.

### 1b. Oberfläche bauen — **nicht auf dem Host**

Der Host hat 7,3 GB RAM, bei laufendem Stack sind ~5,2 GB frei. Der Bau will 6 GB
Heap (`NODE_OPTIONS=--max-old-space-size=6144`, siehe CI). Ein Bau auf dem Host
riskiert, dem laufenden Betrieb den Speicher wegzunehmen.

Also auf dem Entwicklungsrechner bauen und das Ergebnis kopieren:

```bash
# Mac, im Repo:
cd frontend && NODE_OPTIONS="--max-old-space-size=6144" npm run build && cd ..
rsync -a --delete frontend/dist/ acm@192.9.201.9:/home/acm/lumeapps-neu/frontend/dist/
```

`npm run build` erzeugt beides: die Admin-Oberfläche nach `frontend/dist` und das
Player-Bundle nach `frontend/dist/player`. Zusammen rund 110 MB.

Prüfen, dass beide Einstiegsseiten angekommen sind — **ohne sie zeigt `/` nach dem
Umschalten eine leere Seite**:

```bash
ssh acm@192.9.201.9 'ls -l /home/acm/lumeapps-neu/frontend/dist/index.html \
                        /home/acm/lumeapps-neu/frontend/dist/player/index.html'
```

### 1c. Umschalten

Der alte Stack geht herunter, der neue kommt aus dem neuen Verzeichnis hoch. Das
ist der einzige Moment mit Ausfall — Sekunden bis eine Minute.

```bash
# 1) alten Stack herunterfahren — down, nicht stop: sonst streiten sich
#    die Container um Port 80 und die Netzwerke
cd /home/acm/lumeapps && docker compose down

# 2) Datenverzeichnisse mitnehmen (jetzt schreibt nichts mehr darauf)
for d in postgres_data directus_database directus_extensions directus_uploads \
         caddy_data caddy_config backups certs frontend_node_modules; do
  [ -e "/home/acm/lumeapps/$d" ] && mv "/home/acm/lumeapps/$d" /home/acm/lumeapps-neu/
done

# 3) neuen Stack hochfahren
cd /home/acm/lumeapps-neu
C="docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.prod.yml"
$C up -d --build
```

Prüfen:

```bash
$C ps --format '{{.Service}}\t{{.Ports}}'          # nur caddy auf :80
$C exec api id                                     # uid=10001
$C exec api ls /app/tests                          # darf es nicht geben
$C exec api python -c 'import pytest'              # ModuleNotFoundError
$C exec api python -c 'import socket; print(socket.gethostbyname("api.personio.de"))'
curl -sI http://127.0.0.1/ | grep -i x-content-type # nosniff
curl -s http://127.0.0.1/api/hr/embed/birthdays/this-week | head -c 200
```

Die DNS-Zeile ist die wichtigste: löst sie nicht auf, fehlt die Override-Datei im
Aufruf, und der nächtliche Personio-Abgleich bricht in der kommenden Nacht.
Die letzte Zeile darf **kein** `birthday` und **kein** `age_turning` mehr zeigen.

Von außen gegenprüfen, dass die zwei offenen Ports zu sind:

```bash
# vom Mac aus
for p in 80 5173 8000; do nc -z -G 2 192.9.201.9 $p && echo "$p OFFEN" || echo "$p zu"; done
```

Erwartet: `80 OFFEN`, `5173 zu`, `8000 zu`.

Der neue Stand bringt die Sicherheitsarbeit von 2026-09-10 mit: 18 der 21 Befunde sind zu (PRs #145–#151, Stand in `docs/security-findings.md`). Zwei Punkte ändern das Verhalten spürbar und gehören deshalb in die Beobachtung der ersten Stunde:

- **Die Sitzung läuft nach 8 statt 24 Stunden ab.** Die Oberfläche erneuert sie stillschweigend; sollten Nutzer trotzdem unerwartet auf der Anmeldeseite landen, ist `SESSION_COOKIE_TTL` in `docker-compose.yml` die Stellschraube.
- **Der Kiosk-Foto-Weg antwortet nur noch für Personen, die gerade auf einem Board stehen.** Wer ein leeres Bild auf einem Bildschirm sieht, sollte prüfen, ob die Person überhaupt Geburtstag hat oder in den letzten 52 Wochen eingetreten ist — 404 ist dort die richtige Antwort, keine Störung.

Damit sind vier der fünf Hoch-Befunde zu; der fünfte (TLS) folgt im nächsten Schritt.

Zurück geht es symmetrisch — der alte Baum ist unangetastet geblieben:

```bash
cd /home/acm/lumeapps-neu && $C down
for d in postgres_data directus_database directus_extensions directus_uploads \
         caddy_data caddy_config backups certs frontend_node_modules; do
  [ -e "/home/acm/lumeapps-neu/$d" ] && mv "/home/acm/lumeapps-neu/$d" /home/acm/lumeapps/
done
cd /home/acm/lumeapps && docker compose up -d
```

---

## 2. Zertifikat rotieren

**ungeprüft**

Der private Schlüssel aus `certs/internal.key` lag seit dem ersten Commit im Repo und steht weiter in der Historie. Er ist entfernt, aber falls er je ausgeliefert wurde, gilt er als kompromittiert.

Neues Material erzeugen, unter `/home/acm/certs` ablegen (außerhalb des Repos, das Verzeichnis ist in `.gitignore`) und in Caddy per Pfad einbinden. Details in `lumeapps/certs/README.md`.

---

## 3. Neuen Stack hochziehen

**teilweise geprüft** — der Kaltstart ist lokal gefahren, die Adressen sind es nicht.

```bash
cd /home/acm/acm-plattform
bash infra/supabase/fetch-upstream.sh "$(cat infra/supabase/UPSTREAM_TAG)"
bash scripts/init-env.sh
```

### Port 80 gehört noch dem Altprojekt

**am Host geprüft** — `lumeapps-caddy-1` hält `0.0.0.0:80`. Beide Stacks können ihn
nicht gleichzeitig haben. Beide Compose-Dateien sind dafür vorbereitet:

| Stack | Variable | Vorgabe | Im Parallelbetrieb |
|---|---|---|---|
| Altprojekt | — | 80 | bleibt auf 80, bis es abgeschaltet wird |
| `acm-plattform` | `CADDY_HTTP_PORT` | 80 | **8081** |
| `acm-signage` | `SIGNAGE_HTTP_PORT` | 8080 | 8080, kollidiert mit nichts |

Vor dem ersten Start in `.env` auf die Adresse setzen, unter der der Browser den
Stack **jetzt** erreicht — also mit Port: `SITE_URL`, `SUPABASE_PUBLIC_URL`,
`API_EXTERNAL_URL` auf `http://192.9.201.9:8081`.

**`API_EXTERNAL_URL` ist der Aussteller im Token**; `compute` prüft ihn. Wenn die
Plattform später auf Port 80 umzieht, ändert sich der Aussteller und alle
ausgegebenen Token werden ungültig — jede angemeldete Person muss sich einmal neu
anmelden. Das ist verkraftbar, aber es soll niemanden überraschen. Wer es vermeiden
will, schaltet das Altprojekt in einem Zug ab und startet die Plattform gleich auf 80.

```bash
docker compose up -d --build
bash scripts/bootstrap-admin.sh <ihre-adresse> '<sicheres Passwort>'
```

Prüfen: `http://<host>/` → Anmeldung → Kacheln.

---

## 4. Daten übernehmen

Vier Läufe, jeder erst trocken. Alle vier sind **geprüft** gegen eine echte Alt-Datenbank mit 125 Alembic-Revisionen und Directus 11.17.2.

### 4a. Vertrieb, Personen und ATR

Ablauf in `docs/setup.md`, Abschnitt „Datenübernahme aus lumeapps". Kurz:

```bash
docker network connect lumeapps_default acm-compute-1
QUELLE="postgresql://<user>:<passwort>@lumeapps-db-1:5432/<datenbank>"

docker compose exec compute python -m app.cli uebernahme-vertrieb --quelle "$QUELLE" --trocken
docker compose exec compute python -m app.cli uebernahme-vertrieb --quelle "$QUELLE"

docker compose exec compute python -m app.cli uebernahme-nutzer --quelle "$QUELLE" --trocken
docker compose exec compute python -m app.cli uebernahme-nutzer --quelle "$QUELLE" > zugaenge.csv

docker compose exec compute python -m app.cli uebernahme-atr --quelle "$QUELLE" --trocken
docker compose exec compute python -m app.cli uebernahme-atr --quelle "$QUELLE"

docker network disconnect lumeapps_default acm-compute-1
```

`zugaenge.csv` enthält je Person ein neues Passwort, **einmalig**. Verteilen, dann löschen.

Der ATR-Lauf holt 287 Teile und die Vorlagen samt Gerüstdateien. Er ist Pflicht,
bevor der erste Lieferschein eingelesen wird — ein unvollständiger Katalog
schlägt sich als „nicht zugeordnet" auf jeder Position nieder.

Danach unter `/einstellungen#atr` den Eingangsordner eintragen: Rechner, Freigabe,
Domäne, Benutzer und die drei Pfade. Dazu gehören in die `.env` von `compute`
`ATR_SMB_PASSWORT`, `ATR_SMB_ERLAUBT` (Namen und Subnetze, gegen die sich der
Dienst anmelden darf) und `ATR_SCAN_TOKEN` (`openssl rand -hex 24`), und
dasselbe Token als `acm.atr_scan_token` in der Datenbank. Erst „Verbindung
prüfen", dann den Schalter umlegen.

### 4b. Signage

Ablauf in `acm-signage/docs/setup.md`. Vorher die alten Verzeichnisse in den Medienspeicher kopieren, danach `SIGNAGE_DEVICE_JWT_SECRET` aus der alten `.env` übernehmen — ohne das zeigt jeder Bildschirm wieder einen Kopplungscode.

---

## 5. Pis umstellen

**ungeprüft** — braucht die Geräte.

`SIGNAGE_API_URL` in den Units auf den Signage-Stack zeigen lassen, Sidecar und Player neu starten. Runbook § 9. Das Pairing bleibt erhalten, wenn Schritt 4b gelaufen ist und das Geräte-Secret übernommen wurde.

Ein Gerät zuerst, dann den Rest.

---

## 6. Host-Vorlagen anwenden

**ungeprüft**, und bewusst zuletzt (Entscheidung F: vorbereiten, nicht anwenden).

`infra/host/daemon.json` und `infra/host/journald-docker.conf` legen die Log-Aufbewahrung auf Host-Ebene fest. Der Docker-Daemon startet dabei neu — also erst, wenn alles andere steht.

---

## Danach prüfen

| Prüfung | Erwartung |
|---|---|
| Bildschirme | zeigen Inhalt, kein Kopplungscode |
| `docker compose ps` in beiden Projekten | alles `healthy` |
| Anmeldung einer übernommenen Person | funktioniert, Kacheln passen zur Gruppe |
| Kennzahlen Vertrieb | Zahlen wie im Altprojekt |
| Log-Wachstum nach einem Tag | deutlich unter dem alten Stand |
| `scripts/backup.sh` | läuft durch, Abzug ist mit `pg_restore --list` lesbar |

## Was danach noch offen bleibt

Der Port von **ATR und FAIR**. Alles andere steht: Vertrieb, Einkauf, Produktion, Qualität, Finanzen, Personal, Newsletter, KPI-Bewertung und Seiten-Feedback. Bis ATR und FAIR portiert sind, läuft das Altprojekt für diese beiden weiter — gehärtet, und beide sind ohnehin nur für Admin und QS erreichbar. Rezept in `docs/status.md`, Reihenfolge in `docs/plan.md`.
