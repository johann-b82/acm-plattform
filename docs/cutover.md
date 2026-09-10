# Ablauf vor Ort

Stand 9. September 2026. Reihenfolge ist Absicht: jeder Schritt lässt sich einzeln abbrechen, ohne den nächsten zu blockieren.

Was hier steht, ist entweder lokal nachgestellt oder ausdrücklich als ungeprüft markiert. Die Marke sagt, worauf Verlass ist.

| Marke | Bedeutung |
|---|---|
| **geprüft** | lokal gegen den vollständigen Stack gefahren |
| **ungeprüft** | braucht den Host, ist hier nur beschrieben |

---

## 0. Vorher: Sicherung der alten Datenbank

**ungeprüft** (das Skript liegt im Altprojekt, der Lauf auf dem Host steht aus)

```bash
cd /srv/lumeapps && ./backup/dump.sh
```

Ohne diesen Schritt gibt es keinen Weg zurück. Erst danach weitermachen.

---

## 1. Altprojekt härten

**geprüft** — lokal gegen den vollständigen Stack: keine Host-Ports außer `:80`, API als `uid 10001`, kein `--reload`, gebaute Oberfläche unter `/`, Anmeldung mit echtem Directus-Token erfolgreich.

```bash
cd /srv/lumeapps
git pull
docker compose run --rm --no-deps --entrypoint sh frontend -c 'npm run build'
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Prüfen:

```bash
docker compose ps --format '{{.Service}}\t{{.Ports}}'   # nur caddy auf :80
docker compose exec api id                              # uid=10001
docker compose exec api ls /app/tests                   # darf es nicht geben
docker compose exec api python -c 'import pytest'       # ModuleNotFoundError
curl -sI http://127.0.0.1/ | grep -i x-content-type     # nosniff
```

Der `git pull` bringt die Sicherheitsarbeit von 2026-09-10 mit: 18 der 21 Befunde sind zu (PRs #145–#151, Stand in `docs/security-findings.md`). Zwei Punkte ändern das Verhalten spürbar und gehören deshalb in die Beobachtung der ersten Stunde:

- **Die Sitzung läuft nach 8 statt 24 Stunden ab.** Die Oberfläche erneuert sie stillschweigend; sollten Nutzer trotzdem unerwartet auf der Anmeldeseite landen, ist `SESSION_COOKIE_TTL` in `docker-compose.yml` die Stellschraube.
- **Der Kiosk-Foto-Weg antwortet nur noch für Personen, die gerade auf einem Board stehen.** Wer ein leeres Bild auf einem Bildschirm sieht, sollte prüfen, ob die Person überhaupt Geburtstag hat oder in den letzten 52 Wochen eingetreten ist — 404 ist dort die richtige Antwort, keine Störung.

Damit sind vier der fünf Hoch-Befunde zu; der fünfte (TLS) folgt im nächsten Schritt.

Zurück geht es jederzeit mit `docker compose up -d` ohne das Overlay.

---

## 2. Zertifikat rotieren

**ungeprüft**

Der private Schlüssel aus `certs/internal.key` lag seit dem ersten Commit im Repo und steht weiter in der Historie. Er ist entfernt, aber falls er je ausgeliefert wurde, gilt er als kompromittiert.

Neues Material erzeugen, unter `/srv/acm/certs` ablegen (außerhalb des Repos, das Verzeichnis ist in `.gitignore`) und in Caddy per Pfad einbinden. Details in `lumeapps/certs/README.md`.

---

## 3. Neuen Stack hochziehen

**teilweise geprüft** — der Kaltstart ist lokal gefahren, die Adressen sind es nicht.

```bash
cd /srv/acm
bash infra/supabase/fetch-upstream.sh "$(cat infra/supabase/UPSTREAM_TAG)"
bash scripts/init-env.sh
```

Vor dem ersten Start in `.env` auf den echten Hostnamen setzen: `SITE_URL`, `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`. **`API_EXTERNAL_URL` ist der Aussteller im Token**; `compute` prüft ihn, und ein späterer Wechsel macht alle ausgegebenen Token ungültig.

```bash
docker compose up -d --build
bash scripts/bootstrap-admin.sh <ihre-adresse> '<sicheres Passwort>'
```

Prüfen: `http://<host>/` → Anmeldung → Kacheln.

---

## 4. Daten übernehmen

Drei Läufe, jeder erst trocken. Alle drei sind **geprüft** gegen eine echte Alt-Datenbank mit 125 Alembic-Revisionen und Directus 11.17.2.

### 4a. Vertrieb und Personen

Ablauf in `docs/setup.md`, Abschnitt „Datenübernahme aus lumeapps". Kurz:

```bash
docker network connect lumeapps_default acm-compute-1
QUELLE="postgresql://<user>:<passwort>@lumeapps-db-1:5432/<datenbank>"

docker compose exec compute python -m app.cli uebernahme-vertrieb --quelle "$QUELLE" --trocken
docker compose exec compute python -m app.cli uebernahme-vertrieb --quelle "$QUELLE"

docker compose exec compute python -m app.cli uebernahme-nutzer --quelle "$QUELLE" --trocken
docker compose exec compute python -m app.cli uebernahme-nutzer --quelle "$QUELLE" > zugaenge.csv

docker network disconnect lumeapps_default acm-compute-1
```

`zugaenge.csv` enthält je Person ein neues Passwort, **einmalig**. Verteilen, dann löschen.

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

Der Port der übrigen Fachmodule — HR, Qualität, Produktion, ATR, FAIR, Newsletter. Bis dahin läuft das Altprojekt weiter, gehärtet. Reihenfolge und Rezept in `docs/status.md` und `docs/plan.md`.
