# Apollo-Sync — Apollo-Daten ohne Windows-Treiber

Liefert die 14 Apollo-Arten an die Plattform, wie bisher der `odbc-worker` — aber als Container im
Plattform-Stack und direkt über das CONZEPT-16-Protokoll. Entscheidung: ADR-0007.

| Teil | Ort |
|---|---|
| Dienst, Protokoll, Lieferungen | `apollo-sync/` (Python-Paket `apollo_sync`) |
| Annahme, Parser, Upsert | `compute`, `app/routers/odbc.py` (unverändert) |
| Steuerung, Überwachung | *Einstellungen → Datenquelle → Worker* (unverändert) |
| Compose | Dienst `apollo-sync`, Profil `apollo-sync` |

## Datenquelle und Rechenweg

Je Lauf (Takt und aktive Arten aus `GET /api/odbc/konfig`):

1. Eine Apollo-Sitzung öffnen (Sperre prüfen).
2. Jede benötigte Tabelle **einmal** lesen, nur die Spalten, die eine aktive Art braucht
   (`feeds.needs()`, aus dem Code der Arten abgeleitet, 81 von 2.350 Spalten): `kpf_std`, `pos_std`,
   `stm_std`, `adr_std`, `rek_std`, `bestand_std`, `meld_std`, `fa_std`, `vrg_std`.
3. Abmelden.
4. Je Art die Datei bauen (Filter und Joins lokal, Semantik wie die frühere SQL) und an
   `POST /api/odbc/<art>` schicken; danach `POST /api/odbc/status`.

Zeitfenster wie bisher: ab 1.1. des Vorjahres. `kpf_std` und `pos_std` haben kein Änderungsdatum, ein
echtes Delta ist dort nicht möglich; die Projektion macht den Volllauf billig.

## Rechte

Keine eigenen. Der Dienst authentifiziert sich mit `ODBC_SYNC_TOKEN` (wie der Worker) und hat keinen
Datenbankzugang zur Plattform.

## Umschalten vom Windows-Worker

1. `.env`: `APOLLO_PWD` (Apollo-Konto des bisherigen Workers), `ODBC_SYNC_TOKEN` ist schon gesetzt.
2. Prüflauf ohne Senden: `docker compose --profile apollo-sync run --rm apollo-sync python -m apollo_sync feed --alle --dry-run --out /state`
3. Dateien gegen den Worker bzw. einen Extrakt vergleichen (`odbc-worker/worker_abgleich.py`).
4. Worker auf der VM stoppen, dann `docker compose --profile apollo-sync up -d apollo-sync`.
5. In *Einstellungen → Datenquelle → Worker* prüfen: Version `apollo-sync …`, Läufe grün.

Zurück: Dienst stoppen, Worker auf der VM wieder starten.

## Fallstricke

- **Sitzungssperre:** Nach einem Server-Abbruch sperrt Apollo neue Anmeldungen des Benutzers ~30 min —
  es ist das persönliche Konto. Vermieden durch schmale Projektionen, Quarantäne abbrechender Tabellen
  (`/state/quarantine.json`), Vorprüfung auf der Testdatenbank und Abmeldung auch beim Stoppen
  (`stop_grace_period: 15m`). Tritt sie doch ein, wartet der Dienst von selbst (Status meldet
  „cool-down"). Nicht manuell nachstarten, den Container nie mit `kill` beenden.
- **Nur eine Sitzung:** Kein zweiter Dienst, kein paralleler Worker.
- **Schema nach Apollo-Update** neu ernten (siehe `apollo-sync/README.md`).
