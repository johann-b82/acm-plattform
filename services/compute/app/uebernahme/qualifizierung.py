"""Qualifizierung aus lumeapps übernehmen: Kompetenzen, Einarbeitung, Onboarding, Zeugnisse.

Vier Module, ein Abhängigkeitsstrang. Die Matrix trägt Kategorien,
Qualifikationen und Personen; erst an einer Qualifikation **und** einer Person
hängt eine Bewertung. Der Katalog trägt die Einarbeitungspflicht, das Zeugnis
seine Noten. Die Reihenfolge unten ist genau diese Kette — wer sie umstellt,
schreibt Kindzeilen vor ihre Eltern und der Fremdschlüssel bricht.

**Der Schlüssel wechselt fast überall von `integer` auf `uuid`.** Deshalb
durchweg `id_aus="uuid5"`: aus Tabellenname und alter Zahl wird eine feste UUID
gerechnet. Das ist hier nicht nur bequem, sondern nötig — `kompetenz_bewertung`
verweist auf zwei Eltern gleichzeitig, und beide Verweise müssen dieselbe UUID
treffen, die die Elterntabelle bekommen hat. Gerechnet statt nachgeschlagen
heißt außerdem: ein zweiter Lauf trifft dieselben Zeilen.

Zwei Tabellen können das nicht:

* `onboarding_abteilung` hat neu **keine** Spalte `id` — der Personio-Schlüssel
  ist der Primärschlüssel. Es gibt nichts zu rechnen, also `id_aus=None`.
* `zeugnis_aussteller` ist neu eine **Einzelzeile**: `id boolean primary key`
  mit `check (id)`, also genau ein möglicher Wert. Auch hier `id_aus=None`,
  damit die Vorgabe `true` greift.

**An den echten Daten nachgesehen**, bevor ein `wandler` erfunden wurde. Die
neuen Prüfbedingungen sind schärfer als die alten Spalten, aber kein einziger
Wert des Produktivabzugs verletzt sie:

* `kompetenz_matrizen.bereich` lässt vier Werte zu — dieselben vier, die das
  Altprojekt in `KOMPETENZ_BEREICHE` führt; die sechs Blätter tragen sie alle.
* `kompetenz_bewertungen` verlangt Anforderungslevel 0–4, Erfüllungsgrad 0–100
  und mindestens eine der beiden Zahlen. Gezählt: 1.179 Zeilen, keine außerhalb
  der Spannen, keine mit zwei leeren Feldern.
* `zeugnis_bausteine.note` verlangt 1–4; die 28 Bausteine sind sieben
  Dimensionen mal vier Noten.
* `zeugnisse` und `zeugnis_bewertungen` sind in der Produktion leer. Ihre neuen
  Prüfbedingungen (Art, Geschlecht, Status, Dimension) decken sich Wert für
  Wert mit den Konstanten des Altprojekts in `app/models/zeugnis.py`.

Deshalb steht hier kein `wandler`. Käme später ein abweichender Wert dazu,
gehörte er abgebildet und nicht ausgelassen — aber ein Wandler für einen Wert,
den es nicht gibt, verschleiert nur, was die Daten wirklich enthalten.
"""
from __future__ import annotations

from app.uebernahme.motor import Umzug

# --- Helfer für den Dokumentenlauf ---------------------------------------------


def _datei(kennung: str | None) -> str | None:
    """Der vorläufige Ablageort einer Directus-Datei im Eimer `dokumente`.

    Noch ohne Endung — welche Art Datei es ist, zeigt erst die Datei selbst.
    `dateien.py` legt die Bytes ab und setzt dann den Pfad samt Endung."""
    return f"uebernahme/dokumente/{kennung}" if kennung else None


#: Die Stationen und ihre Zeitstempel — dieselben wie in `app.dokumente.vorgang`.
_WEG = ("erstellt", "uebergeben", "zurueck", "geprueft")
_STEMPEL = {"uebergeben": "uebergeben_am", "zurueck": "zurueck_am", "geprueft": "geprueft_am"}


def _weg_schliessen(zeile: dict) -> dict:
    """Stand und Zeitstempel so angleichen, dass die neuen Bedingungen halten.

    Neu verlangt `dokumentvorgaenge`, dass der Stand zu den Zeitstempeln passt
    und kein Schritt fehlt. Das Altsystem setzte beim Statuswechsel nur den
    Stempel des Ziels; eine einzige solche Zeile ließe den ganzen Umzug
    scheitern. Der Stand ist der späteste belegte Schritt. Fehlt einem früheren
    Schritt der Stempel, bekommt er den des nächsten — spätestens dann ist er
    geschehen. Ohne jeden späteren Beleg bleibt nur der Zeitpunkt der Anlage."""
    stand = _WEG.index(zeile["status"]) if zeile.get("status") in _WEG else 0
    for i, schritt in enumerate(_WEG[1:], start=1):
        if zeile.get(_STEMPEL[schritt]) is not None:
            stand = max(stand, i)
    zeile["status"] = _WEG[stand]
    spaeter = None
    for i in range(stand, 0, -1):
        feld = _STEMPEL[_WEG[i]]
        if zeile.get(feld) is None:
            zeile[feld] = spaeter or zeile.get("erstellt_am")
        spaeter = zeile[feld]
    return zeile


def _abteilungen_als_inhalt(abteilungen: list | None) -> list[dict] | None:
    """Alt steht am Einarbeitungsvorgang nur, aus welchen Abteilungen der Bogen
    gebaut wurde; neu ist `inhalt` die Abschrift der Blattzeilen. Übernommen
    wird, was da ist — je Abteilung ein Eintrag, kein erfundener Inhalt. Die
    eigentliche Abschrift ist das Blatt selbst, und das kommt als Datei mit."""
    if not abteilungen:
        return None
    return [{"abteilung": a} for a in abteilungen if a]


def _schulungen_als_inhalt(schulungen: list | None) -> list[dict] | None:
    """Alt `{name, trainer}` je Zeile, neu `{bezeichnung, anbieter}` — dieselben
    Angaben unter den Namen, die `routers/dokumente.py` beim Anlegen schreibt."""
    if not schulungen:
        return None
    return [
        {"bezeichnung": s.get("name") or "", "anbieter": s.get("trainer") or ""}
        for s in schulungen
        if isinstance(s, dict)
    ]


#: Die Spalten, die beide alten Vorgangstabellen gleich führen.
_VORGANG_SPALTEN = {
    "doc_uid": "doc_uid",
    "employee_id": "employee_id",
    "name": "mitarbeiter_name",
    "pdf_pfad": "pdf_uuid",
    "scan_pfad": "scan_uuid",
    "feld_layout": "feld_layout",
    "status": "status",
    "erstellt_am": "erstellt_am",
    "uebergeben_am": "uebergeben_am",
    "zurueck_am": "zurueck_am",
    "geprueft_am": "geprueft_am",
    "pruef_ergebnis": "pruef_ergebnis",
    "vollstaendig": "vollstaendig",
    "kommentar": "kommentar",
}


UMZUEGE: list[Umzug] = [
    # --- Kompetenzen ---------------------------------------------------------
    # Die Matrix zuerst: an ihr hängen Kategorien, Qualifikationen und Personen.
    # Natürlicher Schlüssel ist (bereich, blatt) — auf beiden Seiten eindeutig,
    # und damit findet ein zweiter Lauf ein schon übernommenes Blatt auch dann
    # wieder, wenn es zwischendurch von Hand angelegt wurde.
    Umzug(
        alt="kompetenz_matrix",
        neu="kompetenz_matrizen",
        id_aus="uuid5",
        spalten={
            "bereich": "bereich",
            "blatt": "blatt",
            "titel": "titel",
            "stand": "stand",
            "dateiname": "dateiname",
            "importiert_am": "importiert_am",
        },
        schluessel=("bereich", "blatt"),
    ),
    # In der Produktion leer: die Kategorie steht faktisch als Text an der
    # Qualifikation (`kompetenz_qualifikation.kategorie`), die eigene Tabelle
    # ist nie gefüllt worden. Sie wird trotzdem beschrieben, damit ein Abzug mit
    # Inhalt nicht stillschweigend danebenfällt.
    Umzug(
        alt="kompetenz_kategorie",
        neu="kompetenz_kategorien",
        id_aus="uuid5",
        spalten={
            "matrix_id": "matrix_id",
            "name": "name",
            "reihenfolge": "reihenfolge",
        },
        verweise={"matrix_id": "kompetenz_matrix"},
        schluessel=("matrix_id", "name"),
    ),
    # Die Qualifikation trägt ihre Kategorie als Text weiter — das ist im neuen
    # Stack genauso gelöst, also eine gerade Übernahme ohne Auflösung.
    # Eindeutig ist neu nur der Schlüssel; über die gerechnete UUID bleibt der
    # Lauf trotzdem wiederholbar.
    Umzug(
        alt="kompetenz_qualifikation",
        neu="kompetenz_qualifikationen",
        id_aus="uuid5",
        spalten={
            "matrix_id": "matrix_id",
            "nr": "nr",
            "kategorie": "kategorie",
            "bezeichnung": "bezeichnung",
            "reihenfolge": "reihenfolge",
        },
        verweise={"matrix_id": "kompetenz_matrix"},
    ),
    # `employee_id` bleibt die Personio-Zahl — die wandert unverändert und wird
    # deshalb *nicht* übersetzt. Die Zeilen in `personio_employees` legt der
    # Fachbereich `personal` an, der vor diesem läuft.
    #
    # `extern_id` fällt weg: die neue Tabelle kennt die Spalte nicht. Eine
    # Matrixspalte ist im neuen Modell eine Beschriftung mit optionaler
    # Personio-Zuordnung, mehr nicht; für alles Weitere gibt es `externe_personen`
    # als eigene Tabelle. Der Name der Person steht ohnehin in `name` (nicht
    # nullbar), es geht also keine Beschriftung verloren — in der Produktion
    # trägt zudem keine der 59 Zeilen ein `extern_id`.
    Umzug(
        alt="kompetenz_person",
        neu="kompetenz_personen",
        id_aus="uuid5",
        spalten={
            "matrix_id": "matrix_id",
            "name": "name",
            "employee_id": "employee_id",
            "reihenfolge": "reihenfolge",
        },
        verweise={"matrix_id": "kompetenz_matrix"},
    ),
    # Der Grund für die gerechneten Schlüssel: zwei Verweise auf zwei
    # verschiedene Eltern, beide müssen deren neue UUID treffen.
    # `geaendert_am` hat alt kein Gegenstück und bleibt auf der Vorgabe `now()`
    # — der Zeitpunkt der Übernahme ist die ehrlichste Angabe, die es gibt.
    Umzug(
        alt="kompetenz_bewertung",
        neu="kompetenz_bewertungen",
        id_aus="uuid5",
        spalten={
            "qualifikation_id": "qualifikation_id",
            "person_id": "person_id",
            "anforderungslevel": "anforderungslevel",
            "erfuellungsgrad": "erfuellungsgrad",
        },
        verweise={
            "qualifikation_id": "kompetenz_qualifikation",
            "person_id": "kompetenz_person",
        },
        schluessel=("qualifikation_id", "person_id"),
    ),
    # --- Einarbeitung --------------------------------------------------------
    # Gleicher Tabellenname auf beiden Seiten, gleiche Spalten — nur der
    # Schlüssel wird zur UUID, und die Pflicht muss ihm folgen.
    Umzug(
        alt="einarbeitung_katalog",
        neu="einarbeitung_katalog",
        id_aus="uuid5",
        spalten={
            "inhalt": "inhalt",
            "ansprechpartner": "ansprechpartner",
            "bereich": "bereich",
            "reihenfolge": "reihenfolge",
            "erstellt_am": "erstellt_am",
        },
    ),
    Umzug(
        alt="einarbeitung_pflicht",
        neu="einarbeitung_pflicht",
        id_aus="uuid5",
        spalten={
            "einarbeitung_id": "einarbeitung_id",
            "abteilung": "abteilung",
        },
        verweise={"einarbeitung_id": "einarbeitung_katalog"},
        schluessel=("einarbeitung_id", "abteilung"),
    ),
    # --- Onboarding ----------------------------------------------------------
    # Der Sonderfall: neu gibt es keine Spalte `id`. Der Personio-Schlüssel
    # *ist* der Primärschlüssel — eine Person hat genau eine übersteuerte
    # Abteilung, und die alte Ersatzzahl mit ihrer Eindeutigkeitsbedingung
    # darüber war nur Beiwerk. Also `id_aus=None` (es gibt nichts zu vergeben)
    # und `schluessel` auf den Primärschlüssel, damit ein zweiter Lauf die
    # bestehende Zeile stehen lässt statt sie zu überschreiben.
    # `geaendert_am` bleibt auf der Vorgabe `now()`; alt gibt es keinen Zeitpunkt.
    Umzug(
        alt="onboarding_abteilung",
        neu="onboarding_abteilung",
        id_aus=None,
        spalten={
            "employee_id": "employee_id",
            "abteilung": "abteilung",
        },
        schluessel=("employee_id",),
    ),
    # Externe kommen vor dem Onboarding-Paket und vor den Zeugnissen: beide
    # verweisen auf sie. `hire_date` heißt neu `eintritt` — dieselbe Bedeutung,
    # deutsche Benennung wie im übrigen neuen Stack.
    #
    # `paket_heruntergeladen_am` hat neu kein Gegenstück an der Person: der
    # Vermerk ist aus der Zeile herausgezogen und steht als eigene Zeile in
    # `onboarding_paket` (dort `extern_id`). Ein Umzug schreibt immer nur in
    # *eine* Tabelle, deshalb geht dieser Zeitpunkt hier verloren — in der
    # Produktion ist `onboarding_extern` leer, es fällt also nichts an.
    Umzug(
        alt="onboarding_extern",
        neu="externe_personen",
        id_aus="uuid5",
        spalten={
            "name": "name",
            "abteilung": "abteilung",
            "position": "position",
            "eintritt": "hire_date",
            "angelegt_am": "angelegt_am",
        },
    ),
    # Der Download-Vermerk. Neu trägt die Tabelle beide Personensorten und
    # verlangt `num_nonnulls(employee_id, extern_id) = 1`; die alte Tabelle
    # kennt nur Personio-Personen, also bleibt `extern_id` leer und die
    # Bedingung ist erfüllt.
    # Als Konfliktziel dient der gerechnete Schlüssel und nicht die
    # Eindeutigkeit über `employee_id`: die ist neu ein *partieller* Index
    # (`where employee_id is not null`), und ein partielles Ziel braucht eine
    # Bedingung, die der Motor nicht mitgibt.
    Umzug(
        alt="onboarding_paket_download",
        neu="onboarding_paket",
        id_aus="uuid5",
        spalten={
            "employee_id": "employee_id",
            "heruntergeladen_am": "heruntergeladen_am",
        },
    ),
    # --- Zeugnisse -----------------------------------------------------------
    # Der zweite Sonderfall: `id boolean primary key default true` mit
    # `check (id)`. Das ist keine Kennung, sondern ein Riegel — die Tabelle darf
    # genau eine Zeile haben, weil es genau einen Aussteller gibt. Alt war es
    # eine gewöhnliche Zahlenfolge, die faktisch nie mehr als eine Zeile trug.
    # `id_aus=None` lässt die Vorgabe `true` greifen; `sortierung="id"` sorgt
    # dafür, dass bei einem Abzug mit mehreren Zeilen die älteste gewinnt und
    # der Rest per `do nothing` liegen bleibt, statt zufällig zu entscheiden.
    # In der Produktion ist die Tabelle leer.
    Umzug(
        alt="zeugnis_aussteller",
        neu="zeugnis_aussteller",
        id_aus=None,
        spalten={
            "firma": "firma",
            "standort": "standort",
            "unterzeichner1_name": "unterzeichner1_name",
            "unterzeichner1_titel": "unterzeichner1_titel",
            "unterzeichner2_name": "unterzeichner2_name",
            "unterzeichner2_titel": "unterzeichner2_titel",
            "hr_employee_id": "hr_employee_id",
            "geaendert_am": "aktualisiert_am",
        },
        schluessel=("id",),
        sortierung="id",
    ),
    # `aktualisiert_am` heißt neu durchgängig `geaendert_am` — reine
    # Umbenennung. Die Noten bleiben als JSONB, wie sie sind.
    Umzug(
        alt="zeugnis_vorlage",
        neu="zeugnis_notenvorlagen",
        id_aus="uuid5",
        spalten={
            "name": "name",
            "noten": "noten",
            "geaendert_am": "aktualisiert_am",
        },
        schluessel=("name",),
    ),
    Umzug(
        alt="zeugnis_baustein",
        neu="zeugnis_bausteine",
        id_aus="uuid5",
        spalten={
            "dimension": "dimension",
            "note": "note",
            "text": "text",
            "geaendert_am": "aktualisiert_am",
        },
        schluessel=("dimension", "note"),
    ),
    # Das Zeugnis schreibt die Stammdaten ab, statt sie zu verknüpfen — deshalb
    # wandern Name, Abteilung und Zeiten als Werte mit und nicht als Verweis.
    # `employee_id` bleibt die Personio-Zahl; nur `extern_id` wird übersetzt,
    # weil `externe_personen` neu einen UUID-Schlüssel führt.
    # `abschnitte_json` heißt neu `abschnitte` — das `_json` am Namen sagte nur,
    # was der Typ schon sagt.
    Umzug(
        alt="zeugnis",
        neu="zeugnisse",
        id_aus="uuid5",
        spalten={
            "employee_id": "employee_id",
            "extern_id": "extern_id",
            "name": "name",
            "geschlecht": "geschlecht",
            "geburtsdatum": "geburtsdatum",
            "personalnummer": "personalnummer",
            "abteilung": "abteilung",
            "taetigkeit": "taetigkeit",
            "eintritt": "eintritt",
            "austritt": "austritt",
            "art": "art",
            "anlass": "anlass",
            "fuehrungskraft": "fuehrungskraft",
            "ausstellungsdatum": "ausstellungsdatum",
            "taetigkeit_stichpunkte": "taetigkeit_stichpunkte",
            "besondere_kompetenzen": "besondere_kompetenzen",
            "besondere_erfolge": "besondere_erfolge",
            "schlussnote": "schlussnote",
            "abschnitte": "abschnitte_json",
            "status": "status",
            "erstellt_am": "erstellt_am",
            "geaendert_am": "aktualisiert_am",
        },
        verweise={"extern_id": "onboarding_extern"},
    ),
    # Zuletzt die Noten am Zeugnis — sie brauchen dessen gerechnete UUID.
    Umzug(
        alt="zeugnis_bewertung",
        neu="zeugnis_bewertungen",
        id_aus="uuid5",
        spalten={
            "zeugnis_id": "zeugnis_id",
            "dimension": "dimension",
            "note": "note",
        },
        verweise={"zeugnis_id": "zeugnis"},
        schluessel=("zeugnis_id", "dimension"),
    ),
    # --- Dokumentenlauf ------------------------------------------------------
    # Alt zwei Tabellen mit demselben Laufweg, neu eine mit der Spalte `art`
    # (siehe 0035). Beide wandern nach `dokumentvorgaenge`; der gerechnete
    # Schlüssel nimmt den alten Tabellennamen mit, zwei Vorgänge mit derselben
    # alten Zahl bekommen also verschiedene UUIDs. Natürlicher Schlüssel ist
    # der QR-Token — über ihn ordnet ein später eingescannter Bogen sich zu.
    #
    # Die Dateien liegen in Directus, nicht im Abzug: der Pfad entsteht hier
    # aus der alten Kennung, die Bytes legt `dateien.py` ab.
    Umzug(
        alt="einarbeitung_dokument",
        neu="dokumentvorgaenge",
        id_aus="uuid5",
        spalten={**_VORGANG_SPALTEN, "funktion": "stelle", "beginn": "beginn", "inhalt": "abteilungen"},
        fest={"art": "einarbeitung"},
        wandler={"inhalt": _abteilungen_als_inhalt, "pdf_pfad": _datei, "scan_pfad": _datei},
        nachbessern=_weg_schliessen,
        schluessel=("doc_uid",),
    ),
    Umzug(
        alt="schulung_dokument",
        neu="dokumentvorgaenge",
        id_aus="uuid5",
        spalten={**_VORGANG_SPALTEN, "funktion": "funktion", "inhalt": "schulungen"},
        fest={"art": "schulung"},
        wandler={"inhalt": _schulungen_als_inhalt, "pdf_pfad": _datei, "scan_pfad": _datei},
        nachbessern=_weg_schliessen,
        schluessel=("doc_uid",),
    ),
    # Das Zertifikat je Schulungszeile ist neu ein Nachweis am Vorgang; die
    # Zeilenbezeichnung bleibt als `zeile` daran stehen.
    Umzug(
        alt="schulung_zertifikat",
        neu="dokument_nachweise",
        id_aus="uuid5",
        spalten={
            "vorgang_id": "dokument_id",
            "zeile": "schulung_bezeichnung",
            "pfad": "datei_uuid",
            "dateiname": "dateiname",
            "hochgeladen_am": "hochgeladen_am",
        },
        verweise={"vorgang_id": "schulung_dokument"},
        wandler={"pfad": _datei},
    ),
]
