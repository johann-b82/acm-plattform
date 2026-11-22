# KPI-Vergleich: Apollo-Extrakte gegen apollo-sync

Ziel: In der Testumgebung der Plattform (`192.9.201.11`) dieselben KPIs einmal aus den
importierten Apollo-Extrakten und einmal aus den Dateien von `apollo-sync` berechnen und
Wert für Wert vergleichen. Läuft vom Mac aus (SSH-Zugang zum Testhost, LAN-Zugang zu Apollo).

- `kpi_snapshot.sql` — schreibt alle KPI-Werte als ein JSON. Nur lesend (READ ONLY + ROLLBACK).
- `kpi_vergleich.py` — vergleicht zwei Schnappschüsse, Bericht als Markdown (nur Standardbibliothek).

## Warum die Importtabellen geleert werden

Elf der 14 Arten importieren per *upsert*: Zeilen aus den Extrakten, die `apollo-sync` nicht
liefert, blieben sonst einfach stehen, und eine fehlende Zeile fiele in den KPIs nie auf.
Darum: sichern → leeren → nur `apollo-sync` laden → vergleichen → Sicherung zurückspielen.

## Ablauf

Platzhalter: `TEST=acm@192.9.201.11`, `DB` = Name des Postgres-Containers, `ENV` = Pfad der
`.env` der Plattform auf dem Testhost. Beides einmal nachsehen:

```bash
TEST=acm@192.9.201.11
ssh $TEST 'docker ps --format "{{.Names}}\t{{.Ports}}"'          # Plattform läuft? DB-Container?
DB=<db-container>; ENV=<pfad>/.env
psql_test() { ssh $TEST "docker exec -i $DB psql -U postgres -d postgres -v ON_ERROR_STOP=1 $*"; }
```

### 1. Code holen

```bash
git clone -b feat/apollo-sync https://github.com/johann-b82/acm-plattform.git
cd acm-plattform/apollo-sync
python3 -m venv .venv && . .venv/bin/activate && pip install -e '.[service]'
cd tools/kpi_vergleich
```

### 2. Schnappschuss mit den Extrakten (vorher)

Fenster bis Ende Oktober: die Extrakte sind vom 13.–15.11., Apollo hat inzwischen neuere Belege.
`von` = 1.1. des Vorjahres, wie `apollo-sync` liest.

```bash
psql_test -At -v von=2025-01-01 -v bis=2026-10-31 -f - < kpi_snapshot.sql > vorher.json
python3 -c "import json; d=json.load(open('vorher.json')); print(d['tabellen'], len(d['kpi']), 'KPI-Funktionen')"
```

Kommen hier viele `fehler` oder leere Ergebnisse, prüfen die KPI-Funktionen Benutzerrechte —
dann vor dem Vergleich klären (die Fehler stehen im JSON).

### 3. Sichern, Datenquelle umstellen, Importtabellen leeren

```bash
T="revenues auftraege delivery_reliability auftrag_positionen delivery_records goods_receipt_records quality_records inspection_records material_movements material_prices stock_article_prices sales_contacts offers interessenten"
ssh $TEST "docker exec $DB pg_dump -U postgres -d postgres -Fc --data-only $(printf -- '-t public.%s ' $T plattform_einstellungen upload_batches) > ~/kpi_vergleich_sicherung.dump && ls -l ~/kpi_vergleich_sicherung.dump"
psql_test -At -c "\"select datenquelle from public.plattform_einstellungen\""      # merken (vermutlich: upload)
TL="public.$(echo $T | sed 's/ /, public./g')"
psql_test -c "\"begin; truncate $TL; update public.plattform_einstellungen set datenquelle = 'odbc'; commit;\""
```

### 4. apollo-sync gegen Produktion lesen und in die Testplattform laden

Apollo **Produktion, nur lesend** — dieselbe Quelle wie die Extrakte. Eine Sitzung, Abmeldung
am Ende, ca. 5 Minuten. Die Plattform-API ist von außen zu, deshalb ein Tunnel (Port 80 auf dem
Testhost; falls Caddy dort anders lauscht, anpassen):

```bash
nc -z -G 3 192.9.200.134 4722 && echo "Apollo erreichbar"
ssh -f -N -L 18080:127.0.0.1:80 $TEST
export ACM_BASE_URL=http://127.0.0.1:18080
export ODBC_SYNC_TOKEN="$(ssh $TEST "grep '^ODBC_SYNC_TOKEN=' $ENV | cut -d= -f2-")"
[ -n "$ODBC_SYNC_TOKEN" ] || echo "ODBC_SYNC_TOKEN in der .env setzen und compute neu starten"
export APOLLO_DB=apollo
read -rs APOLLO_PWD && export APOLLO_PWD                          # Apollo-Passwort, wird nicht angezeigt
python3 -m apollo_sync feed --alle --von 2025-01-01               # sendet alle 14 Dateien
unset APOLLO_PWD
```

Die Ausgabe zeigt je Art `ok` mit Zeilenzahl oder `fehler` (mit Incident-Datei).

### 5. Schnappschuss mit apollo-sync (nachher) und Vergleich

```bash
psql_test -At -v von=2025-01-01 -v bis=2026-10-31 -f - < kpi_snapshot.sql > nachher.json
python3 kpi_vergleich.py vorher.json nachher.json > bericht.md; echo "Ergebnis: $?"; open bericht.md
```

`0` = alle KPI-Werte gleich, `1` = Abweichungen (Bericht: je Funktion und Monat, mit Beispielen).
Unterschiede sind zu erwarten, wo die Extrakte einen anderen Zeitraum abdecken als ab 1.1.2025
oder wo seit dem Extrakt in Apollo noch Belege im Oktober geändert wurden.

### 6. Zurückspielen

```bash
psql_test -c "\"begin; truncate $TL; delete from public.upload_batches where quelle = 'odbc'; commit;\""
ssh $TEST "docker exec -i $DB pg_restore -U postgres -d postgres --data-only --disable-triggers $(printf -- '-t %s ' $T) < ~/kpi_vergleich_sicherung.dump"
psql_test -c "\"update public.plattform_einstellungen set datenquelle = '<wert aus Schritt 3>'\""
```

Danach Schritt 2 noch einmal laufen lassen und mit `vorher.json` vergleichen — muss identisch sein.
