# Browserprüfung der Integration

Prüfung durch die Koordination am laufenden lokalen Stack (`http://localhost`, Integrationsstand). Angemeldet als `admin@acm.local` (Plattform-Verwaltung). Referenz `192.9.201.9` war während dieser Läufe zeitweise nicht erreichbar; wo eine Referenzgegenüberstellung fehlt, ist es vermerkt.

Diese Prüfung ist die Entwicklungsabnahme der Koordination, **nicht** die unabhängige Nutzerabnahme (die bleibt offen) und nicht die finale Handbuchbebilderung.

## Bestanden (visuell am Integrationsstand)

| Bereich | Beobachtung | IDs |
|---|---|---|
| Kopfzeile | Benutzermenü hinter Initialen „AD“: Angemeldet als, Sprache, Einstellungen, Abmelden; Escape schließt | NAV-02 |
| Vertrieb | Kacheln mit zwei Vergleichszeilen rechts, „zum August/zum September 2025“; Vorperiodenprozente identisch zur Referenz | KPI-05, VER-02 |
| Vertrieb | Zwei Kundenanteilsdiagramme (Aufträge/Rechnungen), Säulen absteigend, Prozent über Säule, Legende rechts mit Nr./Name/Betrag; Einzelaufträge „von 381“ bzw. „von 1.065“; Besuche vor Ort/online getrennt; Umsatzverlauf Balken/Fläche mit Vorjahresreihe | VER-03A/B, VER-04A/B/C |
| Kennzahlenseiten | Zeitraum als Auswahlliste, Datenstand darunter; Beschreibung linksbündig; Upload-Verweis rechts | KPI-07/08, UI-02, NAV-04 |
| Qualität | Drei Ansichten Audits/Reklamationen/Qualitätsprüfung über Umschalter links; Findings-Übersicht (59, sortierbar, 3 Seiten); Qualitätsprüfung mit Gesamt-Kachel und Gesamt-Verlauf; **Buchungen „1–25 von 2412“ — nicht mehr bei 1000 abgeschnitten**; Artikelart Fertig/Halbfertig/Alle | QUA-04/05/06/07, TAB-01 |
| HR-Kennzahlen | Brotkrumen „HR › Kennzahlen“; neue Kachel „Umsatz / Produktions-MA“ 102.214 € mit „4.906.285 € Aufträge ÷ 48 Köpfe“ und „+47,9 % zum Jahr 2025“; Datenstand = Personio-Abgleich unter dem Dropdown, „Jetzt abgleichen“ | HR-04, NAV-06, KPI-08 |
| ATR | `/atr` öffnet Lieferungen; Dropdown Lieferungen/Teilekatalog; Mehrfachauswahl + „Containerbeschriftung erstellen“; Status „erzeugt“; sortierbare Tabelle mit Suche | ATR-10/06/09, TAB |
| Finanzen | Umschalter Material/Personal links, Zeitraum rechts; Material 117.091 € (echte Kosten nach Vorbelegung), Quote 2,5 %; Personal alle Abteilungen einzeln ohne „Übrige“ (auch 1-Personen-Abteilungen); Datenstand 01.09.26 korrekt (keine „Materialpreise fehlt“-Meldung mehr); Verlauf Balken/Fläche | FIN-04/05, VER-04B, E-05 |
| Einstellungen | Erscheinungsbild: App-Name konfigurierbar, Farbrollen mit Hauptfarbe #0041F6 (Logoblau) hell/dunkel, Logo „PNG/JPEG/SVG ≤ 5 MB“; Bereich „E-Mails“ in der Navigation; Seitengröße 25/50/100 | SET-06/07/05, TAB-01 |
| Hilfe | Themenübersicht mit Suche erhalten; auf `/hilfe/[slug]` seitliche, thematisch gruppierte Artikelnavigation mit markiertem Artikel und „← Alle Themen“ | HIL-01 |
| Meldungen | Tabelle mit Referenzspalten (Datum, Von, Seite, Beschreibung, Screenshot, Status, Aktionen) und Tabelle/Kanban-Umschalter; Kanban „offen (5)“/„erledigt (5)“ nach Status, gleiche Daten und Aktionen | MEL-01 |
| Maßnahmen | „KPI-Bewertung & Maßnahmen“ nach Referenz: Bubbles-Bereich, Formular „Neue Maßnahme“ mit Priorität, zentrale Tabelle mit Statusfilter; bestehende Maßnahme „Test“ erhalten | MAS-01 |
| Organigramm | Grafische Hierarchie mit Verbindungslinien, rechteckige Avatare (Personio-Foto bzw. Initialen), Standortfilter, „74 Personen · 7 ohne Vorgesetzten“, schmal horizontal scrollbar | ORG-01 |
| Produktion | Eine Tabelle mit Segmentwahl „Aufträge in Verzug“/„Überfällige offene Aufträge“, Kunde mit Adr-Nr., sortierbare Spalten, Suche, Seiten | PRO-02, TAB |
| Sensoren | Zeittakt-Dropdown + „Jetzt messen“; je Kachel Temperatur und Feuchte mit Min/Max und Änderung 1h/24h (fehlend „—“), globale Grenzen mit Warnfarbe; Offline-Leerzustand ohne Ersatzwerte | SEN-02/03, SET-10/11, SEN-01 |
| Dunkelmodus | Vertrieb-Dashboard im Dunkelmodus (über das Benutzermenü): dunkler Grund, lesbare Diagramme, Vergleichsfarben und Kundenanteile korrekt | Erscheinungsbild |
| Schreibablauf | Maschine mit allen Feldern angelegt (Name/Inventar-Nr./Standort/Status) → Toast „Maschine angelegt", Wiederanzeige in der sortierbaren Tabelle mit allen Werten; Testdaten danach entfernt | WAR-02 |
| Leerzustand | Produktion-Wartung ohne Maschinen: „Noch keine Maschine — Leg eine Maschine an …" | — |
| Kopfzeile/Kacheln | Hell/Dunkel im Benutzermenü; Kacheln einheitlich (zwei Zeilen reserviert, Icon auf volle Höhe); HR-Kachel Personen-Silhouette; App-Kacheln ebenso; mittiger Header-Titel entfernt (Brotkrumen genügen) | UI-Feinschliff |

## Noch im Browser zu prüfen (nach Abschluss aller Module)

Beide Themes und schmale Ansicht durchgängig; leere/fehlerhafte Zustände; alle Exporte (Wochenbericht-PDF HR-06, FAIR-PDF FAI-02, Container-Etikett ATR-06) öffnen und Inhalt prüfen; OCR und Drag-and-drop in FAIR; Sensor-Zeitfenster 1 h–30 Tage; Nicht-Admin-Sicht (verlangt Anmeldung als `vertrieb@acm.local` durch den Nutzer); schreibende Abläufe (Audit anlegen, Maschine anlegen, Sammelabschluss Schulungen, Materialpreise-Upload) mit Testdaten.

## Technische Anmerkung

Der Segment-Umschalter reagierte in der Automatisierung nur zuverlässig, wenn er im sichtbaren Bereich lag; das ist ein Artefakt der Klicksteuerung, kein Produktfehler (Umschalten per Tastatur/Klick am Element funktioniert). Kein Overlay fängt Klicks ab; die Bubble-Ebene (MAS-01) liegt mit `pointer-events:none` über der Seite, solange der Zeichenmodus aus ist.
