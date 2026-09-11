# Backlog: was noch aus `lumeapps` fehlt

Stand 2026-09-11. Grundlage ist die OpenAPI des laufenden Altsystems (337
Operationen auf 274 Pfaden), abgeglichen gegen `acm-plattform`. Jede Zeile ist
ein Arbeitspaket mit eigener Migration, eigenen Seiten und eigenem PR.

## Offen

| # | Modul | Alt (Operationen) | Inhalt |
|---|---|---|---|
| 8 | E-Mail (MS Graph) | 5 | Versand über Microsoft Graph. **Beim Abgleich aufgefallen: im Altsystem ruft ihn niemand auf** — `send_email` hat dort außerhalb des eigenen Routers keinen Aufrufer. Portiert würde ein delegierter OAuth-Ablauf samt Token-Ablage und Einstellungsmaske für etwas, das nichts benutzt. Empfehlung: bauen, wenn der erste Verbraucher da ist (Schulungserinnerungen sind der naheliegende). |

### Innerhalb des Audit-Moduls offen

Auch im Altprojekt nicht umgesetzt, dort als „deliberately out of scope"
dokumentiert (v1.84): Findings und Maßnahmen (CAPA), das Auditprogramm als
Jahresplan, der PDF-Export. Dazu die Rollentrennung Auditor / Lead-Auditor /
Auditierter — mit dem App-Rechtemodell machbar, aber ohne fachliche Vorgabe
nicht zu raten.

## Bewusst nicht übernommen

| Punkt | Grund |
|---|---|
| World Cup / Tippspiel (6 Operationen + 7 Embed-Seiten + Upload) | Entscheidung 2026-09-10: das Turnier ist vorbei. |
| Personio-Rückschreiben | Im Altprojekt vorhanden, aber **inert**: es braucht Schreib-Scopes, die die Zugangsdaten nicht haben, und eine Dokumentenkategorie, die nicht gesetzt ist. Es hat dort nie etwas getan. |
| `POST /api/upload` (Alt-Sammelroute) | Schreibt `sales_records`, seit v1.54 abgelöst (siehe `docs/inventory.md`). |
| Zweisprachigkeit (DE/EN, 1.951 i18n-Schlüssel) | Der neue Stack ist einsprachig deutsch. Alle Beschriftungen stehen im Klartext im Markup; ein Sprachschalter war nie in Gebrauch. Wenn er gebraucht wird, ist er nachrüstbar — aber nicht als Nebenprodukt der Portierung. |
| Directus, Forward-Auth, Phase-Guards | Siehe Löschliste in `docs/inventory.md`. |

## Der Abgleich, zuletzt gemacht am 2026-09-11

Der Altstack lief dafür noch einmal in Docker (Port-Overlay, Caddy auf 8081).
Seine OpenAPI: **274 Pfade, 337 Operationen** — identisch zum Abzug vom Beginn
des Durchgangs, es hat sich also nichts unter der Hand geändert.

Verglichen wurde Domäne für Domäne gegen den neuen Stand: 56 compute-Routen und
87 Tabellen und Sichten. **Jede Alt-Domäne hat eine Entsprechung.** Die Tabelle
darüber („Bewusst nicht übernommen") und die zwei offenen Punkte sind der ganze
Rest.

Zwei Dinge, die beim Vergleichen auffielen und hier festgehalten gehören:

* Drei Routen, die ich zunächst als fehlend notiert hatte, gibt es — unter
  anderen Pfaden: `/api/atr/lieferungen/{id}/erzeugen`,
  `/api/kompetenzen/{bereich}/vorschau`,
  `/api/wartung/maschinen/{id}/bogen.pdf`. Ein Abgleich über geratene Namen
  taugt nichts; gezählt wurde deshalb gegen die tatsächliche Liste.
* **Befund 4 im direkten Vergleich:** die alte Route
  `GET /api/hr/embed/birthdays/this-week` antwortet auf dem laufenden Altstack
  ohne jede Anmeldung mit 200. Die neue Entsprechung
  `GET /api/anzeige/geburtstage` verweigert ohne Token. Nachgemessen, nicht
  behauptet.

## Abgeglichen und vollständig

Vertrieb, Einkauf, Produktion (Kennzahlen), Qualität (Kennzahlen), Finanzen,
Personal (Kennzahlen, Belegschaft, Wochenbericht), Newsletter, KPI-Bewertung,
Seiten-Feedback, FAIR, ATR (vier Teile), Uploads (13 Routen; die 16 alten minus
Tippspiel, minus der abgelösten Sammelroute, minus zweier zusammengelegter
Preisdateien), Personio-Abgleich, Rechteverwaltung, Sensoren, Wartung, Schulungsmatrix,
Dokumentenlauf (Einarbeitungsplan und Schulungsnachweis), Hilfe in der Anwendung
(22 Seiten, für diesen Stand geschrieben — die 21 Seiten des Altprojekts
beschreiben dessen Oberfläche und wären ab dem ersten Tag falsch).
Anzeigen für die Bildschirme (Geburtstage, Neuzugänge) — nicht 1:1, sondern
mit signiertem Token statt offener Route, siehe `docs/modules/anzeigen.md`.
Signage liegt im eigenen Repo `acm-signage`.

## Die weiteren Sprachen

Das Fundament steht (Deutsch und Englisch, Umschalter in der Kopfzeile). Welche
Sprachen **darüber hinaus** angeboten werden sollen, entscheidet die
Belegschaft: gefragt ist die Muttersprache aus Personio.

Der Befehl dafür ist da:

```
docker compose exec compute python -m app.cli personio-sprachen
```

Er liest die Mitarbeiter-Rohdaten des Abgleichs — ohne Netz, denn das Feld
steht dort schon — und listet Feld, Wert und Anzahl. Liegt kein Abgleich vor,
fragt er Personio direkt; dafür braucht er Zugangsdaten, entweder aus
Einstellungen → Personal oder aus der Umgebung.

Am 2026-09-11 einmal live gefragt (`--live` fragt Personio direkt, statt den
abgeglichenen Bestand zu lesen — auf einem Stand mit Demodaten steht das Feld
sonst nie darin): **250 Personen, kein einziges Feld, dessen Name nach Sprache
aussieht.** Personio führt rund 200 Felder, darunter kein „Sprache",
„Muttersprache" oder „Mother tongue". Die Muttersprachen lassen sich also
nicht abfragen, solange HR kein solches Feld pflegt.

Der einzige Anhalt ist die Nationalität, in zwei verschieden gefüllten
Feldern („Nationalität" und „Nationalität (DATEV LODAS)"). Zusammengelegt über
die 73 aktiven Personen: 25 Deutschland, 5 Syrien, 4 Iran, je 3 Bulgarien,
Indien, Afghanistan und Ukraine, 2 Polen, je 1 Gambia, Marokko, Liechtenstein,
Vietnam, Rumänien, Äthiopien, Ghana, Spanien, Österreich, Schweiz — und 15 ohne
Angabe. Nationalität ist nicht Muttersprache, und kein Block ist groß genug,
dass er sich von selbst aufdrängt.

**Angeboten werden seit dem 2026-09-11 acht Sprachen**: Deutsch, Englisch,
Arabisch, Persisch/Dari, Ukrainisch, Bulgarisch, Polnisch, Vietnamesisch — jede
Nationalität mit mindestens zwei Personen, die nicht schon von Deutsch oder
Englisch abgedeckt ist. Eine Sprache ist **eine Datei** unter
`apps/web/src/texte/` und ein Eintrag in `texte/index.ts`, `SPRACHEN`,
`SPRACHE_LABEL`, `SPRACHE_TAG`, `ZAHL_TAG` und `SCHREIBRICHTUNG`; der Typ des
deutschen Wörterbuchs erzwingt die Vollständigkeit.

**Die sechs neuen Wörterbücher sind maschinell übersetzt.** Vor dem Ausrollen
sollte je Sprache jemand darüberlesen, der sie spricht; in jeder Datei steht
das als Kommentar. Die Übersetzer haben Begriffe genannt, bei denen sie
unsicher waren — vor allem „Werkbänke" (gemeint ist die verlängerte Werkbank,
also Lohnfertigung), „Arbeitszeugnis" (in mehreren Rechtsordnungen ohne
Entsprechung) und der Stand „verworfen".

Arabisch und Persisch laufen von rechts nach links. Die Oberfläche ist dafür
auf logische Kanten gesetzt (`ms-`/`me-`, `text-start`/`text-end`), `dir` steht
am `<html>`, und `Intl` rechnet über `ZAHL_TAG` mit `-u-nu-latn`: die Zahlen
bleiben in den gewohnten Ziffern, damit eine Tafel neben der deutschen
vergleichbar bleibt.

**Deutsch bleiben drei Dinge, weil sie Inhalt sind und keine Oberfläche:** die
22 Hilfeseiten (jede Fremdsprache sagt das ausdrücklich — ein Test wacht
darüber), der Newsletter, und die Zielwerte samt Beschreibung, die in der
Tabelle `zielwerte` stehen.
