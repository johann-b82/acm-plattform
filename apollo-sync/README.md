# apollo-sync — Apollo (CONZEPT 16) nativ lesen

Liest Apollo **ohne den Windows-ODBC-Treiber** direkt über das CONZEPT-16-Protokoll (TCP 4722).
Läuft daher unter Linux, macOS und Windows — als Dienst der ACM-Plattform (ersetzt den
Windows-Worker `odbc-worker/`) und als Werkzeug für Analysen und Entwicklung (Coding Agents).

- **Plattform:** `apollo-sync service` erzeugt dieselben 14 Lieferungen wie `odbc-worker/worker.py`
  (`main`) und spricht denselben Vertrag (`/api/odbc/konfig|status|<art>`). `compute` bleibt unverändert.
- **Analysen:** `apollo-sync pull` spiegelt Tabellen in eine lokale SQLite-Datei; danach lässt sich
  ohne Server mit SQL arbeiten (siehe [AGENTS.md](AGENTS.md)).

## Warum schneller und robuster als der Treiber

| | Treiber (`odbc-worker`) | `apollo-sync` |
|---|---|---|
| Plattform | nur Windows (VM nötig) | Linux/macOS/Windows, Container im Plattform-Stack |
| Verbindungsaufbau | 676 Frames (Katalog-Download) | 7 Frames |
| Lesen | 1 Round-Trip je Satz | Server-Abfragepfad, Fetches gepipelined |
| Spalten | Treiber liest ganze Sätze | nur die benötigten Spalten (Projektion) |
| Beispiel `stm_std` | 22 s für **eine** Spalte | 1,5 s für **alle 790** Spalten |

Gemessen (2026-11-22, Produktion): Der Server ist der Engpass (~20–37 Tsd. Zeilen/s, schwankt mit
der ERP-Last). Daraus folgen die Regeln, die der Code umsetzt:

1. **Projektion** — nur benötigte Spalten anfordern (größter Hebel: `kpf_std` 2,3×, `stm_std` bis 25×).
2. **Serverfilter, wenn er die meisten Zeilen wegnimmt** — dann muss der Server sie gar nicht erst
   schicken: die Datumsuntergrenzen der Lieferungen (`Feeds.row_floor`) laufen deshalb auf dem
   Server (Produktion 22.11.: `pos_std` 238 s → 21 s, `meld_std` 48 → 7 s, `bestand_std` 48 → 6 s;
   Zeilen identisch, Satzreihenfolge wird wiederhergestellt). Behält der Filter fast alles, ist er
   langsamer als Projektion + lokaler Filter (`kpf_datum`: 115 s gegen 37 s).
3. **Eine Sitzung** — eine zweite bringt keinen Durchsatz (der Server arbeitet seriell), kostet aber
   Sitzungsplätze.
4. **Jede Tabelle einmal je Lauf**, mit der Vereinigung aller benötigten Spalten (`CachedSource`).

## Korrektheit

- Gegen den Treiber verifiziert: `stm_std` vollständig (39.809 Zeilen, 31.289.874 Zellen, 0 Abweichungen),
  `mwst_std` (0 Abweichungen). Strings behalten Leerzeichen am Ende — genau wie der Treiber.
- Serverfilter: `kpf_datum >= 2025-01-01` liefert exakt dieselben 177.019 Datensätze wie Vollprojektion +
  lokaler Filter, 0 Wertabweichungen. Satznummern sind eindeutig (1.258.725 Zeilen).
- Tests (`pytest`, offline): Abfrage-Frames **byte-genau** gegen die Frames des Treibers; alle 14
  Lieferungen **identisch** mit dem Produktions-Worker auf erzeugten Daten mit Randfällen.
- Typen exakt aus `wire_schema.json` (u. a. int16 statt int32 bei 783 „INTEGER"-Spalten).

**Offen (bewusst sichtbar):** TIME ist aus Daten abgeleitet (`[h][min][s][1/100]`, verlustfrei als Text
`HH:MM:SS.hh`, auch Stunde 24), aber noch nicht gegen den Treiber verglichen; die Lieferungen geben wie
bisher `HH:MM:SS` aus. NUMERIC (1 Spalte, leere Tabelle) und Tabelle `Text` (Schema fehlt) werden nicht
gelesen.

## Schutz des Produktionsservers

Bricht der Server eine Sitzung ab (TCP-Reset), sperrt er neue Anmeldungen desselben Benutzers für
~30 min (Handshake-Code -817/-814; der Treiber meldet „User authorization failed"). `guard.py` merkt sich
das in `APOLLO_SYNC_STATE/guard.json` und verweigert 35 min lang jeden Versuch — auch über Neustarts.
Jede Sitzung meldet sich sauber ab (`0x98`/`0x65`, wie der Treiber), auch beim Stoppen des Dienstes
(SIGTERM beendet erst den Lauf). `Statistiken` bricht ab, wenn alle 595 Spalten in einer Projektion stehen;
der Client liest sie in Spaltengruppen und führt sie über die Satznummer zusammen (verifiziert). Jede
weitere Tabelle, die einmal abbricht, kommt in die Quarantäne (`quarantine.json`): danach nur noch in
kleineren Spaltengruppen, bei erneutem Abbruch gar nicht mehr — dieselbe Tabelle kann keine zweite
Sperre auslösen. `apollo-sync` registriert sich nicht als ODBC-Client (kein `k`-Frame) und belegt so keinen
Lizenzplatz, der nach einem Abbruch hängen bleiben könnte.

## Bedienung

```
pip install -e ".[service,dev]"          # bzw. im Container
export APOLLO_PWD=...                    # Windows: alternativ ~/apollo-cred.xml (DPAPI)
export APOLLO_DB=Test                    # Testdatenbank (gleicher Server)

python -m apollo_sync tables kpf          # offline: Tabellen
python -m apollo_sync describe pos_std    # offline: Spalten, Typen
python -m apollo_sync export kpf_std --columns kpf_id,kpf_nr,kpf_datum -o kpf.tsv
python -m apollo_sync pull kpf_std,pos_std,stm_std --db apollo.sqlite
python -m apollo_sync feed --alle --mirror apollo.sqlite --out out/    # Lieferungen offline
python -m apollo_sync feed --art umsatz --dry-run --out out/           # live, nicht senden
python -m apollo_sync service                                           # Plattform-Dienst
python -m apollo_sync guard                                             # Sperrzustand
```

## Schema neu erzeugen

`wire_schema.json` stammt aus den Projektionsprogrammen des Treibers (Frida-Mitschnitt, Skripte im
Analyse-Workspace `apollo-datenbankstruktur`). Nach einem Apollo-Update auf einem Windows-Rechner mit
Treiber neu ernten und hier ersetzen; `pytest` prüft die Frames danach erneut.

## Tests

```
cd apollo-sync && python -m pytest -q
```
