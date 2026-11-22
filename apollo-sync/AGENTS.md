# apollo-sync für Coding Agents

Für Analysen und Weiterentwicklung ohne die Plattform. Lies zuerst die Regeln — der Server ist das
**Produktions-ERP** der Firma.

## Regeln (nicht verhandelbar)

1. **Nur lesen.** Das Werkzeug kann nichts schreiben; schreibe auch keine eigenen Frames außer den
   dokumentierten Lese-Opcodes.
2. **Eine Sitzung, nacheinander.** Keine parallelen Verbindungen (bringen nichts, kosten Plätze).
3. **Nie Prozesse hart beenden**, während eine Sitzung offen ist; immer über `with Apollo...` arbeiten
   (meldet sich ab).
4. **Sperre respektieren.** Meldet `guard` eine aktive Sperre oder schlägt die Anmeldung mit
   `SessionRefused` fehl: warten (≥ 35 min), nicht wiederholen. `guard --reset` nur, wenn ein Mensch
   bestätigt, dass die Sperre vorbei ist.
5. **Erst spiegeln, dann analysieren.** Einmal `pull`, danach offline gegen SQLite arbeiten.
6. **Test zuerst:** `APOLLO_DB=Test` (gleicher Server, kleinere Daten). Produktion nur lesend und gezielt.
7. Passwort nur über `APOLLO_PWD` bzw. `~/apollo-cred.xml`; nie ausgeben, nie in Dateien schreiben.

## Schnellstart

```
cd apollo-sync && pip install -e ".[service,dev]"
export APOLLO_DB=Test APOLLO_PWD=...
python -m apollo_sync describe kpf_std | head
python -m apollo_sync pull kpf_std --columns kpf_id,kpf_typ,kpf_nr,kpf_datum,kpf_adr_id,kpf_wert,kpf_mandant --db test.sqlite
sqlite3 test.sqlite "SELECT kpf_typ, COUNT(*), SUM(kpf_wert) FROM kpf_std WHERE kpf_mandant=1 GROUP BY 1"
```

Spiegel-Format: eine SQLite-Tabelle je Apollo-Tabelle, Originalspaltennamen + `_recno` (Satznummer,
eindeutig). Datum als ISO-Text, Zeit als `HH:MM:SS.hh`, Bool als 0/1, Strings unverändert (auch
Leerzeichen am Ende). `_apollo_meta` hält die Wire-Typen, `_apollo_pulls` Zeitpunkt und Umfang.

## Python-API

```python
from apollo_sync.client import Apollo
with Apollo.from_env() as a:                                   # eine Sitzung, Abmeldung am Ende
    rows = a.fetch("pos_std", ["pos_kpf_id", "pos_artnr", "pos_menge", "pos_datum"])
    neu = a.fetch("stm_std", ["stm_id", "stm_datum_save"],
                  server_filter=("stm_datum_save", ">=", datetime.date(2026, 11, 1)))  # lohnt, wenn er die meisten Zeilen wegnimmt
```

- `fetch` liefert die Python-Typen des Treibers: double→float, int16/32/64→int, Datum→`date|None`,
  bool→bool, str→str, Zeit→`'HH:MM:SS.hh'`.
- Große Tabellen (`proto_std` ≥ 3,9 Mio. Zeilen, `pkl_std` > 1 GB, `mail_std`): immer nur die nötigen
  Spalten ziehen.
- Serverfilter: nur `>`/`>=`, Typen double/int64/date. Schneller, wenn er die meisten Zeilen
  wegnimmt (Datumsuntergrenzen: 2–10×); behält er fast alles, ist er langsamer als lokal filtern.
  Gefilterte Abfragen liefern die Zeilen in anderer Reihenfolge — bei Bedarf nach Satznummer sortieren.

## Lieferungen weiterentwickeln

`apollo_sync/feeds.py` enthält die 14 Plattform-Lieferungen. Jede Änderung:

1. Testfall in `tests/test_feeds_equivalence.py` ergänzen bzw. anpassen (die Äquivalenz gegen den
   alten Worker gilt nur für die unveränderten Lieferungen).
2. Offline gegen einen Spiegel prüfen: `python -m apollo_sync feed --art <art> --mirror test.sqlite --out out/`.
3. Gegen einen echten Extrakt abgleichen (`odbc-worker/worker_abgleich.py` liest die erzeugte Datei).

## Wo was liegt

| Datei | Inhalt |
|---|---|
| `protocol.py` | Handshake, Abfrageprogramme (0x92/0x93/0xb1), Zeilen-Dekodierung, Logout |
| `schema.py`, `wire_schema.json` | Schema aller 411 Tabellen (Datei, Teildatensatz, Feld, Typ) |
| `client.py` | `Apollo.fetch`, `CachedSource`, Spaltengruppen für Problemtabellen |
| `guard.py` | Sperre nach Server-Abbruch/Ablehnung |
| `mirror.py` | SQLite-Spiegel |
| `feeds.py` | 14 Lieferungen |
| `acm.py` | Plattform-Vertrag und Dienstschleife |

Protokoll-Hintergrund: `CONZEPT16_WIRE_PROTOCOL.md` und `ERGEBNIS_SCHNELLPFAD.md` im Analyse-Workspace
`apollo-datenbankstruktur`.
