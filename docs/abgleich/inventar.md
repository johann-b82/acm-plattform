# UI-Inventar für die globalen Regeln

Stand vor dem Umbau (12.09.2026), erhoben aus `apps/web/src`. Je Verwendung die zuständige Regel und der Zweig, der sie umsetzt. Der Prüfstatus steht in `anforderungsmatrix.md` und nach der Integration je Zeile hier.

## Tabellen (TAB-01/02/03)

Vor dem Umbau: keine Tabelle sortierbar, keine blätterbar, kein gemeinsamer Tabellenbaustein. Harte Grenzen: ATR-Teile 500, ATR-Lieferungen 200, Upload-Verlauf 20, Upload-Fehlerzeilen 50, KPI-Funktionen 500 (Einkauf, Finanzen, Produktion, Qualität), Ladenhüter 20, Kundenanteil Top 10, Wochenliste 26; sonst PostgREST-Maximum 1000 Zeilen.

| Route | Tabelle | Zweig | Status |
|---|---|---|---|
| /kpi/vertrieb | Top-Kunden, Aufträge je Erfasser, neu Einzelaufträge | vertrieb | offen |
| /kpi/einkauf | Ladenhüter, Lieferpositionen | einkauf-produktion | offen |
| /kpi/produktion | Aufträge in Verzug / überfällig offen | einkauf-produktion | offen |
| /kpi/finanzen | Personalkosten je Abteilung, Materialverbrauch | finanzen | offen |
| /kpi/qualitaet | Prüfbuchungen, Audits ohne Level, neu Findings, neu Reklamationen | qualitaet | offen |
| /hr/kennzahlen | Mitarbeitertabelle, Wochenbericht, Belegschaftslisten | hr-kennzahlen | offen |
| /hr/organigramm | Baum (Spezialfall, grafisch) | hr-kennzahlen | offen |
| /hr/kompetenzen, /[id] | Matrixliste, Qualifikationsmatrix (Spezialfall) | hr-module | offen |
| /hr/schulungen, /[id], /matrix, /offen | Katalog, Teilnehmer, Gesamtmatrix (Spezialfall), offene Schulungen | hr-module | offen |
| /hr/onboarding, /hr/einarbeitung, /hr/dokumente, /hr/zeugnisse | Eintritte, Planliste, Inhalte/Matrix, Vorgänge, Zeugnisse | hr-module | offen |
| /atr, /atr/lieferungen, /[id] | Teilekatalog, Lieferungen, Positionen | atr | offen |
| /fair, /fair/[id] | Zeichnungen, Messwerte (manuelle Reihenfolge) | fair | offen |
| /produktion, /[id] | Maschinen, Aufgaben, Dateien | audit-wartung-sensoren | offen |
| /qualitaet, /[id] | Audits, Phasen, Verlauf | audit-wartung-sensoren | offen |
| /kpi/bewertung | Maßnahmen (neu zentral) | meldungen-massnahmen | offen |
| /platform/feedback | Meldungen (neu Tabelle + Kanban) | meldungen-massnahmen | offen |
| /uploads | Fehlerzeilen, Verlauf | einstellungen-hilfe | offen |
| /signage/* | Playlists, Zeitpläne, Geräte, Einträge | einstellungen-hilfe | offen |
| /einstellungen | Normmatrix, Phasenschritte (qualitaet); Zugänge; Sensoren; Kennzahlen; ATR-Vorlagen | jeweils Fachzweig | offen |
| /hilfe | Suchtreffer (Liste, keine Tabelle) | — | kein Tabellenfall |
| /embed/* | Tafeln (Anzeige, automatisches Blättern, keine Tabelle) | — | kein Tabellenfall |

## Kennzahlkacheln (KPI-05/06, UI-01)

Gemeinsamer Baustein `Kennzahl` + `Vergleiche` (umgebaut). Fachliche Richtung je Kachel legt der Fachzweig fest und dokumentiert sie im Bericht; eigene Kacheln ohne `Kennzahl` (`hr/belegschaft.tsx`, `hr/wochenbericht.tsx`, `sensoren/sensor-dashboard.tsx`) werden im jeweiligen Zweig angeglichen.

| Seite | Kacheln | Zweig |
|---|---|---|
| Vertrieb | Umsatz, Ø Auftragswert, Aufträge | vertrieb (Richtung), grundlagen (Darstellung) |
| Einkauf | OTD, pünktlich, gesamt, Ø Verzug | einkauf-produktion |
| Finanzen | Materialquote, Materialkosten, Umsatz, Personalquote, ohne Preis | finanzen |
| Produktion | Quote, in Verzug, gesamt, Ø Verzug | einkauf-produktion |
| Qualität | Level 1/2, ohne Level, On Quality, reklamiert, Bezugsmenge, groß, klein, neu gesamt | qualitaet |
| HR | Überstunden, Krankheit, Fluktuation, Personen, Belegschaft, Wochenbericht, neu Umsatz/Produktions-MA | hr-kennzahlen |
| Sensoren | Temperatur/Feuchte je Gerät | audit-wartung-sensoren |

## Zeitfilter und Datenstand (KPI-07/08)

| Seite | Zeitwahl | Datenstand | Zweig |
|---|---|---|---|
| Vertrieb, Einkauf, Produktion, Finanzen, Qualität | gemeinsame Auswahlliste | Uploads je Modul (`datenstand`-Sicht), unter der Auswahl | grundlagen — umgesetzt |
| HR-Kennzahlen | Auswahlliste ohne „Alles“ | letzter Personio-Abgleich | hr-kennzahlen |
| HR-Wochenbericht | Kalenderwoche | Personio-Abgleich | hr-kennzahlen |
| Sensoren | 1 h … 30 Tage (neu) | letzte Messung je Gerät | audit-wartung-sensoren |
| Vertriebsaktivität | Wochenfenster aus Zeitraum | wie Vertrieb | vertrieb |
| Belegschaft | Stichtag heute | — | hr-kennzahlen |

## Diagramme (VER-04B)

| Seite | Diagramm | Zeitachse | Umschaltung | Zweig |
|---|---|---|---|---|
| Vertrieb | Umsatzverlauf | ja | ja | vertrieb |
| Vertrieb | 5 × Aktivität je KW | ja | ja | vertrieb |
| Vertrieb | neu Kundenanteile Aufträge/Rechnungen | nein (Kategorien) | nein | vertrieb |
| Einkauf | OTD-Verlauf | ja | ja | einkauf-produktion |
| Produktion | Verzugsquote | ja | ja | einkauf-produktion |
| Finanzen | Materialquote | ja | ja | finanzen |
| Qualität | Level 1/2, On Quality, Prüfleistung | ja | ja | qualitaet |
| HR | Überstunden/Krankheit | ja | ja | hr-kennzahlen |
| HR-Wochenbericht | neu Mehrarbeit/Krankheit je Person | nein (Personen) | nein | hr-kennzahlen |
| Sensoren | Temperatur, Feuchte | ja (echte Zeitachse, dichte Messreihe) | begründet prüfen | audit-wartung-sensoren |

## Formulare (EDIT-01)

Vor dem Umbau: fast alles sofort inline editierbar, Speichern bei Blur. EDIT-01 gilt nur dort, wo die Referenz Lesen + „Bearbeiten“ zeigt; belegt: ATR-Katalog, Kompetenzmatrizen; zu prüfen je Zweig: Einarbeitungsmatrix, Audit-Phasen, Maschinenstammdaten, FAIR-Kopf, Zeugnisse.
