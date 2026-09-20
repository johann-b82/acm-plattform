# Datenparitätsbericht

Vergleich der lokalen Plattform (`http://localhost`, Kopie des Produktivbestands) mit der Referenz (`http://192.9.201.9`, `lumeapps` Stand `ffc9ba0`). Lesender Zugriff auf die Produktionsdatenbank ist in dieser Sitzung nicht freigegeben; Referenzwerte stammen deshalb aus der Referenzoberfläche (nur lesend), Rechenwege aus dem Referenzcode.

Bezugszeit aller Prüfungen, sofern nicht anders genannt: 12.09.2026, Zeitzone Europe/Berlin.

Status: **bestanden** (Werte gleich auf Rohwert- oder Anzeigepräzision, Ursache belegt) · **abweichend, begründet** (Entscheidung in `entscheidungen.md`) · **fehlgeschlagen** · **nicht prüfbar**.

## Vertrieb — Kacheln und Vergleiche (VER-01, VER-02)

Rechenweg Referenz: Umsatz `SUM(revenues.wert_eur)` über `revenues.datum`; Ø Auftragswert und Anzahl über `auftraege` mit `wert_eur > 0` auf `auftraege.datum` (`backend/app/services/kpi_aggregation.py:45-85`). Neu identisch in `kpi_vertrieb_summe` (`0002_vertrieb.py`).

Vergleichsfenster Referenz: `frontend/src/lib/prevBounds.ts` — Vormonat/Vorquartal vom ersten Tag bis zum selben Abstand, Vorjahr kalendergleich. Neu seit `feat(kennzahlen)` identisch (E-01).

| Auswahl | Kennzahl | Referenz | Lokal nach Umbau | Status |
|---|---|---:|---:|---|
| Dieser Monat | Umsatz zum August | −79,4 % | −79,4 % | bestanden |
| Dieser Monat | Ø Auftragswert zum August | −85,6 % | −85,6 % | bestanden |
| Dieser Monat | Aufträge zum August | −96,0 % | −96,0 % | bestanden |
| Dieser Monat | Vorjahr (Umsatz/Ø/Anzahl) | −70,8 / −98,0 / −97,4 % | −70,8 / −98,0 / −97,4 % | bestanden |
| Dieses Quartal | Umsatz zum 2. Quartal | +32,4 % | +32,4 % | bestanden |
| Dieses Quartal | Ø Auftragswert zum 2. Quartal | −28,5 % | −28,5 % | bestanden |
| Dieses Quartal | Aufträge zum 2. Quartal | −8,5 % | −8,5 % | bestanden |
| Dieses Quartal | Vorjahr | +42,1 / −8,3 / −51,1 % | +42,1 / −8,3 / −51,1 % | bestanden |
| Dieses Jahr | Vorjahr | −13,0 / −8,0 / −26,6 % | −13,0 / −8,0 / −26,6 % | bestanden |

Ursache der früheren Abweichung: die Plattform verglich „Dieser Monat“ (01.–12.09.) mit dem gleich langen Fenster 20.–31.08., die Referenz mit 01.–12.08.

Referenzwerte: Periodenprüfung der Übergabe vom 12.09.2026 (Referenzoberfläche). Lokale Werte: Browserprüfung am 12.09.2026 nach lokalem Deployment des Zweigs `feat/abgleich-grundlagen`.

## Vertrieb — Kundenanteile, Einzelaufträge, Verlauf (VER-03A, VER-03B, VER-04A/B/C, KPI-06)

**Kundenanteile.** Rechenweg Referenz `compute_customer_share` (`sales_kpi_aggregation.py:300-373`): `SUM(wert_eur)` je `customer_name` im Fenster, kein `> 0`-Filter; Frontend Top 3, aufklappbar bis 14, Rest = Gesamt − sichtbare Summe (`CustomerShareCard.tsx`). Neu `kpi_vertrieb_kundenanteil` mit `top_n => null` (Migration 0041) und `kundensaeulen` im Frontend. Lokale Rohwerte „Dieses Jahr“ 01.01.–12.09.2026:

| Grundlage | Kunde | Referenz | Lokal (Rohwert) | Status |
|---|---|---:|---:|---|
| Aufträge | Diehl Aviation Laupheim GmbH | 3.389.006 € · 69,1 % | 3.389.006,05 € · 69,1 % | bestanden |
| Aufträge | Ethiopian Airlines | 416.272 € · 8,5 % | 416.272,47 € · 8,5 % | bestanden |
| Aufträge | B/E Aerospace Fischer GmbH | 364.516 € · 7,4 % | 364.515,90 € · 7,4 % | bestanden |
| Aufträge | Rest | 736.491 € · 15,0 % | 736.490,73 € · 15,0 % | bestanden |
| Rechnungen | Diehl Aviation Laupheim GmbH | 3.713.342 € · 78,0 % | 3.713.342,46 € · 78,0 % | bestanden |
| Rechnungen | Pilatus Aircraft Ltd | 249.885 € · 5,3 % | 249.884,84 € · 5,2 % | Anzeigerundung |
| Rechnungen | Aircraft Cabin Modification FZE | 228.696 € · 4,8 % | 228.696,15 € · 4,8 % | bestanden |
| Rechnungen | Rest | 568.780 € · 11,9 % | 568.779,66 € · 11,9 % | bestanden |

Gesamt Aufträge 4.906.285,15 €, Rechnungen 4.760.703,11 € (= Kachel Umsatz). Pilatus: 249.884,84 / 4.760.703,11 = 5,2489 %. Die Referenz rundet erst auf 5,25 (`round(…, 2)`) und dann noch einmal auf eine Stelle (`toFixed(1)`) — daraus wird 5,3 %. Die Plattform rundet einmal: 5,2 %. Betrag und Anteil sind dieselben.

„Alles“: die Referenz lädt ohne Von/Bis nichts (`enabled: Boolean(from && to)`); die Plattform rechnet über den ganzen Bestand (E-03).

**Einzelaufträge — 198 gegen 381.** Die Tabelle der Referenz (`SalesTable.tsx`) liest `sales_records`, den 60-Spalten-Altexport, der seit v1.54 für keine Kennzahl mehr benutzt wird; sie lädt höchstens 500 Zeilen. Die Kachel „Aufträge gesamt“ zählt `auftraege` mit `wert_eur > 0`. Beide Mengen stammen aus verschiedenen Tabellen und Importständen; `sales_records` gibt es in der Plattform nicht. Die neue Tabelle zeigt genau die Menge der Kachel: „Dieses Jahr“ 381 Aufträge (von 417 im Zeitraum; 36 mit 0 € zählen nicht), „Alles“ 1.065 (= Kachel) über zwei PostgREST-Seiten. Projekt und Restwert gibt es nur in `sales_records`; beide Spalten entfallen.

**Umsatzverlauf.** Im gewählten Monat nach Kalenderwochen, sonst monatlich (`umsatzTakt`). Vergleichsreihe ist die **Vorjahresperiode** für Monat, Quartal, Jahr und freien Zeitraum; „Alles" ohne (Abnahme-Entscheidung 20.09.2026 — die frühere Vorperiode für Monat/Quartal ist aufgehoben). Die Plattform paart Buckets über eine vollständige Achse beider Fenster: fehlt in der Referenz ein Monat ohne Umsatz, verschiebt sich die restliche Vorjahresreihe nicht.

**Besuche.** `sales_contacts`, `status = 1`, `ORT` vor Ort, `ONL` online, gestapelt; Ziel „3 / Woche“ gilt der Summe (`SalesActivityCard.tsx`, `sales_kpi_aggregation.py:57,85-88`).

**KPI-06.** Umsatz und Aufträge gesamt: mehr ist günstig. Ø Auftragswert: mehr ist günstig (KPI-05: Rückgänge rot).

## Produktion — Verzugsquote-Vergleich (PRO-01, E-02)

Rohwerte der lokalen Kopie, Fenster „Dieses Jahr" (01.01.–13.09.) gegen dasselbe Fenster im Vorjahr:

| Fenster | in Verzug / gesamt | Quote |
|---|---:|---:|
| 2026 | 428 / 506 | 84,6 % |
| 2025 | 311 / 464 | 67,0 % |

- **Unsere Anzeige (direkt):** (0,846 − 0,670) / 0,670 = **+26,2 %** — die relative Änderung der angezeigten Quote; Farbe rot (weniger ist besser, Quote gestiegen).
- **Referenz (Komplement 1−Quote):** (0,154 − 0,330) / 0,330 = **−53,2 %** — dieselbe Bewegung im Termintreue-Raum.

Die Abweichung +26,2 % (lokal) gegen −53,3 % (Referenz) ist damit **belegt** und beabsichtigt (E-02): Pfeil und Prozent folgen der angezeigten Quote, die Farbe der fachlichen Richtung. `kpi_produktion_verzug('2026-01-01','2026-09-13')` bzw. `('2025-01-01','2025-09-13')`, Abfrage am 13.09.2026.

## Qualität — Prüfleistung je Prüfer-Tag (QUA-02)

`kpi_qualitaet_pruefmengen('2026-01-01','2026-09-13','fertig')`:

| Klasse | Wert | Prüfer-Tage (eigener Nenner) |
|---|---:|---:|
| groß | 16,8 | 234 |
| klein | 162,8 | 42 |
| gesamt | 42,7 | 252 |

Jede Klasse hat ihren **eigenen** Nenner `count(distinct (benutzer, pruef_datum))` (Filter `rsc='70000'`, nicht ausgeschlossen, Halbfertig = `artikel ilike 'H%'`). Gesamt (252) ist die echte distinct-Menge über alle Artikel — **nicht** die Summe groß+klein (234+42=276, 24 Kombinationen überschneiden sich). Genau der Nenner, den das Altsystem verworfen hatte und den QUA-02 wiederherstellt. Die Werte treffen die historischen Referenzwerte 16,8 / 162,8 / 42,7.
