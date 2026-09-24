# Handbuch-Screenshots

Die In-App-Hilfe (`/hilfe`) ist textbasiert; für Abschlussbedingung 6 werden die
geänderten/wichtigsten Seiten mit **echten** Screenshots des laufenden,
getesteten Stands bebildert.

## Mechanik (steht bereits)

- Bilder liegen unter `apps/web/public/hilfe/` und werden unter `/hilfe/<name>.png`
  ausgeliefert (Next.js `public/`).
- Eingebunden werden sie als Markdown im Hilfetext (`src/hilfe/*.ts`):
  `![Alt-Text](/hilfe/<name>.png)`. `react-markdown` rendert das als `<img>`.
- Styling: `.prose-hilfe img` in `globals.css` (volle Spaltenbreite, gerahmt).

## Warum die Bilder von Hand kommen

Die Aufnahme selbst muss am angemeldeten Produktivstand entstehen. Das
Screenshot-Werkzeug der Automatisierung kann Bilder nur anzeigen, aber **keine
Dateien exportieren**; eine eigene Anmeldung ist nicht erlaubt. Deshalb werden
die Rohbilder einmal von Hand aufgenommen (Snipping Tool o. Ä.) und unter den
unten genannten Dateinamen abgelegt. Der Einbau in die Hilfe ist dann erledigt.

## Aufnahmeliste

Alle am angemeldeten Stand auf `http://localhost`, Erscheinungsbild **Hell**,
Fensterbreite ~1440 px. Dateiname exakt so, als PNG nach `apps/web/public/hilfe/`.

| Datei | Seite / URL | Was drauf sein soll |
|---|---|---|
| `vertrieb-umsatzverlauf.png` | `/kpi/vertrieb`, Zeitraum **Dieser Monat** | Umsatzverlauf „je Woche" mit den Wochenbalken und der Legende „Umsatz September 2025 / 2026" (Vorjahresvergleich) |
| `belegschaft-stichtag.png` | `/hr/kennzahlen`, Stichtag **2024 · Q4** | Belegschaft mit „Stichtag: 31. Dezember 2024", Kachel „Beschäftigte 70" und den Verteilungen |
| `schulungsmatrix-legende.png` | `/hr/schulungen?ansicht=stand`, „Gesamtmatrix" aufgeklappt | Die Legende „✓ im Turnus · ⚠ Wird fällig · ✗ Überfällig · ○ nie absolviert · · nicht zugewiesen" samt einiger Symbol-Zellen |
| `qualitaet-auditart.png` | `/kpi/qualitaet` | Der Auditart-Filter mit „Behörde · Unterlieferant · Intern · Kunde" |
| `sensoren-einstellungen.png` | `/einstellungen#sensoren` | „Abfrage-Intervall (Sekunden, 0 = aus)" und „Globale Grenzwerte" |
| `fair-kundengruppen.png` | `/fair` | Die klappbaren Kundengruppen (Diehl, Pilatus, Recaro, Safran, Ohne Kunde) und die „zu prüfen"-Kennzeichnung |

Nach dem Ablegen: Web-Image neu bauen und Container tauschen (siehe
`preview-app`), dann zeigen die Hilfeseiten die Bilder.

## Einbau-Stellen (schon vorbereitet)

- `sensoren-einstellungen.png` → `src/hilfe/fach.ts`, Artikel „Sensoren"
- `fair-kundengruppen.png` → `src/hilfe/fach.ts`, Artikel „FAIR"
- `vertrieb-umsatzverlauf.png` → `src/hilfe/kennzahlen.ts`, Artikel „Vertrieb"
- `belegschaft-stichtag.png` → `src/hilfe/kennzahlen.ts`, Artikel „Personal"
- `qualitaet-auditart.png` → `src/hilfe/kennzahlen.ts`, Artikel „Qualität"
- `schulungsmatrix-legende.png` → passender Schulungs-Hilfetext
