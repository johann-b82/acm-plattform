"""Personal aus lumeapps übernehmen: Personio-Bestand und Schulungen.

Zwei Stränge, die sich nicht berühren, aber in einer Reihenfolge stehen müssen.

**Personio.** Die vier Tabellen sind eine getreue Portierung; die Schlüssel sind
beidseitig gleich (`personio_employees.id` eine Zahl aus Personio, Anwesenheit
und Abwesenheit tragen die Personio-Kennung als Text). Also `id_aus="alt"` —
damit bleibt der Bestand mit einem späteren Abgleich gegen Personio deckungs-
gleich, und ein neuer Abgleich aktualisiert die übernommenen Zeilen, statt sie
ein zweites Mal anzulegen. Ein gerechneter Schlüssel wäre hier ein Fehler.

**Schulungen.** Dort wechselt der Schlüssel von `integer` auf `uuid`, also
`id_aus="uuid5"`: aus Tabellenname und alter Zahl wird eine feste UUID
gerechnet. Die Verweise zwischen den Tabellen (Teilnahme → Katalog, Teilnahme →
Import, Pflicht → Katalog) werden über `verweise` mit derselben Rechnung
übersetzt und treffen deshalb, ohne dass etwas nachgeschlagen werden müsste.

Was unterwegs abgebildet und was bewusst gelassen wird, steht jeweils am Umzug.
Zwei Entscheidungen, die über eine Spaltenumbenennung hinausgehen:

* `schulung_dokument` kommt **nicht** mit. Begründung unten bei `schulung_unterlagen`.
* `personio_sync_meta` ist im Neuen keine Einzelzeile mehr, sondern ein
  Protokoll. Die eine alte Zeile wird zum ersten Protokolleintrag.
"""
from __future__ import annotations

from typing import Any

from app.uebernahme.motor import Umzug

# --- Helfer ----------------------------------------------------------------


def _personio_wert(roh: Any, feldname: str) -> Any:
    """Ein Feld aus dem rohen Personio-Objekt holen.

    Personio verpackt Felder mal als `{label, value, …}`, mal flach — dieselbe
    Entpackung wie in `app.personio.sync`. Bewusst hier nachgebaut statt dort
    importiert: die Übernahme läuft einmal und soll nicht kaputtgehen, wenn am
    laufenden Abgleich etwas umgestellt wird.
    """
    attrs = (roh or {}).get("attributes") or {}
    feld = attrs.get(feldname)
    if isinstance(feld, dict) and "value" in feld:
        return feld["value"]
    return feld


def _email(roh: Any) -> Any:
    """Die neue Tabelle führt `email` als eigene Spalte, die alte nicht.

    Die Adresse steht aber in beiden in `raw_json`, und der laufende Abgleich
    füllt die Spalte genau von dort. Wer sie hier nicht mitzieht, bekommt 250
    Personen ohne E-Mail — bis zum nächsten Personio-Lauf.
    """
    return _personio_wert(roh, "email")


#: Alte Statuswörter des Personio-Abgleichs auf die neuen. Beide Seiten kennen
#: drei Fälle, sie heißen nur anders (`hr_sync.py` schrieb englisch,
#: `app/personio/sync.py` schreibt deutsch). Ein durchgereichtes „partial"
#: stünde in der Oberfläche als unbekannter Zustand.
SYNC_STATUS = {"ok": "ok", "partial": "teilweise", "error": "fehler"}


def _sync_status(wert: Any) -> str:
    # Die Spalte ist im Neuen `not null`. Ein unbekanntes Wort als „ok"
    # durchzulassen wäre eine stille Lüge; „fehler" ist die ehrliche Antwort.
    return SYNC_STATUS.get(wert, "fehler")


def _zahl(wert: Any) -> int:
    # Alt waren die Zähler nullbar, neu sind sie `not null default 0`.
    return wert or 0


# --- Die Umzüge, in Abhängigkeitsreihenfolge -------------------------------

UMZUEGE: list[Umzug] = [
    # Die Stammdaten zuerst: Anwesenheiten, Abwesenheiten und Teilnahmen
    # verweisen auf `employee_id`, und die Teilnahmen tun es mit einem echten
    # Fremdschlüssel.
    Umzug(
        alt="personio_employees",
        neu="personio_employees",
        id_aus="alt",
        spalten={
            "first_name": "first_name",
            "last_name": "last_name",
            # Zwei neue Spalten aus derselben alten: `raw_json` wandert ganz,
            # `email` wird daraus gezogen (siehe `_email`).
            "email": "raw_json",
            "department": "department",
            "status": "status",
            "hire_date": "hire_date",
            "termination_date": "termination_date",
            "weekly_working_hours": "weekly_working_hours",
            "raw_json": "raw_json",
            "synced_at": "synced_at",
        },
        wandler={"email": _email},
        # `position` hat im Neuen keine eigene Spalte mehr und wird auch nicht
        # vermisst: die Sicht `organigramm` und die Zeugnisunterschriften lesen
        # sie aus `raw_json #>> '{attributes,position,value}'`. Weil `raw_json`
        # vollständig mitkommt, geht sie nicht verloren.
    ),
    Umzug(
        alt="personio_attendance",
        neu="personio_attendance",
        id_aus="alt",
        spalten={
            "employee_id": "employee_id",
            "datum": "date",  # nur umbenannt
            "start_time": "start_time",
            "end_time": "end_time",
            "break_minutes": "break_minutes",
            "synced_at": "synced_at",
        },
        # Zwei alte Spalten haben im Neuen kein Gegenstück und kommen nicht mit:
        # `is_holiday` — im Abzug ist sie in keiner der 11.115 Zeilen gesetzt,
        #   Feiertage entstehen im neuen Stack aus dem Kalender, nicht aus der
        #   Zeile; und `raw_json`, das nur die Personio-Antwort spiegelte und
        #   von keiner Kennzahl gelesen wurde.
    ),
    Umzug(
        alt="personio_absences",
        neu="personio_absences",
        id_aus="alt",
        spalten={
            "employee_id": "employee_id",
            "absence_type_id": "absence_type_id",
            "start_date": "start_date",
            "end_date": "end_date",
            # `time_unit` trägt „day" oder „hour" und entscheidet, ob `hours`
            # überhaupt etwas bedeutet — unverändert übernommen.
            "time_unit": "time_unit",
            "hours": "hours",
            "raw_json": "raw_json",
            "synced_at": "synced_at",
        },
    ),
    Umzug(
        alt="personio_sync_meta",
        neu="personio_sync_meta",
        # Alt: genau eine Zeile mit `check (id = 1)`, jeder Abgleich überschrieb
        # sie. Neu: ein Protokoll mit `generated always as identity` — ein
        # expliziter Schlüssel wäre gar nicht einsetzbar. Also `id_aus=None`:
        # die alte Zeile wird der erste Eintrag im neuen Protokoll.
        #
        # Als einziger Umzug hier ist dieser nicht wiederholbar: die Datenbank
        # vergibt jedes Mal einen neuen Schlüssel, es gibt also nichts, woran
        # `on conflict` den zweiten Lauf erkennen könnte. Ein zweiter Lauf legt
        # denselben Protokolleintrag ein zweites Mal an. Das ist hinnehmbar —
        # ein doppelter Protokollsatz über einen Abgleich von gestern verfälscht
        # keine Kennzahl —, aber es ist zu wissen.
        id_aus=None,
        spalten={
            "gelaufen_am": "last_synced_at",
            "status": "last_sync_status",
            "fehler": "last_sync_error",
            "mitarbeiter": "employees_synced",
            "anwesenheiten": "attendance_synced",
            "abwesenheiten": "absences_synced",
        },
        wandler={
            "status": _sync_status,
            "mitarbeiter": _zahl,
            "anwesenheiten": _zahl,
            "abwesenheiten": _zahl,
        },
        # Ein Protokollsatz ohne Zeitpunkt sagt nichts, und `gelaufen_am` ist
        # im Neuen `not null` — eine erfundene Zeit wäre schlimmer als keine
        # Zeile. Im Abzug steht der Zeitpunkt, die Zeile kommt also mit.
        auslassen=lambda z: z["last_synced_at"] is None,
        # `dauer_sekunden` bleibt leer: wie lange der letzte Abgleich lief, hat
        # das Altsystem nie gemessen.
    ),
    # --- Schulungen: Katalog vor allem, was auf ihn zeigt -------------------
    Umzug(
        alt="schulung_katalog",
        neu="schulung_katalog",
        id_aus="uuid5",
        spalten={
            "bereich": "bereich",
            "name": "name",
            "turnus": "turnus",
            "turnus_monate": "turnus_monate",
            "frist_tage": "frist_tage",
            "verantwortlicher": "verantwortlicher",
            "beschreibung": "beschreibung",
            "sortierung": "sort_order",  # nur umbenannt
            "aktiv": "aktiv",
        },
        # Die neuen Prüfungen verlangen `turnus_monate > 0` und `frist_tage > 0`
        # (oder null). An den echten 90 Zeilen nachgesehen: keine verletzt das,
        # es braucht also keine Abbildung.
    ),
    Umzug(
        alt="schulung_rolle",
        neu="schulung_rollen",
        id_aus="uuid5",
        spalten={
            "position": "position",
            "position_norm": "position_norm",
            "abteilung_kuerzel": "abteilung_kuerzel",
        },
        # Im Abzug leer. Der Umzug steht trotzdem hier: die Tabelle füllt sich
        # bis zum Cutover womöglich noch, und dann soll sie mitkommen.
    ),
    Umzug(
        alt="schulung_pflicht",
        neu="schulung_pflicht",
        id_aus="uuid5",
        spalten={
            "schulung_id": "schulung_id",
            "ebene": "ebene",
            "abteilung": "abteilung",
        },
        # Aus der alten Zahl wird dieselbe UUID gerechnet, die der Katalog oben
        # bekommen hat — der Fremdschlüssel trifft ohne Nachschlagen.
        verweise={"schulung_id": "schulung_katalog"},
        # `ebene` prüft beidseitig gegen 'kuerzel' | 'personio', und genau diese
        # zwei Werte kommen in den sechs Zeilen vor.
    ),
    Umzug(
        alt="schulung_import",
        neu="schulung_importe",
        id_aus="uuid5",
        spalten={
            "dateiname": "dateiname",
            "importiert_am": "importiert_am",
            "schulungen": "schulungen_gesamt",  # nur umbenannt
            "teilnahmen": "teilnahmen_gesamt",  # nur umbenannt
            "nicht_zugeordnet": "nicht_zugeordnet",
            "notiz": "notiz",
        },
    ),
    Umzug(
        alt="schulung_teilnahme",
        neu="schulung_teilnahmen",
        id_aus="uuid5",
        spalten={
            "schulung_id": "schulung_id",
            "employee_id": "employee_id",
            "personalnummer": "personalnummer",
            "mitarbeiter_name": "mitarbeiter_name",
            "abteilung_kuerzel": "abteilung_kuerzel",
            "initial_datum": "initial_datum",
            "aktuell_datum": "aktuell_datum",
            # Die Quartalsangabe der Excel („Q3/2025") ist kein Datum und
            # bleibt Text — sie steht neben dem gerechneten Termin, damit
            # niemand eine Genauigkeit hineinliest, die sie nicht hat.
            "naechste_faellig": "naechste_faellig",
            "import_id": "import_id",
        },
        verweise={
            "schulung_id": "schulung_katalog",
            "import_id": "schulung_import",
        },
        # Zwei alte Spalten bleiben zurück:
        # `naechste_faellig_am` — im Neuen rechnet die Sicht `schulung_stand`
        #   die Fälligkeit beim Lesen aus Termin und Turnus. Die alte Spalte
        #   mitzunehmen hieße, einen Wert einzufrieren, der beim nächsten
        #   Turnuswechsel lügt; genau deshalb wurde sie abgeschafft.
        # `extern_id` — zeigt alt auf `onboarding_extern`, neu auf
        #   `externe_personen` (uuid). Im Abzug ist sie in keiner der 482 Zeilen
        #   gesetzt und `onboarding_extern` ist leer, es geht also nichts
        #   verloren. Die Übersetzung gehört ohnehin dem Fachbereich, der
        #   `externe_personen` übernimmt — hier wäre sie geraten.
        #
        # Die neue Prüfung `eine_identitaet` verlangt mindestens eine von
        # (employee_id, extern_id, personalnummer) und verbietet Person und
        # Externe zugleich. An den echten Zeilen nachgesehen: alle 482 tragen
        # employee_id oder Personalnummer, keine verletzt sie.
    ),
    # `schulung_dokument` → `schulung_unterlagen` steht bewusst NICHT hier.
    #
    # Die beiden Tabellen tragen denselben Wortstamm und meinen Verschiedenes.
    # Alt ist ein Formblatt-Vorgang: ein Blatt mit QR-Code (`doc_uid`,
    # `pdf_uuid`), das jemandem ausgehändigt, ausgefüllt zurückgenommen und
    # geprüft wird (`status`, `feld_layout`, `scan_uuid`, `pruef_ergebnis`).
    # Neu ist eine Unterlage zur Schulung selbst — Präsentation oder Handout,
    # das am Katalogeintrag hängt und für jede Durchführung gilt.
    #
    # Die eine Zeile im Abzug ist ein Vorgang im Zustand „uebergeben": ein Blatt
    # für zwei namentlich genannte Schulungen, ohne Scan, ohne Ergebnis. Um
    # daraus eine Unterlage zu machen, müsste man erfinden, was die neue Tabelle
    # verlangt: ein `schulung_id` (welche der zwei?), einen `pfad` auf eine
    # Datei, die im neuen Eimer nicht liegt, und einen `dateiname`. Das Ergebnis
    # wäre ein Eintrag, der einen toten Download anbietet und den offenen
    # Vorgang als erledigte Unterlage ausgibt.
    #
    # Sein richtiges Zuhause hat der Vorgang in `dokumentvorgaenge` /
    # `dokument_nachweise`; dorthin zieht ihn `qualifizierung.py` um, samt dem
    # Einarbeitungsvorgang. Hier noch einmal hieße, dieselbe Zeile zweimal
    # anzulegen.
]
