# Backlog: was noch aus `lumeapps` fehlt

Stand 2026-09-11. Grundlage ist die OpenAPI des laufenden Altsystems (337
Operationen auf 274 Pfaden), abgeglichen gegen `acm-plattform`. Jede Zeile ist
ein Arbeitspaket mit eigener Migration, eigenen Seiten und eigenem PR.

## Offen

| # | Modul | Alt (Operationen) | Inhalt |
|---|---|---|---|
| 3 | Dokumentenlauf (Schulungsnachweis **und** Einarbeitungsbogen) | ~30 | Dieselbe Mechanik für beide: QR-Code zur Zuordnung, Laufweg (erstellt → übergeben → zurück → geprüft), Scan-Upload, halbautomatische Vollständigkeitsprüfung. Dazu Unterlagen je Schulung und die Zertifikate. Einmal bauen, zweimal benutzen. |
| 4 | Onboarding: Dokumente | ~4 | Das Onboarding-Paket als PDF (Formblatt 71, Dokumentmappe). Eintritte, Schulungsplan, Abteilungs-Übersteuerung und Rollenzuordnung stehen (PR #47). |
| 6 | Zeugnisse: Vorgesetzten-Vorschlag | 1 | Die zweite Unterschrift abteilungsabhängig aus Personio vorschlagen. Zeugnis, Baukasten, KI und Dokument stehen (PR #49). |
| 8 | E-Mail (MS Graph) | 5 | Versand über Microsoft Graph. **Beim Abgleich aufgefallen: im Altsystem ruft ihn niemand auf** — `send_email` hat dort außerhalb des eigenen Routers keinen Aufrufer. Portiert würde ein delegierter OAuth-Ablauf samt Token-Ablage und Einstellungsmaske für etwas, das nichts benutzt. Empfehlung: bauen, wenn der erste Verbraucher da ist (Schulungserinnerungen sind der naheliegende). |
| 9 | Einstellungen: Personio-Auswahllisten | 1 | Die Auswahllisten aus Personio (Abwesenheitsarten) in der Einstellungsmaske vorschlagen, statt IDs abzutippen. Das Logo steht (PR #48). |
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
Preisdateien), Personio-Abgleich, Rechteverwaltung, Sensoren, Wartung, Schulungsmatrix.
Anzeigen für die Bildschirme (Geburtstage, Neuzugänge) — nicht 1:1, sondern
mit signiertem Token statt offener Route, siehe `docs/modules/anzeigen.md`.
Signage liegt im eigenen Repo `acm-signage`.
