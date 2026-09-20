# Anforderungs- und Abnahmematrix Systemvergleich

Grundlage: Übergabe vom 12. September 2026 (`Coding-Agent-Auftrag.md`, `Entscheidungen-Fortsetzung.md`, `Befundzuordnung.md`, `Pruefauftrag.md`, `Periodenpruefung.md`, Änderungsregister). Referenz: Altsystem `lumeapps` (Stand `DEPLOYED_COMMIT ffc9ba0`), laufend unter `http://192.9.201.9`.

Status je Zeile getrennt: **Umsetzung** (offen / in Arbeit / umgesetzt / bewusst nicht) und **Prüfung** (offen / bestanden / fehlgeschlagen / nicht prüfbar). „Nicht prüfbar“ ist kein „bestanden“.

## Gesamtstatus (Stand 13. September 2026)

Alle elf Fachzweige sind umgesetzt und im Zweig `abgleich/integration` zusammengeführt (PR #93). Die Einzeltabellen unten tragen noch den Ausgangsstand „offen“; der tatsächliche Stand je Sammelbereich:

| Sammelbereich | Umsetzung | Automatische Prüfung | Browser-Stichprobe (Koordination) | Unabhängige Abnahme |
|---|---|---|---|---|
| Globale Regeln (NAV, TAB, EDIT, KPI, UI, VER-04B) | umgesetzt | grün | teils bestanden (`browserpruefung.md`) | offen |
| Vertrieb, Einkauf/Produktion, Finanzen, Qualität, HR-Kennzahlen | umgesetzt | grün | teils bestanden | offen |
| HR-Prozesse, Audit/Wartung/Sensoren, ATR, FAIR, Meldungen/Maßnahmen | umgesetzt | grün | teils bestanden | offen |
| Einstellungen/E-Mail/Hilfe, Importe | umgesetzt | grün | teils bestanden | offen |
| Bewusste Nichtübernahmen (KPI-01Z, SET-12/17, SIG-01) | bewusst nicht | — | — | — |
| Handbuch mit echten Produktionsscreenshots (HIL-02) | offen | — | — | blockiert (kein abgenommener Produktivstand) |

Prüfstand: Web 571 Tests, Compute 1200 Tests, CI-Riegel (Logging, service_role) grün; Migrationskette bis `0053` inkl. Rundlauf. Live-Integrationen (Microsoft 365/Graph, Personio-Schreibzugriff, SMB) nur gegen Attrappen. Die **unabhängige Nutzerabnahme** und die **Handbuchbebilderung** bleiben die beiden offenen Abschlussbedingungen.

## Prüfgrenzen dieser Umgebung

| Grenze | Folge |
|---|---|
| Lesender Zugriff auf die Produktionsdatenbank ist in dieser Sitzung nicht freigegeben | Datenparität nur über die Referenzoberfläche (lesend) und den Referenzcode; Rohwertvergleiche gegen die lokale Kopie |
| Referenzoberfläche nur lesend, in der vom Nutzer freigegebenen und angemeldeten Browsersitzung | Keine schreibenden Abläufe in der Referenz; Referenzverhalten schreibender Masken aus dem Code des Altsystems |
| Referenzhost `192.9.201.9` war ab ca. 22:15 (12.09.2026) nicht mehr erreichbar (Zeitüberschreitung, auch per `curl`) | Weitere UI-Referenzwerte erst bei erneuter Erreichbarkeit; bis dahin Referenzcode und Werte der Periodenprüfung |
| Kein Produktivdeployment freigegeben | Handbuch-Screenshots des abgenommenen Produktivstands (HIL-02) bleiben offen |
| Keine autorisierte Test-Integration für Microsoft 365 / Personio-Schreibzugriff | Integrationen nur mit lokalen Tests und Attrappen der Gegenstelle abgesichert |
| Keine unabhängige Prüfinstanz außer einem getrennten Prüf-Agenten | Nutzerabnahme bleibt offen |

## Globale Regeln

| ID | Anforderung | Quelle | Umsetzung | Prüfung | Beleg |
|---|---|---|---|---|---|
| NAV-02 | Benutzermenü über Initialen: Sprache, Abmelden, Einstellungen (nur Admin) | Register | offen | offen | |
| NAV-04 | Upload-Einstieg auf Vertrieb, Einkauf, Produktion-KPI, Finanzen, Qualität-KPI | Register | offen | offen | |
| NAV-05 | Upload nur Admin-Gruppe, serverseitig und bei Direktaufruf | Register | offen | offen | |
| NAV-06 | Bereich „Personal“ sichtbar „HR“ | Fortsetzung | offen | offen | |
| TAB-01 | Paginierung Standard 25, zentral 25/50/100 | Register | offen | offen | |
| TAB-02 | Alle fachlichen Spalten typgerecht sortierbar | Register | offen | offen | |
| TAB-03 | Suche ab >25 Datensätzen vor Suchtext | Register | offen | offen | |
| EDIT-01 | Leseansicht + Bearbeiten, wo Referenz es so macht | Register | offen | offen | |
| KPI-05 | Vergleichszeilen rechts neben Hauptzahl, Stilvorlage | Register | offen | offen | |
| KPI-06 | Farbe fachlich, Pfeil numerisch | Register | offen | offen | |
| KPI-07 | Zeitraum als einheitliches Dropdown | Register | offen | offen | |
| KPI-08 | Datenstand unter Dropdown, modulbezogen | Register | offen | offen | |
| UI-01 | Kachelerklärung einzeilig | Register | offen | offen | |
| UI-02 | Seitenbeschreibung linksbündig | Register | offen | offen | |
| VER-04B | Balken/Fläche bei Zeitachsen | Register | offen | offen | |
| KPI-01Z | Kein KPI-Zoom | Register | bewusst nicht | — | |
| KPI-03/04 | überholt durch KPI-07/08 | Register | überholt | — | |

## Fachliche Anforderungen

| ID | Anforderung | Quelle | Umsetzung | Prüfung | Beleg |
|---|---|---|---|---|---|
| VER-01 | Ganze Euro beibehalten, Rohwerte vergleichen | Register | bewusst nicht (Anzeige bleibt) | offen | |
| VER-02 | Vorperioden-/Vorjahresvergleiche korrekt | Register, Periodenprüfung | offen | offen | |
| VER-03A | Einzelauftragstabelle | Register | offen | offen | |
| VER-03B | Kundenanteil Aufträge/Rechnungen als Säulen mit Legende | Register | offen | offen | |
| VER-04A | Vorjahresreihe Umsatzverlauf | Register | offen | offen | |
| VER-04C | Besuche vor Ort/online getrennt | Register | offen | offen | |
| PRF-01 | Gesamtzeitraum fachlich vollständig | Periodenprüfung | offen | offen | |
| EIN-01 | OTD-Parität | Befund | — | offen | |
| EIN-03 | Reihenfolge OTD → Lieferpositionen (Menge, Suche) → Lager | Register | offen | offen | |
| PRO-01 | Historische Quotendifferenzen | Befund, Periodenprüfung | offen | offen | |
| PRO-02 | Eine Auftragstabelle mit Segmentwahl + Suche | Register | offen | offen | |
| FIN-01 | Materialbewertung abgleichen | Befund | offen | offen | |
| FIN-02 | Personalkosten abgleichen | Befund | offen | offen | |
| FIN-04 | Umschalter Material/Personal | Register | offen | offen | |
| FIN-05 | Alle Abteilungen einzeln | Register | offen | offen | |
| QUA-01 | Audit/Reklamation Rohdaten | Befund | — | offen | |
| QUA-02 | Prüfleistung Prüfer-Prüftag-Nenner | Register | offen | offen | |
| QUA-04 | Drei Ansichten Audits/Reklamationen/Qualitätsprüfung | Register | offen | offen | |
| QUA-05 | Artikelart Fertig/Halbfertig/Alle | Register | offen | offen | |
| QUA-06 | Gesamt-Kachel und -Verlauf, Gesamtziel | Register, SET-01 | offen | offen | |
| QUA-07 | Findings-Tabelle | Register | offen | offen | |
| QUA-08 | Kundenreklamationen-Tabelle | Register | offen | offen | |
| HR-01 | Krankenquote und Datenstand | Befund | offen | offen | |
| HR-04 | Umsatz / Produktions-MA, Ziel 300 € | Register, SET-01 | offen | offen | |
| HR-05 | Wochenbericht-Diagramme | Register | offen | offen | |
| HR-06 | Wochenbericht-PDF | Register | offen | offen | |
| HR-07 | Mitarbeiterwahl Mit Überstunden/Aktive/Alle | Register | offen | offen | |
| HR-08 | Spalten Position/Status/Std.-Woche | Register | offen | offen | |
| NAV-01 | HR-Kennzahlenkachel bleibt; Einarbeitung unter Onboarding | Fortsetzung | offen | offen | |
| ORG-01 | Grafisches Organigramm, Standortfokus, Avatare | Register, Fortsetzung | offen | offen | |
| KOM-01 | Sechs Matrizen vollständig abgleichen | Befund | — | offen | |
| KOM-03 | Matrizen lesen/Bearbeiten | Register | offen | offen | |
| KOM-04 | Klappbare Qualifikationsgruppen | Register | offen | offen | |
| SCH-02 | Standortfilter, Fälligkeitsabgrenzung | Fortsetzung | offen | offen | |
| SCH-03 | Code-/Personio-Zuordnung, Gesamtmatrix | Prüfauftrag | offen | offen | |
| SCH-04 | Drei Register | Register | offen | offen | |
| SCH-05 | Sammelabschluss | Register | offen | offen | |
| SCH-06 | Abteilungen & Vorgesetzte | Register | offen | offen | |
| ONB-03 | Personenwahl Neu/Aktive/Alle | Register | offen | offen | |
| ONB-04 | Checkboxmatrix Inhalt × Abteilung | Register | offen | offen | |
| DOK-02 | Einarbeitungs- & Schulungsvorgänge unter Einarbeitung | Register | offen | offen | |
| ZEU-02 | Textbausteine und Aussteller pflegen, Typen testen | Register | offen | offen | |
| AUD-01 | 21 Audits vollständig | Befund | — | offen | |
| AUD-03 | Vollständige Anlagefelder | Register | offen | offen | |
| AUD-04 | Filter Status/Art | Register | offen | offen | |
| WAR-02 | Vollständige Maschinenanlage | Register | offen | offen | |
| SEN-01 | Offline-/Datenursachen | Befund | offen | offen | |
| SEN-03 | Temperatur- und Feuchteverlauf, 30 Tage | Register | offen | offen | |
| SEN-04 | 1 Stunde | Register | offen | offen | |
| SEN-02 | Min/Max, Änderung 1h/24h | Prüfauftrag | offen | offen | |
| ATR-01 | Lieferungs-/Dokumentenparität | Befund | umgesetzt | offen | Paritätszahlen der lokalen Kopie im Bericht (132 Lieferungen, 851 Positionen, 292 Teile) |
| ATR-04 | Katalog lesen/Bearbeiten/Speichern | Register | umgesetzt | offen | Zeile lesend, „Bearbeiten“ gibt Bezeichnung/Zeichnung/Gewicht frei, „Speichern“ explizit; `teilekatalog.tsx` |
| ATR-05 | Zusatznummer ausblenden | Register | umgesetzt | offen | normalisierte Nummer aus Anzeige entfernt, sucht weiter mit; `limit(500)` weg, `Datentabelle` |
| ATR-06 | Mehrfachauswahl, Containerbeschriftung | Register | umgesetzt | offen | Auswahl über Seiten, `POST /api/atr/container-etikett`; `limit(200)` weg |
| ATR-07 | PO-Nummer/-Positionen, exakte Labels | Register | umgesetzt | offen | „PO-Nummer“ (bestellnummer) im Kopf, „PO Pos“ je Position mit führenden Nullen; Felder existierten in der Übernahme |
| ATR-08 | Seriennummern je Position bearbeiten | Register | umgesetzt | offen | kommagetrenntes Feld, Warnung bei Anzahl ≠ Menge; `durchsicht.tsx` |
| ATR-09 | Statusmodell wie Altsystem | Register | umgesetzt | offen | entwurf→erzeugt→abgelegt, Migration 0048 korrigiert aus erzeugt_am; Übernahme-Mapping belegt |
| ATR-10 | Einstieg Lieferungen, Dropdown | Register | umgesetzt | offen | `/atr`=Lieferungen, `/atr/teilekatalog`=Katalog, Dropdown, `/atr/lieferungen`→`/atr` |
| FAI-01 | Kundenfilter/-sortierung, nach Kunde gruppiert und einzeln klappbar | Fortsetzung | offen | offen | flache Tabelle mit Abnahme 20.09.2026 aufgehoben |
| FAI-02 | PDF, Tabelle rechts neben Zeichnung | Register | offen | offen | |
| FAI-03 | Kopf Kunde/Artikelnr./P/N | Register | offen | offen | |
| FAI-04 | Bubblegröße separat | Register | offen | offen | |
| FAI-05 | OCR je Zeile | Register | offen | offen | |
| FAI-06 | Drag-and-drop-Reihenfolge | Register | offen | offen | |
| MEL-01 | Tabelle + Kanban nach Status | Fortsetzung | offen | offen | |
| MAS-01 | Maßnahmenansicht nach Altsystem | Fortsetzung | offen | offen | |
| NEW-01 | Newsletter mit Testdaten prüfen | Befund | — | offen | |
| SIG-01 | Signage ausgegliedert | Register | bewusst nicht | — | |

## Einstellungen, Importe, Hilfe

| ID | Anforderung | Quelle | Umsetzung | Prüfung | Beleg |
|---|---|---|---|---|---|
| SET-01 | Ziel Umsatz/Produktions-MA 300 €, Gesamtprüfziel leer | Fortsetzung | offen | offen | |
| SET-04 | Nutzer/Gruppen integriert behalten | Register | bleibt | offen | |
| SET-05 | Bereich „E-Mails“ | Register | offen | offen | |
| SET-06 | Appname, Farbrollen, Logoblau, Kontrast | Register | offen | offen | Logoblau `#0041F6`, Logodatei byte-gleich mit `acm-aerospace.com/wp-content/uploads/2025/10/ACM_Logo_Blue_00.png` |
| SET-07 | Logo PNG/JPEG/SVG ≤ 5 MB | Register | offen | offen | |
| SET-08 | Personio-Intervall + manuelle Aktualisierung | Register | offen | offen | |
| SET-09 | Optionale Nachweisübertragung + Kategorie | Register | offen | offen | |
| SET-10 | Sensor-Abfragetakt 5–86400 s | Register | offen | offen | |
| SET-11 | Nur globale Sensorgrenzen | Register | offen | offen | |
| SET-12 | Kein OID-Finder | Register | bewusst nicht | — | |
| SET-13 | ATR-Dateiserverpasswort als Admin-Feld | Register | umgesetzt | offen | Fernet in `geheimnisse`, DB vor ATR_SMB_PASSWORT, nie Klartext; `platform:admin` |
| SET-14 | ATR-Scanintervall in Sekunden, 0 = aus | Register | umgesetzt | offen | freies Intervall, pg_cron alle 10 s + atr_scan_faellig(), lauf_seit gegen Doppelläufe |
| SET-15 | ATR-Verarbeitungsdropdown bleibt | Register | umgesetzt | offen | Dropdown „Was ein Lauf tut“ bleibt; beide Modi getestet |
| SET-16 | E-Mail Microsoft 365 / Graph | Register | offen | offen | |
| SET-17 | Keine WM/Tippspiele | Register | bewusst nicht | — | |
| UPL-01 | Import Materialpreise (Wareneingang) | Fortsetzung | offen | offen | |
| UPL-02 | Importhistorie, Tabellenregeln | Befund | offen | offen | |
| HIL-01 | Seitliche Artikelnavigation | Fortsetzung | offen | offen | |
| HIL-02 | Handbuch zuletzt mit echten Produktiv-Screenshots | Fortsetzung | offen | blockiert (kein abgenommener Produktivstand) | |
