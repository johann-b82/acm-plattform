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

## Noch im Browser zu prüfen (nach Abschluss aller Module)

Beide Themes und schmale Ansicht durchgängig; leere/fehlerhafte Zustände; alle Exporte (Wochenbericht-PDF HR-06, FAIR-PDF FAI-02, Container-Etikett ATR-06) öffnen und Inhalt prüfen; OCR und Drag-and-drop in FAIR; Sensor-Zeitfenster 1 h–30 Tage; Nicht-Admin-Sicht (verlangt Anmeldung als `vertrieb@acm.local` durch den Nutzer); schreibende Abläufe (Audit anlegen, Maschine anlegen, Sammelabschluss Schulungen, Materialpreise-Upload) mit Testdaten.

## Technische Anmerkung

Der Segment-Umschalter reagierte in der Automatisierung nur zuverlässig, wenn er im sichtbaren Bereich lag; das ist ein Artefakt der Klicksteuerung, kein Produktfehler (Umschalten per Tastatur/Klick am Element funktioniert). Kein Overlay fängt Klicks ab; die Bubble-Ebene (MAS-01) liegt mit `pointer-events:none` über der Seite, solange der Zeichenmodus aus ist.
