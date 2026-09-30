# Kompetenzen — Umbau auf Soll und Ist (Stufe 0–3)

Dieser Plan baut die Kompetenzmatrix vom alten Modell (Anforderungslevel 0–4
plus Erfüllungsgrad in Prozent) auf eine einheitliche Stufe **0–3** um und macht
sie zur Grundlage der Einarbeitung. Er ist gegen die Interviewdatei
(`ACM_Production_Capability_Interview_20260919.xlsx`) **und** gegen den Code
geprüft. Umsetzung Stufe für Stufe, zuerst die Tests.

## Die Stufe 0–3

| Stufe | Bedeutung |
|---|---|
| 0 | kann die Aufgabe aktuell nicht ausführen |
| 1 | kann unterstützen / lernt noch |
| 2 | kann selbstständig ausführen |
| 3 | kann selbstständig ausführen und andere anlernen / Probleme lösen |

Dieselbe Skala trägt **Ist** (was die Person kann) und **Soll** (was wir
erwarten). Die Differenz ist die Lücke, aus der die Einarbeitung entsteht.

## Festlegungen

- Skala 0–3 für Ist und Soll, in **allen** Abteilungen.
- Der Altbestand wird **vollständig gelöscht**: die sechs alten Matrizen mit
  ihren 1.179 Bewertungen, der alte Parser (`parsing/kompetenzmatrix.py`), der
  Kompetenz-Teil der lumeapps-Übernahme.
- Alle Abteilungen werden im Stil der Produktion neu aufgesetzt:
  **Bereich → Aufgabenfamilien → Personen**.
- Zuordnung **(Abteilung + Team) → Bereich**, dazu eine Abweichung je Person.
- Kein Zieldatum, nur „gewünscht ja/nein". Die **Mindestbesetzung** ist dabei.
- Einarbeitung dauert weiter vier Wochen. „Produktion kennenlernen" gilt für
  **Production, Quality Assurance und Logistics**.
- Rechte wie bisher: sehen mit `hr`, pflegen ab `hr: editor`. Rechte für Team
  Leads kommen später.

## Das Soll auf drei Ebenen

| Ebene | Frage | Träger |
|---|---|---|
| Anforderungsprofil | Was muss man in diesem Bereich / auf dieser Position können? | `kompetenz_profil` |
| Einsatzplanung | Wo wollen wir die Person haben? | `kompetenz_einsatz` |
| Persönliches Ziel | Weicht die Erwartung an diese Person ab? | `kompetenz_bewertungen.soll_stufe` |

Das wirksame Soll je Person und Aufgabenfamilie rechnet die Sicht
`kompetenz_soll_ist`: **persönliches Ziel** vor **Positionsprofil** vor
**Bereichsprofil**; gelten mehrere Zielbereiche, zählt das Maximum. Das Ist ist
die Bewertung, ohne Bewertung 0. So hat auch ein Neueintritt ohne eine einzige
Bewertung sofort ein Soll und damit einen Einarbeitungsbogen.

Wo die Person **heute** arbeitet (Zuordnung aus Personio) und wo wir sie **haben
wollen** (Einsatzplanung) sind zwei verschiedene Dinge. Weichen sie voneinander
ab, ist das genau der Fall für eine Einarbeitung: Versetzung, Vertretung oder
Springer.

## Datenmodell

```
kompetenz_bereiche        id, name, abteilung (Personio), reihenfolge
kompetenz_familien        id, bereich_id, name, beschreibung, reihenfolge,
                          mindest_l2, mindest_l3
kompetenz_bewertungen     familie_id, employee_id, ist_stufe 0–3, soll_stufe 0–3
kompetenz_interview       employee_id, bereich_id, produkte, weitere_bereiche,
                          engpass, validiert_durch, validiert_am, notiz
bereich_zuordnung         abteilung, team (nullable) → bereich_id
bereich_zuordnung_person  employee_id → bereich_id (Vorrang)
kompetenz_profil          familie_id, position_norm (nullable), soll_stufe
kompetenz_einsatz         employee_id, bereich_id, hauptbereich bool
```

Sichten: `person_bereich` (wo jemand heute arbeitet), `kompetenz_soll_ist`
(Soll, Ist, Lücke je Person und Familie), `kompetenz_abdeckung` (Anzahl L2+ und
L3 je Familie gegen die Mindestbesetzung, mit den Warnungen „niemand kann
anlernen" und „hängt an einer Person").

Bewertet wird über die **Personio-ID**, nicht mehr über einen Freitext-Namen.
Nicht zuordenbare Namen aus dem Import kommen nicht in die Daten, sondern in die
Vorschau. RLS für jede Tabelle im selben Commit (`app_level('hr')` zum Lesen,
`app_mindestens('hr','editor')` zum Pflegen).

## Die Stufen

Jede Stufe ist ein abgeschlossener Schritt mit eigenen Tests; zuerst die Tests,
dann der Code.

### A — Grundlage und Altbestand

Die alten Tabellen (`kompetenz_matrizen`, `_kategorien`, `_qualifikationen`,
`_personen`, `_bewertungen`) und die Sicht `kompetenz_stand` entfernen, den
alten Parser und `kompetenzen/uebernahme.py` löschen. Das neue Grundmodell
anlegen: Bereiche, Familien, Bewertungen (Ist/Soll 0–3), Interviewfelder. Den
Nachweis-Trigger aus Migration 0051, seine Funktion und das Nachweis-PDF
(`personio/nachweise.py`) im selben Schritt auf die neuen Tabellen umstellen.
Die Kompetenz-Paare aus `uebernahme/abgleich.py` und `uebernahme/qualifizierung.py`
entfernen (Einarbeitung, Onboarding, Zeugnisse bleiben).

### B — Zuordnung, wo jemand heute arbeitet

`bereich_zuordnung` (Abteilung + Team, Team optional) und
`bereich_zuordnung_person` als Abweichung, dazu die Sicht `person_bereich`.
Startwerte:

| Abteilung | Team | Bereich |
|---|---|---|
| Production | Carpets | Teppich |
| Production | 2nd Lining A350 | Wandverkleidung |
| Production | Cutting | Cutter (Handzuschnitt je Person) |
| Production | Sewing | Näherei |
| Production | Foam | Schäumerei |
| Production | Assembly & Upholstery | Montage Bezieherei |
| Production | Prototyping & Sampling | Bemusterung |
| Quality Assurance | — | QS |
| Logistics | — | Versand |

Das Team steckt in den Personio-Rohdaten unter
`raw_json → attributes → team → value → attributes → name`. In der Oberfläche
eine Liste „nicht zugeordnet" mit Vorschlägen aus den Personio-Teams.

### C — Das Soll

`kompetenz_profil`, `kompetenz_einsatz`, das persönliche Ziel in
`kompetenz_bewertungen.soll_stufe`, die Mindestbesetzung an `kompetenz_familien`.
Die Sichten `kompetenz_soll_ist` und `kompetenz_abdeckung`.

### D — Interviewdatei einlesen

Ablauf wie heute bei den Kompetenzen: erst Vorschau, dann übernehmen. Ein Blatt
ist ein Bereich. **Aufgabenfamilien sind die Spalten zwischen
„Produkte / Produktfamilien" und „Weitere Bereiche"** — damit fällt der
`#REF!`-Fehler der Datei von selbst weg. Blätter ohne „Mitarbeiter"-Kopf
(Start, Capacity View, Tabelle1/2) werden übersprungen, Excel-Datumszahlen
gewandelt, Namen normalisiert (doppelte Leerzeichen). Ein neuer Bereich wird
angelegt, ein bestehender abgeglichen; die Vorschau zeigt neue oder weggefallene
Familien vorher. Größenlimit und `defusedxml` wie bei den anderen Uploads. Tests
gegen eine **anonymisierte** Kopie der Datei, nie gegen `Upload/`.

### D2 — Interview-Vorlage erzeugen

Download je Abteilung im Aufbau der Interviewdatei: Startblatt (Skala und
Ablauf), ein Blatt je Bereich mit den Personen aus der Zuordnung schon
eingetragen, Aufgabenfamilien vorbelegt oder leer, eine 0–3-Auswahlliste, das
Datum als Datum. Rundreise-Test: erzeugte Vorlage, ausgefüllt, liest D
fehlerfrei wieder ein.

### E — Oberfläche

Die Zelle zeigt **Ist → Soll**, eine Lücke in Warnfarbe, Ist über Soll dezent
als Reserve. Personenansicht (heute, Ziel, Lücken), Bereichsansicht
(Mindestbesetzung und die beiden Warnungen), Masken für Profil, Einsatzplanung
und persönliche Ziele. Texte in allen acht Sprachen, die Hilfe angepasst.

### F — Einarbeitung aus den Lücken

Der Katalogteil bleibt wie bisher. Neu im Katalog: „Produktion kennenlernen:
Rundgang durch alle Bereiche und ihre Verbindungen" für Production, Quality
Assurance und Logistics. Dazu automatisch erzeugte Zeilen aus den Lücken: je
Aufgabenfamilie mit Soll über Ist eine Zeile, Abteilung = Bereich,
Ansprechpartner = die Personen mit Stufe 3 (sonst „kein Trainer"), Inhalt z. B.
„Nähen komplex: Ziel Stufe 2 (heute 0)". Dieselbe Rechnung für Bogen,
Onboarding-Paket und Dokumentenlauf. Ohne Personio-ID (frei eingegebene
Angaben) nur der Katalogteil. `einarbeitung_pflicht` bleibt unverändert — keine
neue Geltung, damit sich die gemeinsame Anforderungsmatrix-Oberfläche von
Schulungen und Einarbeitung nicht aufspaltet. Der Bogen bleibt vier Wochen, A4,
eine Seite breit.

### G — Doku

`docs/modules/kompetenzen.md` neu, dazu `einarbeitung.md`,
`personio-writeback.md`, `docs/status.md`, `docs/abgleich/inventar.md` und die
Übernahme-Doku nachziehen.

## Reihenfolge

A → B → C → D → D2 → E → F → G. D und D2 brauchen A und B, F braucht C.

## Nicht enthalten

Rechte für Team Leads, Stunden und Maschinenkapazität, die automatische
Rückmeldung „Einarbeitung erledigt → Ist steigt", die Maschinen-Unterweisungen
als Schulung.

## Erweiterung (Auftrag 30.09.2026): Serien-Bögen mit Kennung und zentraler Upload

Zusätzlich zur Einarbeitung aus den Lücken (Stufe F) kommt ein
Massen-Workflow — er baut auf dem bestehenden Dokumentenlauf auf.

**H1 — Serien-Erzeugung.** Für jede Person der Produktion ein
Einarbeitungsbogen als PDF, jede Person mit einer **zufälligen Kennung**
(kurzer Code, zusätzlich als QR auf dem Blatt). Die Bögen werden ausgedruckt,
in der Produktion unterschrieben. Grundlage: die Personen und ihre
Aufgabenfamilien aus der Interview-Matrix bzw. `person_bereich`.

**H2 — Zentraler Upload.** Eine Sammel-Upload-Fläche im Modul: viele
unterschriebene Bögen auf einmal hochladen. Das System ordnet automatisch über
die **Kennung** (QR/Text) der Person zu; ohne Kennung (Altbestände) über die
Mitarbeiterdaten nach kurzer Bestätigung. Je Zuordnung:

- ein Einarbeitungs-**Vorgang** wird angelegt bzw. abgeschlossen,
- der unterschriebene Bogen wird als **Nachweis** beim Mitarbeiter / Vorgang
  gespeichert und ist jederzeit wieder abrufbar,
- Altbestände werden als **bereits abgeschlossen** übernommen (mit dem Datum
  vom Blatt, nach manueller Bestätigung der Person).

Offene Punkte (mit dem Fachbereich zu klären): Umfang „gesamte Produktion"
(welche Bereiche), Kennungsformat, und ob der Bogeninhalt aus den
Aufgabenfamilien des Bereichs (heutiges Ist) statt aus einem noch fehlenden
Soll-Profil gebildet wird. Die eigentliche PDF-Erzeugung läuft dort, wo
LibreOffice und die Personendaten liegen (der `compute`-Dienst).

## Betrieb

- Vor dem Einspielen von A eine **Datenbank-Sicherung** ziehen; das Löschen des
  Altbestands ist endgültig.
- Die Tippfehler bei den Personio-Positionen korrigieren
  („Produktionsmitarbeitin", „Prodoktionsmitarbeiter"), sonst greifen Profile
  für eine Position nicht.
