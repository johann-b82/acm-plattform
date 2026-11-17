# Einarbeitung — Serie erzeugen und zentraler Upload

Der Massen-Weg für die Produktion: für alle Personen eines Bereichs auf einmal
Einarbeitungsbögen erzeugen, ausdrucken, unterschreiben lassen und die
unterschriebenen Bögen gesammelt wieder einlesen. Baut auf dem
[Dokumentenlauf](dokumentenlauf.md) auf — jeder Bogen ist ein Vorgang mit QR.

## Der Bogen

Je Produktionsmitarbeiter eine Seite (Formblatt Fbl. 28), gegliedert in:

1. **Allgemeine Onboarding-Punkte** (`einarbeitung_allgemein`): Personalwesen,
   Sicherheitstechnische Unterweisung, Arbeitsplatz-/Bereichseinweisung, PSA,
   Safety Management System, Grundlagen Produktion, ERP/BDE. Jeder Punkt hat
   einen festen Einweiser; ist er leer, steht der Bereichsleiter dort.
2. **Aufgabenfamilien des Bereichs** (`kompetenz_familien`): als Thema mit
   ausformulierter Beschreibung, Ansprechpartner ist der Bereichsleiter.

Spalten: **Thema · Ansprechpartner · Inhalt (Beschreibung) · Wann? · Erledigt /
Unterschrift**. Am Fuß die Feedbackgespräch-Bestätigung (Datum · Unterschrift
Vorgesetzter) und die Einarbeitungsregeln. Die Freigabe (Erstellt: M. Brose /
Geprüft: F. Gomes / Freigegeben: M. Brose) steht als **Seitenfußzeile auf jeder
Seite**, mit Seitenzahl „Seite X von Y". Vorgesetzter/Stelle/Tätigkeitsbeginn
kommen aus Personio, „Einarbeitung bis" = Beginn + vier Wochen.

## Der Ansprechpartner ist der Bereichsleiter — mit zwei Regeln

`kompetenz_bereiche.leiter` hält je Bereich den Abteilungsleiter. Zwei Regeln
halten ihn plausibel (`serie.effektiver_leiter`):

* Ist die Person **selbst** der Bereichsleiter, steht der **oberste Leiter**
  (Antonio Trombatore) als Ansprechpartner — niemand weist sich selbst ein.
* Ist der Bereichsleiter **später eingetreten** als die Person, war er zur
  Einarbeitung noch nicht da; dann ebenfalls der oberste Leiter.

Der oberste Leiter ist vorerst eine Konstante (`serie.OBERSTER_LEITER`); er
gehört später in die Einstellungen.

## Serie erzeugen

`POST /api/einarbeitung/serie?bereich_id=` (Recht `hr: editor`). Für jede Person
aus `person_bereich` des Bereichs: Inhalt bauen (allgemeine Punkte + Familien),
Bogen als PDF mit QR, Vorgang in `dokumentvorgaenge` anlegen (Stand `erstellt`).
Gibt die angelegten Vorgänge zurück (`serie.erzeuge_bereich`).

Die Erzeugung braucht **LibreOffice** (PDF) und den **Storage** — sie läuft auf
der Plattform, nicht im Testlauf. Geprüft sind die Planung (`plan_person`) und
die Leiter-Regel.

## Zentraler Upload

`POST /api/einarbeitung/upload` nimmt **viele** Scans auf einmal
(`upload.ein_blatt` je Blatt): den QR lesen, den Vorgang über die Kennung
finden, den Scan ablegen und den Vorgang gegen das Blanko prüfen und auf
**geprüft** (abgeschlossen) setzen. Der unterschriebene Scan ist damit der
Nachweis am Vorgang und jederzeit abrufbar (`GET /api/dokumente/{id}/scan`).

Ein Blatt ohne lesbaren QR oder ohne passende Kennung kommt als **nicht
zugeordnet** zurück. Für Altbestände ordnet `POST /api/einarbeitung/upload/manuell`
(employee_id + Datei) den Bogen von Hand einer Person zu und legt ihn direkt als
**abgeschlossen** ab.

## Datenmodell

```
kompetenz_bereiche.leiter    text — Abteilungsleiter je Bereich (0070)
einarbeitung_allgemein       thema, ansprechpartner (leer = Bereichsleiter),
                             beschreibung, reihenfolge, aktiv (0070)
```

Die Aufgabenfamilien und ihre Beschreibungen stehen in `kompetenz_familien`
(aus dem Interview-Import, danach in der Oberfläche gepflegt). Die Vorgänge und
Nachweise liegen wie gehabt in `dokumentvorgaenge` / `dokument_nachweise`.

## Noch offen

* **Oberfläche**: „Serie erzeugen" (Bereich wählen → Knopf → Druck-PDF) und die
  Stapel-Upload-Fläche samt Liste „nicht zugeordnet". Die Endpunkte stehen; die
  Seite fehlt noch (8 Sprachen).
* **Druck-PDF**: `serie` legt die Vorgänge an und gibt die Liste zurück; ein
  zusammengeführtes PDF über alle Blätter eines Laufs fehlt noch.
* **Footer-Namen und oberster Leiter** als pflegbare Einstellung statt Konstante.
* **Bemusterung, QS, Versand, Verpackung**: sobald die Interviews Stufen tragen.
