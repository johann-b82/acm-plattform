# Backlog: was noch aus `lumeapps` fehlt

Stand 2026-09-10. Grundlage ist die OpenAPI des laufenden Altsystems (337
Operationen auf 274 Pfaden), abgeglichen gegen `acm-plattform`. Jede Zeile ist
ein Arbeitspaket mit eigener Migration, eigenen Seiten und eigenem PR.

## Offen

| # | Modul | Alt (Operationen) | Inhalt |
|---|---|---|---|
| 3 | Schulungen: Nachweise | ~20 | Unterlagen je Schulung (Dateien), Schulungsnachweise mit Unterschrift, Zertifikate, das Protokoll-PDF und der QR-Scan. Katalog, Anforderungsmatrix, Teilnahmen und Fälligkeiten stehen (PR #46). |
| 4 | Onboarding | 16 | Checklisten für neue Personen, Aufgaben je Rolle. |
| 5 | Einarbeitung | 18 | Einarbeitungsplan mit Stationen und Bestätigungen. |
| 6 | Zeugnisse | 19 | Arbeitszeugnis auf der ACM-Briefvorlage, Textbausteine, Notenskala. |
| 7 | HR-Embeds | 3 | Geburtstage und Neuzugänge für die Bildschirme. **Nicht 1:1**: signierter Token statt offener Route, kein Geburtsdatum (Befund 4). |
| 8 | E-Mail (MS Graph) | 5 | Versand über Microsoft Graph. Querschnitt; wird von Onboarding und Schulungen gebraucht. |
| 9 | Einstellungen: Logo | 3 | Firmenlogo (SVG-Reinigung mit `nh3`) und die Personio-Auswahllisten. |
| 10 | In-App-Dokumentation | — | 22 Markdown-Seiten aus `frontend/src/docs/`. Zuletzt, weil sie den fertigen Stand beschreibt. |

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

## Abgeglichen und vollständig

Vertrieb, Einkauf, Produktion (Kennzahlen), Qualität (Kennzahlen), Finanzen,
Personal (Kennzahlen, Belegschaft, Wochenbericht), Newsletter, KPI-Bewertung,
Seiten-Feedback, FAIR, ATR (vier Teile), Uploads (13 Routen; die 16 alten minus
Tippspiel, minus der abgelösten Sammelroute, minus zweier zusammengelegter
Preisdateien), Personio-Abgleich, Rechteverwaltung, Sensoren, Wartung.
Signage liegt im eigenen Repo `acm-signage`.
