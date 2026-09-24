# Ablauf vor Ort

Stand 10. September 2026. Reihenfolge ist Absicht: jeder Schritt lässt sich einzeln abbrechen, ohne den nächsten zu blockieren.

Was hier steht, ist entweder lokal nachgestellt oder ausdrücklich als ungeprüft markiert. Die Marke sagt, worauf Verlass ist.

| Marke | Bedeutung |
|---|---|
| **geprüft** | lokal gegen den vollständigen Stack gefahren |
| **am Host geprüft** | auf `acm@192.9.201.9` selbst nachgesehen |
| **ungeprüft** | braucht den Host, ist hier nur beschrieben |

## Automatisiert

`scripts/cutover/cutover.sh` fährt die Schritte unten vom Mac aus, per ssh auf den Host und die Pis:

```bash
cp scripts/cutover/cutover.conf.example scripts/cutover/cutover.conf   # Host, Pis, Klone eintragen
bash scripts/cutover/cutover.sh schritt vorab   # nur lesen: Werkzeuge, Speicher, Altprojekt, Pis
bash scripts/cutover/cutover.sh plan            # Reihenfolge und was schon erledigt ist
bash scripts/cutover/cutover.sh lauf            # alles Offene, hält vor jedem Ausfall an
```

- **Haltepunkte:** vor 1c, vor jedem echten Datenlauf (4a, 4d), vor dem ersten Pi und vor den übrigen. Weiter geht es nur mit ausgeschriebenem `ja`. Schlägt eine Prüfung nach 1c oder an einem Pi fehl, bietet das Skript den Rückweg an; von Hand: `cutover.sh zurueck 1c` bzw. `cutover.sh zurueck 5 [PI]`.
- **Fortsetzen:** Erledigte Schritte stehen auf dem Host unter `/home/acm/.cutover`. `lauf` überspringt sie; `schritt X` fährt einen Schritt erneut.
- **Reihenfolge:** 0b liest die Adresse jedes Pis. Zeigt einer auf `:8000`, zieht Signage vor der Härtung um (3, 4d, 5, dann 1).
- **Code** kommt per `git archive` aus den lokalen Klonen, der Host braucht kein GitHub-Konto. Die Oberfläche des Altprojekts baut der Mac (1b).
- **Secrets** liest das Skript auf dem Host aus den `.env`-Dateien; sie erscheinen in keiner Ausgabe. Die Passwortliste neuer Zugänge liegt nur auf dem Host (`acm-plattform/zugaenge-*.csv`, 0600).
- **Pis:** Schritt 5 wird am Stichtag **nicht gebraucht** — der Player-Weg liegt unter demselben Origin, die Geräte bleiben unangetastet (§ 5). Wird er doch einmal für ein einzelnes Gerät gefahren, tauscht das Skript nur die Adresse in den zwei Units und sichert die alten als `*.vor-cutover`, statt `provision-pi.sh` neu zu fahren — kein apt, kein git, Rückweg exakt. **Die Kopplung überlebt den Adresswechsel nicht.**
- **Bleibt von Hand**, das Skript hält dort an und zeigt die Befehle: Zertifikat (2), Firmenlogo und ATR-Eingangsordner (4b), signierte Adressen der HR-Tafeln (4d), Host-Vorlagen mit `sudo` (6), Umzug der Plattform auf Port 80.
- **Medienverzeichnis:** `signage-api` läuft als uid 10001. Das Skript gibt `acm-signage/data/media` diesem Nutzer (per `docker run`, ohne `sudo`); von Hand angelegt gehört es `acm`, und Uploads wie Übernahme scheitern.

- **Ports:** Schritt 3 legt Kong auf `127.0.0.1:8010` (Vorgabe 8000 ist die alte Dev-API, der Rückweg von 1c startete sonst nicht) und prüft vor dem ersten Start, ob Plattform-, Kong- und Postgres-Port frei sind. `POSTGRES_PORT` lässt sich nicht verlegen; deshalb nimmt 1a der alten Datenbank ihren Host-Port (`docker-compose.cutover.yml`, `!reset`, Compose ab 2.24 — prüft `vorab`).

Unit-Tests: `bash scripts/cutover/tests/unit.sh` (auch in CI). Gesamtlauf gegen einen nachgebauten Linux-Host und Pi: `scripts/cutover/tests/e2e/` — **geprüft** am 2026-09-16 von `vorab` bis `pruefen`, mit Rückwegen für 1c und 5. Nicht nachgestellt: die Reihenfolge für Pis auf `:8000`, echte Pi-Hardware, TLS.

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

Jeder Aufruf mit dem Prod-Overlay nennt die Override-Datei deshalb **mit** — und als letzte die in 1a angelegte `docker-compose.cutover.yml`:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.prod.yml -f docker-compose.cutover.yml <befehl>
```

Der Kürze halber steht unten `$C` dafür:

```bash
cd /home/acm/lumeapps-neu
C="docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.prod.yml -f docker-compose.cutover.yml"
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

## 0b. Vorher: Wohin zeigen die Pis?

**ungeprüft** — braucht einen Pi.

Schritt 1 schließt `:8000` am Altprojekt. Zeigen die Pis heute direkt auf die API (`http://192.9.201.9:8000`), sind ab diesem Moment alle Bildschirme schwarz — lange bevor der Signage-Stack läuft. Auf einem Pi nachsehen:

```bash
grep -h 'SIGNAGE_API_BASE\|--app=' /home/signage/.config/systemd/user/signage-sidecar.service \
                                    /home/signage/.config/systemd/user/signage-player.service
```

| Adresse enthält | Folge |
|---|---|
| `:8000` | Signage zuerst umziehen: Schritt 3 (nur `acm-signage`), 4d und 5, **dann** Schritt 1. Die Übernahme läuft dann noch gegen `lumeapps_default` und `lumeapps-db-1` — die Namen stimmen vor 1c ohne Weiteres. |
| `:80` oder keinen Port | Reihenfolge wie unten. Das gehärtete Altprojekt liefert `/player/*` und `/api/signage/*` weiter über Caddy aus. |

Alle Pis prüfen, nicht nur einen — sie wurden nicht zwingend mit derselben Adresse eingerichtet.

---

## 1. Altprojekt härten

**geprüft** — lokal gegen den vollständigen Stack: keine Host-Ports außer `:80`, API als `uid 10001`, kein `--reload`, gebaute Oberfläche unter `/`, Anmeldung mit echtem Directus-Token erfolgreich.

**Nachtrag 2026-09-16, gegen einen nachgebauten Linux-Host** (`scripts/cutover/tests/e2e`): Der lokale Lauf unter macOS hatte eine Lücke. Unter Linux scheitert das `mv` von `postgres_data` als `acm` an den Rechten, die Schleife lief weiter, und der neue Stack startete mit einer leeren Datenbank — alle bisherigen Prüfungen grün. Die Befehle in 1c verschieben deshalb als root per `docker run`, und die Prüfung zählt Personen in der Datenbank.

**Vorher am Host gemessen** (2026-09-10, aus dem LAN), damit hinterher vergleichbar ist, was sich geändert hat:

| Befund | Zustand heute |
|---|---|
| 1 Vite-Dev-Server | `:5173` offen, liefert `/@vite/client` |
| 2 API direkt im LAN | `:8000` offen, `/docs` gibt die vollständige Routenliste her |
| 4 Personaldaten | `/api/hr/embed/birthdays/this-week` liefert ohne Anmeldung Name, Abteilung, **Geburtsdatum mit Jahrgang** und Alter |

Richtig gebunden ist schon jetzt Directus (`127.0.0.1:8055`). Postgres hat **gar kein**
Host-Mapping — `docker ps` zeigt für `lumeapps-db-1` nur `5432/tcp`, die Datenbank ist also
ausschließlich im Docker-Netz erreichbar. (Hier stand vorher „beide nur auf 127.0.0.1"; am
Host nachgemessen am 2026-09-17, als der Tunnel für § 4 darauf auflief.) Wer von außen
lesend heran will, tunnelt deshalb nicht auf `127.0.0.1`, sondern auf die Container-Adresse:

```bash
IP=$(ssh acm@192.9.201.9 'docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" lumeapps-db-1')
ssh -f -N -L 5433:"$IP":5432 acm@192.9.201.9
```

Die Container-Adresse gilt nur, solange der Container läuft; nach einem Neustart auf dem Host
zeigt der Tunnel ins Leere und muss mit der neuen Adresse neu aufgebaut werden. Vom `compute`-
Container aus ist das lokale Ende als `host.docker.internal:5433` erreichbar.

### 1a. Neuen Stand holen

Das Verzeichnis ist kein Repository (siehe oben). Zwei Wege, beide gangbar:

Frischer Klon **daneben**. Nichts am laufenden Verzeichnis anfassen:

```bash
cd /home/acm
git clone https://github.com/johann-b82/lumeapps.git lumeapps-neu
cd lumeapps-neu
cp ../lumeapps/.env ../lumeapps/docker-compose.override.yml .
grep -q '^COMPOSE_PROJECT_NAME=' .env || echo 'COMPOSE_PROJECT_NAME=lumeapps' >> .env
cat > docker-compose.cutover.yml <<'YAML'
services:
  db:
    ports: !reset []
YAML
git rev-parse --short HEAD > DEPLOYED_COMMIT
```

`docker-compose.cutover.yml` nimmt der alten Datenbank den Host-Port. Am Host
bindet sie `127.0.0.1:5432`; die Plattform braucht in Schritt 3 denselben Port,
und ihr `POSTGRES_PORT` lässt sich nicht verlegen (Supabase nutzt ihn intern).
`!reset` leert die Liste, gleich aus welcher Datei die Bindung stammt — die
Override-Datei mit den DNS-Servern bleibt, wie sie ist. Braucht Docker Compose
ab 2.24 (`docker compose version`). Zugriff auf die alte Datenbank danach über
`docker exec lumeapps-db-1 psql …`. Auch der Rückweg in 1c startet das alte
Projekt mit dieser Datei — nach Schritt 3 hält die Plattform den Port.

Die `COMPOSE_PROJECT_NAME`-Zeile ist keine Kosmetik. Compose leitet den
Projektnamen aus dem Verzeichnis ab, und das Altprojekt setzt keinen eigenen.
Ohne die Zeile hießen nach 1c Netz und Datenbank `lumeapps-neu_default` und
`lumeapps-neu-db-1` — und jeder Übernahme-Befehl in Schritt 4, der
`lumeapps_default` und `lumeapps-db-1` nennt, ginge ins Leere.

Die Datenverzeichnisse (`postgres_data`, `directus_*`, `caddy_*`, `backups`,
`frontend_node_modules`) bleiben vorerst im alten Verzeichnis — sie
ziehen erst beim Umschalten um, wenn nichts mehr darauf schreibt.

`certs/` zieht **nicht** mit: Der neue Stand hat es eingecheckt (nur eine
README), ein `mv` legte das alte als `certs/certs` hinein. Im alten Baum liegt
dort nur das kompromittierte mkcert-Material, das nirgends eingebunden ist —
neues Material kommt in Schritt 2 nach `/home/acm/certs`.

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

# 2) Datenverzeichnisse mitnehmen (jetzt schreibt nichts mehr darauf).
#    Als root in einem Wegwerf-Container: postgres_data gehört dem Postgres-Nutzer
#    (drwx------), und ein Verzeichnis in einen anderen Ordner zu verschieben
#    verlangt Schreibrecht auf das Verzeichnis selbst — ein mv als acm scheitert
#    mit «Permission denied», und der neue Stack legte eine LEERE Datenbank an.
for d in postgres_data directus_database directus_extensions directus_uploads \
         caddy_data caddy_config backups frontend_node_modules; do
  [ -e "/home/acm/lumeapps/$d" ] && docker run --rm -v /home/acm:/h alpine mv "/h/lumeapps/$d" /h/lumeapps-neu/
done
# die PPTX-Folien liegen im alten Quellbaum (gitignored) und fehlen im Klon;
# docker-compose.prod.yml mountet ./backend/media — ohne sie zeigen die
# Bildschirme bei jeder PPTX-Folie ein leeres Bild
[ -e /home/acm/lumeapps/backend/media ] && [ ! -e /home/acm/lumeapps-neu/backend/media ] \
  && docker run --rm -v /home/acm:/h alpine mv /h/lumeapps/backend/media /h/lumeapps-neu/backend/

# Nichts darf liegen geblieben sein — sonst NICHT starten, sondern zurück (unten)
ls -d /home/acm/lumeapps/postgres_data /home/acm/lumeapps/directus_uploads 2>/dev/null \
  && echo "NICHT STARTEN: Daten liegen noch im alten Baum"

# 3) neuen Stack hochfahren
cd /home/acm/lumeapps-neu
C="docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.prod.yml -f docker-compose.cutover.yml"
$C up -d --build
```

Prüfen:

```bash
$C ps --format '{{.Service}}\t{{.Ports}}'          # nur caddy auf :80, db ohne Port
$C exec api id                                     # uid=10001
$C exec api ls /app/tests                          # darf es nicht geben
$C exec api python -c 'import pytest'              # ModuleNotFoundError
$C exec api python -c 'import socket; print(socket.gethostbyname("api.personio.de"))'
curl -sI http://127.0.0.1/ | grep -i x-content-type # nosniff
curl -s http://127.0.0.1/api/hr/embed/birthdays/this-week | head -c 200
$C exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from directus_users"'  # > 0, sonst leere Datenbank
$C exec api ls /app/media/slides | head -3            # PPTX-Folien sind da
docker network ls --format '{{.Name}}' | grep lumeapps  # lumeapps_default, nicht lumeapps-neu_default
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
         caddy_data caddy_config backups frontend_node_modules; do
  [ -e "/home/acm/lumeapps-neu/$d" ] && docker run --rm -v /home/acm:/h alpine mv "/h/lumeapps-neu/$d" /h/lumeapps/
done
[ -e /home/acm/lumeapps-neu/backend/media ] && [ ! -e /home/acm/lumeapps/backend/media ] \
  && docker run --rm -v /home/acm:/h alpine mv /h/lumeapps-neu/backend/media /h/lumeapps/backend/
cd /home/acm/lumeapps && docker compose -f docker-compose.yml -f docker-compose.override.yml \
  -f /home/acm/lumeapps-neu/docker-compose.cutover.yml up -d
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
Stack **jetzt** erreicht — also mit Port und mit den Pfaden aus `.env.example`:

```bash
SITE_URL=http://192.9.201.9:8081
SUPABASE_PUBLIC_URL=http://192.9.201.9:8081/supabase
API_EXTERNAL_URL=http://192.9.201.9:8081/supabase/auth/v1
```

**`API_EXTERNAL_URL` ist der Aussteller im Token**; `compute` prüft ihn, und der
Signage-Stack auch (`PLATFORM_JWT_ISSUER`, siehe 4d). Wenn die
Plattform später auf Port 80 umzieht, ändert sich der Aussteller und alle
ausgegebenen Token werden ungültig — jede angemeldete Person muss sich einmal neu
anmelden. Das ist verkraftbar, aber es soll niemanden überraschen. Wer es vermeiden
will, schaltet das Altprojekt in einem Zug ab und startet die Plattform gleich auf 80.

Beim Umzug auf 80 **im selben Zug** `PLATFORM_JWT_ISSUER` in
`/home/acm/acm-signage/.env` nachziehen und `docker compose up -d signage-api`
dort ausführen. Sonst antwortet die Signage-Verwaltung mit 401 — die Bildschirme
laufen davon unberührt weiter. Dasselbe gilt, falls `JWT_SECRET` der Plattform je
wechselt (`PLATFORM_JWT_SECRET`).

```bash
docker compose up -d --build
bash scripts/bootstrap-admin.sh <ihre-adresse> '<sicheres Passwort>'
```

Prüfen: `http://<host>/` → Anmeldung → Kacheln.

### 3a. Active-Directory-Anmeldung einschalten

**am Host geprüft** (2026-09-17) — gegen das echte AD `acm.local` gefahren: Anmeldung,
Provisionierung des GoTrue-Nutzers, Spiegelung der Gruppen und das Rechte-Mapping.
Damit ist die in ADR-0004 offene „Verifikation gegen ein echtes AD" erledigt, bis auf
die Zertifikate (siehe unten).

Die Werte stehen nicht in der `.env`, sondern in der Tabelle `ad_konfiguration`
(Migration 0055) — ein frisch migrierter Stack bringt sie also **nicht** mit, auch nicht
über die Datenübernahme aus § 4: das Altprojekt hatte keine AD-Anbindung. Einzutragen
sind sie unter `/einstellungen`, Abschnitt „Active Directory", oder direkt:

```bash
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
update public.ad_konfiguration set
  aktiv = true, host = 'acm.local', port = 636,
  upn_suffix = 'acm.local', basis_dn = 'DC=acm,DC=local',
  dienst_konto_dn = null, gruppen_basis_dn = null,
  tls_pruefen = false, geaendert_am = now()
where id;"
```

Vier dieser Werte sind nicht selbsterklärend:

| Feld | Warum so |
|---|---|
| `host = acm.local` | löst auf **beide** DCs auf (`192.9.200.1` = `acm_dc01`, `192.9.200.2` = `acm_dc02`), beide antworten auf 636. Ein einzelner DC-Name wäre ein Einzelpunktausfall |
| `dienst_konto_dn` leer | ohne Dienstkonto bindet `compute` direkt als die anmeldende Person (`<benutzer>@<upn_suffix>`) und sucht über deren Verbindung. Es wird also **kein** Dienstkonto und kein Passwort in `geheimnisse` gebraucht |
| `gruppen_basis_dn` leer | die Gruppen liegen in **zwei** OUs: `grp_IT` und `grp_Marketing` unter `OU=Gruppen,OU=ACM`, die Abteilungsgruppen (`grp_QS`, `grp_Vertrieb`, `grp_Einkauf`, `grp_Produktion`, `grp_Personalabteilung`, `grp_Konstruktion`, `grp_Logistik`) unter `OU=ACM Abteilungen`. Der Filter vergleicht nur *ein* DN-Ende — jede Wahl verschluckt die andere Hälfte lautlos, im schlimmsten Fall `grp_IT` und damit `platform:admin`. Leer heißt: alles spiegeln, Rechte vergibt ohnehin nur das Mapping |
| `tls_pruefen = false` | **Übergangslösung**, siehe unten |

Prüfen, dass der Dienst das Verzeichnis erreicht — noch ohne echtes Konto:

```bash
curl -s http://<host>/api/anmeldung/ad/status                    # {"aktiv":true}
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<host>/api/anmeldung/ad \
  -H 'Content-Type: application/json' -d '{"benutzer":"gibtesnicht","passwort":"falsch"}'
```

Die zweite Zeile muss **401** liefern, nicht 503. 503 (`AdNichtErreichbar`) hieße, der
DC ist nicht erreichbar; 401 beweist, dass der LDAPS-Handschlag steht und nur die
erfundenen Angaben abgelehnt wurden.

#### Rechte: zwei Läufe, in dieser Reihenfolge

Die AD-Gruppen entstehen erst, wenn sich ein Mitglied anmeldet. Vorher hat das Mapping
nichts zuzuordnen. Also:

1. Eine Person aus `grp_IT` meldet sich an (Benutzername ohne Suffix, z. B. `bechtold`).
2. `docker compose exec -T db psql -U postgres -d postgres < scripts/ad-rechte-mapping.sql`
3. **Dieselbe Person meldet sich ab und neu an.**

Schritt 3 ist keine Förmlichkeit: der Claim `apps` steckt im JWT und wird beim Login
gebildet. Wer zwischen Schritt 1 und 2 angemeldet bleibt, trägt ein Token ohne Rechte
und wird von der Oberfläche nicht als Admin erkannt, obwohl in der Datenbank alles
stimmt. Nachsehen lässt sich das vorab:

```bash
docker compose exec -T db psql -U postgres -d postgres -t -c \
  "select public.custom_access_token_hook(jsonb_build_object(
     'user_id', (select id from auth.users where email='<adresse>'),
     'claims', '{}'::jsonb)) -> 'claims' -> 'apps';"
```

Das Skript ist wiederholbar und überspringt noch nicht gespiegelte Gruppen — es läuft
also sinnvollerweise mehrfach, während sich die Belegschaft nach und nach anmeldet.

#### Zwei offene Punkte

**Die LDAPS-Zertifikate sind abgelaufen.** `acm_dc01` und `acm_dc02` präsentieren beide
ein Zertifikat der internen CA `acm-SERVERDC1-CA`, ausgestellt am 8. November 2016 mit
einem Jahr Laufzeit — **abgelaufen am 8. November 2017**. Mit `tls_pruefen = true`
scheitert deshalb jeder Bind. Die Prüfung abzuschalten hält den Verkehr verschlüsselt,
aber nicht mehr überprüfbar: wer sich im Netz dazwischenhängt, sieht die Passwörter
aller Anmeldenden. ADR-0004 nennt TLS am DC „in Produktion Pflicht", und das bleibt
richtig. Entschieden am 2026-09-17: die Zertifikate werden später erneuert, bis dahin
läuft die Anmeldung mit `tls_pruefen = false`. **Nach der Erneuerung am DC gehört das
Feld zurück auf `true`** — ein Einzeiler, siehe Befehl oben.

**Knapp die Hälfte der AD-Konten hat kein `mail`-Attribut** (Stand 2026-09-17: 101 von
249). Für die fällt der Dienst auf den UPN zurück, die Person bekommt also
`name@acm.local` als Adresse statt der Firmenadresse. Das funktioniert, sieht aber
falsch aus und passt zu keiner übernommenen Zeile. Wer das sauber haben will, pflegt
`mail` im AD, **bevor** diese Personen sich zum ersten Mal anmelden — hinterher ist es
ein zweites Konto.

---

## 4. Daten übernehmen

**geprüft** (2026-09-12) — gegen einen Abzug des Produktivsystems, rein lesend über SSH gezogen: alle 73 Tabellenpaare stimmen überein, und 16 Summen über die tragenden Zahlenspalten sind auf beiden Seiten identisch.

### 4a. Alles auf einmal

Ein Lauf holt jeden Fachbereich in der Reihenfolge seiner Abhängigkeiten — Vertrieb, Einkauf, Qualität, Audits, Personal, Schulungen, Kompetenzen, Einarbeitung, Onboarding, Zeugnisse, ATR, Technik, FAIR, Newsletter, Feedback, KPI-Bewertung und die Einstellungen:

```bash
docker network connect lumeapps_default acm-compute-1
QUELLE="postgresql://<user>:<passwort>@lumeapps-db-1:5432/<datenbank>"

# Erst zählen, dann schreiben.
docker compose exec compute python -m app.cli uebernahme --quelle "$QUELLE" --trocken
docker compose exec compute python -m app.cli uebernahme --quelle "$QUELLE"

# Und nachsehen, ob es aufgeht — Rückgabewert 1, wenn eine Zahl abweicht.
docker compose exec compute python -m app.cli abgleich --quelle "$QUELLE"

docker network disconnect lumeapps_default acm-compute-1
```

`--leeren` leert die Zieltabellen vorher. Auf einem frisch aufgesetzten Stack
ist das unnötig; auf einem, der schon Demodaten trägt, ist es Pflicht, sonst
stehen beide Bestände nebeneinander.

**Die SNMP-Communities brauchen den alten Schlüssel.** Sie sind mit dem
`FERNET_KEY` von lumeapps verschlüsselt, nicht mit dem hiesigen. Vor dem Lauf:

```bash
ALT_FERNET_KEY=<FERNET_KEY aus der .env von lumeapps>
```

Fehlt er, bricht der Lauf ab, bevor eine Zeile geschrieben ist — Absicht: ein
Sensor mit unlesbarer Community ist schlimmer als kein Sensor. (Für einen
reinen Vergleichslauf ohne Messbetrieb gibt es
`UEBERNAHME_COMMUNITY_PLATZHALTER=1`; am Stichtag ist das der falsche Weg.)

**Fünf Abweichungen sind gewollt** und stehen im Abgleich mit `~` statt `!`:
das Tippspiel-Protokoll, zwei Formblatt-Vorgänge, deren Dateien nicht in der
Datenbank liegen, die eine Einstellungszeile, aus der neunzehn Zielwerte und
drei Listen werden, und `schulung_pflicht`: das Kürzel-System entfällt, nur die
grobe Personio-Ebene wandert als Geltung „abteilung“ mit — im Neuen stehen
deshalb weniger Zeilen. `schulung_rolle` → `schulung_rollen` kommt weiterhin
mit (die Tabelle bleibt für den Cutover stehen), ihre Oberfläche ist entfernt.

### 4b. Die Dateien

**geprüft** (2026-09-12) — 416 Dateien übernommen, nichts blieb liegen.

Dateien wandern nicht mit den Zeilen: sie stecken teils als `bytea` in der
alten Datenbank (die erzeugten ATR-Mappen, PDFs und Etiketten, die beiden
Gerüstdateien, die Feedback-Screenshots), teils als Datei in Directus (die 17
FAIR-Zeichnungen). Ein zweiter Lauf holt beides:

```bash
# Directus-Dateien vom alten Host holen — nur lesen
rsync -a acm@<alter-host>:/home/acm/lumeapps/directus_uploads/ ./directus/
docker compose cp ./directus acm-compute-1:/tmp/directus

docker compose exec compute python -m app.cli uebernahme-dateien \
  --quelle "$QUELLE" --directus /tmp/directus
```

Der Lauf legt sie unter genau den Pfaden ab, die die Zeilen nennen oder die
der Dienst selbst vergäbe, setzt `pdf_pfad`, `mappe_pfad`, `etikett_pfad`,
`geruest_pfad` und `bild_pfad` — und bei den Lieferungen `erzeugt_am`, sonst
hält die Maske die Dokumente für nicht vorhanden. `geaendert_am` bleibt dabei
unberührt: eine nachgereichte Datei ist keine Änderung an der Lieferung.

Er ist wiederholbar; vorhandene Dateien werden ersetzt, nicht verdoppelt.

Das Firmenlogo steckt ebenfalls in der alten Zeile und geht von Hand:

```bash
psql "$QUELLE" -t -A -c "select encode(logo_data,'base64') from app_settings limit 1" \
  | tr -d '\n' | base64 -d > logo.png
# in den Eimer `plattform` legen (Pfad <nutzer-uuid>/<zufall>.png) und
# public.plattform_logo darauf zeigen lassen
```

### 4c. Nur einzelne Bereiche (Altweg)

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
dasselbe Token als `acm.atr_scan_token` in der Datenbank — gesetzt als
`supabase_admin`, `postgres` darf den Parameter nicht schreiben:

```bash
docker compose exec db psql -U supabase_admin -d postgres \
  -c "alter database postgres set acm.atr_scan_token = '<Token>';"
```
 Erst „Verbindung
prüfen", dann den Schalter umlegen.

### 4d. Signage

**teilweise geprüft** — Übernahme lokal gegen eine echte Alt-Datenbank gefahren (`acm-signage/docs/setup.md`), die Adressen am Host nicht.

Hintergrund und Einzelheiten in `acm-signage/docs/setup.md`. Die Pfade unten gelten nach Schritt 1c; wer Signage nach 0b vor Schritt 1 umzieht, liest `lumeapps` statt `lumeapps-neu`.

**Stack aufsetzen.** Das Geräte-Secret gehört vor dem ersten Start in die `.env` — `init-env.sh` erzeugt ein neues, und mit dem neuen wäre jedes bestehende Gerätetoken ungültig: jeder Bildschirm zeigte wieder einen Kopplungscode.

```bash
cd /home/acm
git clone https://github.com/johann-b82/acm-signage.git
cd acm-signage
bash scripts/init-env.sh /home/acm/acm-plattform/.env   # übernimmt JWT_SECRET und API_EXTERNAL_URL

ALT=$(grep -E '^SIGNAGE_DEVICE_JWT_SECRET=' /home/acm/lumeapps-neu/.env | cut -d= -f2-)
[ -n "$ALT" ] && sed -i "s|^SIGNAGE_DEVICE_JWT_SECRET=.*|SIGNAGE_DEVICE_JWT_SECRET=${ALT}|" .env
grep -E '^(SIGNAGE_DEVICE_JWT_SECRET|PLATFORM_JWT_ISSUER|SIGNAGE_HTTP_PORT|SIGNAGE_DATA_DIR)=' .env

docker compose up -d --build
curl -s http://127.0.0.1:8080/health                    # {"status":"ok"}
```

`SIGNAGE_DATA_DIR` bleibt auf `./data`, also `/home/acm/acm-signage/data` — `/srv` ist nicht beschreibbar (siehe oben). Der Bau erzeugt auch das Player-Bundle; auf dem knappen Speicher des Hosts nicht während der Betriebszeit bauen.

`PLATFORM_JWT_ISSUER` muss Zeichen für Zeichen `API_EXTERNAL_URL` der Plattform sein (Schritt 3). Stimmt er nicht, geht die Verwaltung mit 401 ab, die Bildschirme nicht.

**Daten übernehmen.** Alte Medien und Folien in den Medienspeicher legen, dann trocken, dann echt:

```bash
mkdir -p data/media/uebernahme
cp -r /home/acm/lumeapps-neu/directus_uploads      data/media/uebernahme/uploads
cp -r /home/acm/lumeapps-neu/backend/media/slides  data/media/uebernahme/slides

docker network connect lumeapps_default $(docker compose ps -q signage-api)
QUELLE="postgresql://<user>:<passwort>@lumeapps-db-1:5432/<datenbank>"

docker compose exec signage-api python -m app.uebernahme --quelle "$QUELLE" \
  --alte-medien /app/media/uebernahme/uploads --alte-folien /app/media/uebernahme/slides \
  --plattform-url http://192.9.201.9:8081 --trocken
# dasselbe ohne --trocken; Rückgabewert 1 heißt: eine Datei fehlte, sie steht namentlich in der Ausgabe

docker network disconnect lumeapps_default $(docker compose ps -q signage-api)
rm -rf data/media/uebernahme
```

`--plattform-url` ist die Adresse, unter der der **Pi** die Plattform erreicht — sie steht danach vor jeder eingebetteten Seite. Zieht die Plattform später auf Port 80 um, den Lauf mit der neuen Adresse wiederholen oder die Einträge in der Verwaltung anpassen.

**Einbettung erlauben.** Der Player läuft auf `http://192.9.201.9:8080`, einem anderen Ursprung als die Plattform. `EMBED_FRAME_ANCESTORS` in der Plattform-`.env` muss ihn zulassen — die Vorgabe `*` tut das; wer einschränkt, nimmt ihn auf:

```bash
EMBED_FRAME_ANCESTORS='self' http://192.9.201.9:8080
```

**Verwaltung prüfen.** In der Plattform die Kachel „Signage" öffnen: Geräte, Playlists und Medien müssen erscheinen. Kommt ein Fehler, zuerst `SIGNAGE_API_URL` der Plattform (Vorgabe `http://host.docker.internal:8080`) und den Aussteller prüfen:

```bash
docker compose -f /home/acm/acm-plattform/docker-compose.yml exec web \
  wget -qO- http://host.docker.internal:8080/health
```

**Die Playlist-Einträge der HR-Tafeln müssen neu gesetzt werden.** Die alten Adressen `/embed/birthdays` und `/embed/joiners` waren offen; die neuen verlangen einen signierten Token je Eintrag. Erzeugen unter `/einstellungen#anzeigen` der Plattform, je einen für „Geburtstage der Woche" und „Neu im Team", und die fertige Adresse in den Playlist-Eintrag vom Typ „Adresse" eintragen. Dazu muss `EMBED_SECRET` in der `.env` der Plattform gesetzt sein — sonst lässt sich keine Adresse erzeugen. Hintergrund: `docs/modules/anzeigen.md`.

---

## 5. Pis umstellen — **entfällt**

**an echter Hardware geprüft** (2026-09-24), und zwar mit negativem Ausgang: Die Umstellung entkoppelt jede Tafel. Der Schritt ist deshalb ersatzlos gestrichen.

Was hier vorher stand — „das Pairing bleibt erhalten, wenn das Geräte-Secret übernommen wurde" — ist falsch. Das Secret war nachweislich übernommen (gleiche Prüfsumme auf beiden Seiten), und trotzdem zeigten die Bildschirme einen Kopplungscode. Der Grund liegt woanders:

| | |
|---|---|
| **Wo das Gerätetoken steckt** | im `localStorage` des Players, unter dem Schlüssel `signage_device_token` — **nicht** in einer Datei auf dem Pi |
| **Woran `localStorage` hängt** | am **Origin**. `http://192.9.201.9` und `http://192.9.201.9:8080` sind verschiedene Origins |
| **Was die Unit aufruft** | `--app=http://192.9.201.9/player/` — **ohne Token in der URL**. Der Player holt es aus dem Speicher |
| **Folge des Portwechsels** | neuer Origin ⇒ leerer Speicher ⇒ kein Token ⇒ Kopplungscode auf jedem Bildschirm |

Nachgestellt im Browser: Mit Token in der URL liefert derselbe Stack die Playlist aus; nach `localStorage.clear()` erscheint auf `/player/` der Kopplungscode.

**Stattdessen** liegt der Player-Weg seit diesem Stand unter demselben Origin wie die Plattform: Caddy reicht `/player/*`, `/api/signage/player/*` und `/api/signage/pair/*` direkt an den Signage-Stack durch (`infra/caddy/Caddyfile`, Snippet `signage_direkt`) — nicht über `web`, damit die Tafeln weiterlaufen, wenn die Anwendung ausfällt. Die Pis behalten ihre Adresse `http://192.9.201.9`, ihre Kopplung und werden **nie angefasst**.

Zu tun ist damit nur noch eines, und es fällt ohnehin in Schritt 6 an: Die Plattform muss den Port des Altprojekts übernehmen, damit dieselbe Adresse weiter trägt. Solange sie auf `:8081` läuft, bedienen die Tafeln sich unverändert am Altprojekt.

`scripts/cutover/pi.sh` und `cutover.sh schritt 5` bleiben im Baum — für den Fall, dass ein Gerät doch einmal auf eine andere Adresse gezeigt werden muss (etwa ein Pi, der laut 0b direkt auf `:8000` steht). Für den regulären Stichtag werden sie nicht gebraucht.

<details>
<summary>Der alte Ablauf, falls ein einzelnes Gerät doch umgestellt werden muss</summary>

Das Pairing bleibt dabei **nicht** erhalten — nach dem Wechsel ist das Gerät unter `/signage/pair` neu zu koppeln.

Ein Gerät zuerst, dann den Rest. Auf dem Pi (Runbook `acm-signage/docs/operator-runbook-lumeapps.md` § 9.5):

```bash
sudo SIGNAGE_API_URL=http://192.9.201.9:8080 /opt/signage/scripts/provision-pi.sh

SIGNAGE_UID=$(id -u signage)
sudo -u signage XDG_RUNTIME_DIR=/run/user/${SIGNAGE_UID} systemctl --user daemon-reload
sudo -u signage XDG_RUNTIME_DIR=/run/user/${SIGNAGE_UID} systemctl --user restart signage-sidecar signage-player
```

`SIGNAGE_API_URL` braucht Schema und Port. Das Skript überschreibt die Units jedes Mal — das ist gewollt und der Weg, die Adresse zu ändern.

Prüfen:

```bash
grep -h 'SIGNAGE_API_BASE\|--app=' /home/signage/.config/systemd/user/signage-*.service   # :8080
curl -s http://localhost:8080/health                                                      # Sidecar
```

Der Port 8080 im zweiten Befehl ist der Sidecar **auf dem Pi**, nicht der Signage-Stack. In der Verwaltung muss das Gerät nach spätestens 30 Sekunden als online erscheinen.

Zurück: dasselbe mit der alten Adresse aus 0b, oder `cutover.sh zurueck 5`. Das Skript sichert beide Units vorher als `*.vor-cutover`, der Rückweg ist also exakt — am 2026-09-24 so gefahren, die drei Tafeln waren binnen einer Minute wieder am Altprojekt.

</details>

---

## port80. Die Plattform übernimmt die Adresse

**geprüft** gegen die Unit-Tests, am Host noch nicht gefahren.

Der Kern des Umzugs ist die **Adresse**, nicht der Dienst. Was heute auf `http://<host>` zeigt, soll morgen dieselbe Adresse benutzen — aus zwei Gründen, die beide teuer wären:

| Wer | Warum die Adresse gleich bleiben muss |
|---|---|
| **Die Bildschirme** | Ihr Gerätetoken liegt im `localStorage`, und der hängt am Origin. Ein anderer Port ist ein anderer Origin: leerer Speicher, Kopplungscode auf jeder Tafel (siehe § 5) |
| **Die angemeldeten Personen** | `API_EXTERNAL_URL` ist der Aussteller im Token. Ändert er sich, sind alle ausgegebenen Token ungültig |

Deshalb wandern in **einem** Zug: die drei Adressen der Plattform, `PLATFORM_JWT_ISSUER` im Signage-Stack und die absoluten `/embed/*`-Adressen in den Medien. Fehlt eine davon, merkt man es erst am dunklen Bildschirm.

```bash
bash scripts/cutover/cutover.sh schritt port80     # hält vorher an
bash scripts/cutover/cutover.sh zurueck port80     # nimmt alles zurück
```

Der Schritt fasst das Altprojekt nicht hart an: Es wird **nicht abgeschaltet**, sondern auf `8082` verschoben (`ALT_PORT`). Es bleibt damit erreichbar, und der Rückweg braucht es. Wer es endgültig abschalten will, tut das später und bewusst — nicht im selben Moment wie den Umzug.

Gesichert wird vor dem ersten Handgriff, jeweils als `*.vor-port80`: die `.env` beider Stacks, die `docker-compose.cutover.yml` des Altprojekts und die Medien-Adressen als Textdatei. Ein zweiter Lauf überschreibt diese Sicherungen nicht — sonst wäre nach dem zweiten Anlauf der Rückweg verloren.

Geprüft wird am Ende selbst: `/`, `/login`, `/api/health` und `/player/` müssen antworten, keine Medien-Adresse darf noch auf den alten Port zeigen, und die beiden Aussteller müssen Zeichen für Zeichen übereinstimmen. Die Prüfung **wiederholt** dabei, bis die Antwort passt (`PORT80_WARTEN`, Vorgabe 60 s): Hinter `/player/` liegt der Signage-Stack, der gerade neu gestartet wurde, und ein einzelner Versuch urteilte sonst über den Anlauf statt über das Ergebnis.

**Vorher erledigen**, sonst ist die Abschlussprüfung rot: die AD-Anmeldung (§ 3a), das Firmenlogo (§ 4b) und die HR-Tafeln unter `/einstellungen#anzeigen`.

---

## 6. Host-Vorlagen anwenden

**ungeprüft**, und bewusst zuletzt (Entscheidung F: vorbereiten, nicht anwenden).

`infra/host/daemon.json` und `infra/host/journald-docker.conf` legen die Log-Aufbewahrung auf Host-Ebene fest. Der Docker-Daemon startet dabei neu — also erst, wenn alles andere steht.

---

## Danach prüfen

| Prüfung | Erwartung |
|---|---|
| Bildschirme | zeigen Inhalt, kein Kopplungscode, PPTX-Folien und HR-Tafeln nicht leer |
| Kachel „Signage" in der Plattform | Geräte online, Medien mit Vorschau |
| `docker compose ps` in beiden Projekten | alles `healthy` |
| Anmeldung einer übernommenen Person | funktioniert, Kacheln passen zur Gruppe |
| Kennzahlen Vertrieb | Zahlen wie im Altprojekt |
| Log-Wachstum nach einem Tag | deutlich unter dem alten Stand |
| `scripts/backup.sh` | läuft durch, Abzug ist mit `pg_restore --list` lesbar |

## Was danach noch offen bleibt

Der Port von **ATR und FAIR**. Alles andere steht: Vertrieb, Einkauf, Produktion, Qualität, Finanzen, Personal, Newsletter, KPI-Bewertung und Seiten-Feedback. Bis ATR und FAIR portiert sind, läuft das Altprojekt für diese beiden weiter — gehärtet, und beide sind ohnehin nur für Admin und QS erreichbar. Rezept in `docs/status.md`, Reihenfolge in `docs/plan.md`.
