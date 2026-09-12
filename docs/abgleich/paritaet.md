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
