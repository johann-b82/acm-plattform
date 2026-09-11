"""Technik, FAIR und Querschnitt aus lumeapps übernehmen.

Fünf Stränge, die nur die Reihenfolge teilen: Wartung (Maschinen, Aufgaben,
Dateien), Sensoren (Geräte und Zeitreihe), FAIR (Zeichnungen und Ballons),
Newsletter und das Querschnittliche (Feedback, KPI-Kommentare und -Maßnahmen).

**Schlüssel.** Wo beide Seiten `uuid` führen, wandert der alte Schlüssel mit
(`id_aus="alt"`) — dann stimmt jeder Verweis von selbst, und in `verweise`
steht nichts. Das gilt für `machines`, `maintenance_*`, `fair_*`,
`page_feedback` und `kpi_*`; ein Verweis auf eine solche Tabelle würde vom
Motor in der (leeren) Zuordnung nachgeschlagen und käme als `NULL` zurück.
`sensors` und die drei Newsletter-Tabellen wechseln von `integer` auf `uuid`,
bekommen also einen gerechneten Schlüssel (`id_aus="uuid5"`), und die Kinder
holen sich ihren Elternverweis über `verweise`.
`sensor_messungen` ist die einzige Zieltabelle mit einer eigenen Nummerierung
(`bigint generated always as identity`) — dort darf gar kein Schlüssel
mitgeschickt werden, also `id_aus=None`.

**Dateien wandern nicht mit.** Im Altprojekt hängen Wartungsunterlagen und
FAIR-Zeichnungen als `directus_file_uuid` an Directus, Newsletter- und
Feedbackbilder stecken als `bytea` in der Zeile. Im neuen Stack steht in der
Zeile nur ein Pfad in den Speicher. Der Abzug der alten Datenbank enthält die
Directus-Dateien nicht, und der Motor kopiert keine Bytes — er schreibt Zeilen.

Deshalb zwei verschiedene Antworten, je nachdem ob die Spalte einen Wert
verlangt:

* `wartungsdateien.pfad` und `fair_zeichnungen.pfad` sind `not null`. Dort
  steht ein gerechneter Pfad unter `uebernahme/…`, abgeleitet aus der alten
  Dateikennung. Er ist eindeutig, bei einem zweiten Lauf derselbe und sagt
  genau, wohin die Bytes gehören. **Bis jemand sie dorthin kopiert, zeigt der
  Pfad ins Leere** — die 17 FAIR-Zeichnungen laden dann nicht.
* `feedback.bild_pfad` darf leer bleiben, also bleibt es leer. Ein leeres Feld
  ist ehrlicher als ein Pfad auf ein Bild, das es nicht gibt.

**Personen wandern nicht mit.** `page_feedback.created_by_id`,
`kpi_comment.author_id` und `kpi_measure.created_by_id` sind Directus-UUIDs.
Die neuen Spalten (`feedback.melder`, `kpi_kommentare.verfasser`,
`kpi_massnahmen.angelegt_von`) sind Fremdschlüssel auf `auth.users` — ein
anderer Identitätsraum, in dem dieselbe Person eine neue Kennung hat
(`nutzer.py` legt sie an). Eine alte UUID dort hineinzuschreiben wäre entweder
ein Fremdschlüsselfehler oder, schlimmer, ein Treffer auf die falsche Person.
Alle drei Spalten bleiben deshalb leer.

**Drei Trigger reden mit.** Sie gehören zum Ziel und werden hier nicht
umgangen, aber man muss sie kennen:

* `feedback_melder` (before insert) setzt `melder` und `melder_email` auf
  `auth.uid()` bzw. den Anspruch aus dem Token. Der Umzug läuft ohne Sitzung,
  also werden **beide** Spalten auf `NULL` gesetzt — auch das aus
  `reporter_email` übernommene. Es steht unten trotzdem in der Abbildung: das
  ist die Absicht, und sie trägt, sobald der Trigger das gesetzte Feld
  stehenlässt.
* `kpi_massnahmen_beruehrt` (before insert) leert `erledigt_am` bei jedem
  Status außer `erledigt`. `done_at` überlebt also nur an erledigten
  Maßnahmen — was der Sache nach richtig ist.
* `fair_ballon_nummer` (before insert) vergibt nur dann eine Nummer, wenn
  keine mitkommt. Die alten Nummern (1…124) kommen mit und bleiben.
"""
from __future__ import annotations

import os
import re
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from app import geheim
from app.uebernahme.motor import Umzug

# --- Die SNMP-Community ------------------------------------------------------
#
# Sie steht auf **beiden** Seiten verschlüsselt in der Zeile, und beide Seiten
# benutzen Fernet — aber mit verschiedenen Schlüsseln: lumeapps nimmt
# `FERNET_KEY`, dieser Stack `GEHEIM_SCHLUESSEL` (früher `SENSOR_SCHLUESSEL`).
# Die Bytes unverändert zu übernehmen hieße also, sechs Geräte anzulegen, deren
# Community sich nicht mehr lesen lässt; die Abfrage stünde still, und niemand
# sähe warum. Der Umweg über den Klartext ist deshalb keine Bequemlichkeit,
# sondern die einzige Fassung, die hinterher funktioniert.
#
# Der alte Schlüssel kommt aus der Umgebung und **nicht** aus `app/config.py`:
# er gilt für diesen einen Lauf und hat in der Dauerumgebung des Dienstes
# nichts verloren. Vor dem echten Lauf:
#
#     ALT_FERNET_KEY=<FERNET_KEY aus der .env von lumeapps>
#
# Fehlt einer der beiden Schlüssel, scheitert der Lauf — an dieser Stelle, mit
# Ansage, und ohne eine einzige Zeile geschrieben zu haben. Das ist Absicht:
# ein Sensor mit unlesbarer Community ist schlimmer als kein Sensor.
ALT_SCHLUESSEL = "ALT_FERNET_KEY"

#: Ausweg für den Vergleichslauf: Wer die Zahlen alt gegen neu prüfen will,
#: braucht die Communities nicht — vom Entwicklungsrechner aus ist ohnehin kein
#: Messgerät erreichbar. Steht diese Marke in der Umgebung und fehlt der alte
#: Schlüssel, bekommt jeder Sensor einen sichtbaren Platzhalter statt der
#: echten Community. **Nicht für den Umzug am Stichtag**: dort gilt der
#: Schlüssel, sonst stehen sechs Geräte da, die nicht messen können.
PLATZHALTER_MARKE = "UEBERNAHME_COMMUNITY_PLATZHALTER"
PLATZHALTER = "nicht uebernommen"


class CommunityNichtLesbar(RuntimeError):
    """Die alte SNMP-Community lässt sich nicht entschlüsseln."""


def _community(geheimtext: Any) -> bytes:
    """Von lumeapps' Fernet auf unseres umschlüsseln."""
    roh = os.environ.get(ALT_SCHLUESSEL, "").strip()
    try:
        klartext = (
            Fernet(roh.encode()).decrypt(bytes(geheimtext)).decode()
            if roh
            # Ohne gesetzten Altschlüssel bleibt genau eine Möglichkeit: beide
            # Seiten benutzen denselben. Trifft das zu, ist nichts weiter zu
            # tun; trifft es nicht zu, sagt es der Fehler unten.
            else geheim.entschluesseln(geheimtext)
        )
    except (InvalidToken, ValueError, TypeError, geheim.NichtLesbar) as fehler:
        if os.environ.get(PLATZHALTER_MARKE, "").strip():
            return geheim.verschluesseln(PLATZHALTER)
        raise CommunityNichtLesbar(
            "Die SNMP-Community stammt aus lumeapps und ist mit dessen FERNET_KEY"
            f" verschlüsselt. Diesen Schlüssel als {ALT_SCHLUESSEL} in die Umgebung"
            " von compute geben und den Lauf wiederholen."
        ) from fehler
    # Wirft `geheim.KeinSchluessel`, wenn GEHEIM_SCHLUESSEL/SENSOR_SCHLUESSEL
    # fehlt. Nicht abfangen: lieber sauber scheitern als eine Zeile schreiben,
    # deren Geheimnis niemand mehr aufmacht.
    return geheim.verschluesseln(klartext)


# --- Kleine Umrechnungen -----------------------------------------------------

#: `active`/`inactive` heißen jetzt `aktiv`/`stillgelegt`; die neue
#: Prüfbedingung lässt nur diese beiden zu. Ein dritter Wert kann im Abzug
#: nicht vorkommen (die alte Prüfbedingung lässt ihn nicht zu) — käme er doch,
#: ist eine sichtbare Maschine der kleinere Schaden als eine verschwundene.
MASCHINEN_STATUS = {"active": "aktiv", "inactive": "stillgelegt"}

#: Die fünf Intervalle heißen nur anders. Abgebildet werden alle fünf, nicht
#: bloß die im Abzug vorkommenden (dort: keine) — sonst scheiterte ein späterer
#: Lauf gegen einen frischeren Abzug an einem Wert, der heute zufällig fehlt.
INTERVALL = {
    "daily": "taeglich",
    "weekly": "woechentlich",
    "monthly": "monatlich",
    "quarterly": "quartalsweise",
    "interval_weeks": "alle_n_wochen",
}

#: Aus `archive` wird `nachweis`: der zurückgescannte, unterschriebene Bogen.
DATEI_ART = {"plan": "plan", "archive": "nachweis"}

#: `image` heißt jetzt `bild`; `pdf` bleibt.
ZEICHNUNGS_ART = {"pdf": "pdf", "image": "bild"}

FEEDBACK_STATUS = {"new": "neu", "resolved": "erledigt"}

MASSNAHMEN_STATUS = {
    "open": "offen",
    "in_progress": "laeuft",
    "done": "erledigt",
    "dropped": "verworfen",
}

#: Alter KPI-Schlüssel → neuer. Links steht die Registratur des Altprojekts
#: (`app/services/kpi_registry.py`, 21 Einträge), rechts ein Schlüssel aus
#: `zielwerte` — und das ist keine Bequemlichkeit: `kpi_kommentare.schluessel`
#: und `kpi_massnahmen.schluessel` sind **Fremdschlüssel** auf `zielwerte`.
#: Ein nicht abgebildeter Schlüssel wäre kein schiefes Etikett, sondern ein
#: abgebrochener Lauf.
#:
#: Zwei Abbildungen sind eine Entscheidung und keine Umbenennung: das
#: Altprojekt kennt **einen** Audit-Schlüssel, der neue Stack trennt nach
#: Schwere (Level 1/2); ebenso bei den Prüfungen (groß/klein). Beide gehen auf
#: den ersten der beiden neuen Schlüssel. Ein Kommentar landet damit womöglich
#: an der falschen Hälfte — aber am richtigen Thema, und er bleibt lesbar.
#: Betroffen ist im Abzug genau eine Zeile (eine Maßnahme „Test").
SCHLUESSEL = {
    "sales.erstkontakte": "vertrieb_erstkontakte",
    "sales.interessenten": "vertrieb_interessenten",
    "sales.besuche": "vertrieb_besuche",
    "sales.angebote": "vertrieb_angebote_eur",
    "hr.overtime_ratio": "hr_ueberstunden",
    "hr.sick_leave_ratio": "hr_krankheit",
    "hr.fluctuation": "hr_fluktuation",
    "quality.complaint_customer": "qualitaet_reklamation_kunde",
    "quality.complaint_internal": "qualitaet_reklamation_intern",
    "quality.complaint_supplier": "qualitaet_reklamation_lieferant",
    "quality.complaint_subcontractor": "qualitaet_reklamation_werkbank",
    "quality.audit_findings": "qualitaet_audit_level1",
    "quality.inspections": "qualitaet_pruefung_gross",
    "finance.material_cost_ratio": "finanzen_materialkostenquote",
    "finance.personnel_cost_ratio": "finanzen_personalkostenquote",
    "procurement.otd": "einkauf_otd",
    "production.verzug": "produktion_verzug",
}

#: Vier alte Schlüssel haben im neuen Stack keinen Zielwert und damit kein
#: Zuhause: `sales.revenue` und `sales.orders_per_rep` (die neuen
#: Vertriebs-Zielwerte sind Wochenvolumina, nicht Umsatz je Vertreter),
#: `hr.revenue_per_employee` und `procurement.stock_orders`. Zeilen darauf
#: bleiben liegen, statt den Lauf am Fremdschlüssel scheitern zu lassen. Im
#: Abzug kommt keine davon vor; der `abgleich` zeigte es sonst als Abweichung.
def _ohne_zielwert(alte_zeile: dict) -> bool:
    return alte_zeile.get("kpi_key") not in SCHLUESSEL


FARBE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _gekuerzt(laenge: int):
    """Text auf die neue Spaltenbreite bringen, statt am Einfügen zu scheitern."""
    return lambda wert: wert[:laenge] if isinstance(wert, str) else wert


def _pfad(ordner: str):
    """Ablageort im Eimer, gerechnet aus der alten Kennung.

    Ein fester Pfad statt einer Zufalls-UUID wie im laufenden Betrieb: er ist
    bei einem zweiten Lauf derselbe (die Spalte ist teils eindeutig) und er
    sagt, wohin die Bytes aus dem Altsystem kopiert werden müssen. Der Ordner
    `uebernahme/` fällt dabei aus dem Schema `<Kennung>/<UUID>` heraus — das
    ist gewollt: die Leseregel der Eimer prüft nur das Recht am Fach, nicht den
    Ordner, und so ist auf einen Blick zu sehen, was aus dem Umzug stammt.
    """
    return lambda kennung: f"uebernahme/{ordner}/{kennung}"


def _tag(wert: Any) -> Any:
    """`timestamptz` → `date`: der neue Stack merkt sich nur den Tag."""
    return wert.date() if hasattr(wert, "date") else wert


def _zwischen(kleinste: int, groesste: int):
    return lambda wert: min(max(wert or kleinste, kleinste), groesste)


UMZUEGE: list[Umzug] = [
    # --- Wartung ------------------------------------------------------------
    # Spalte für Spalte ins Deutsche umbenannt, sonst unverändert. Der
    # Schlüssel wandert mit, damit Aufgaben und Dateien ihre Maschine ohne
    # Übersetzung wiederfinden.
    Umzug(
        alt="machines",
        neu="maschinen",
        id_aus="alt",
        sortierung="created_at",
        spalten={
            "name": "name",
            "inventarnummer": "inventory_no",
            "standort": "location",
            "hersteller": "manufacturer",
            "modell": "model",
            "verantwortlich": "responsible",
            "status": "status",
            "notizen": "notes",
            "erstellt_am": "created_at",
            "geaendert_am": "updated_at",
        },
        wandler={"status": lambda s: MASCHINEN_STATUS.get(s, "aktiv")},
    ),
    # Die Wochenzahl ist die eine Stelle, an der das neue Schema strenger ist:
    # `wartungsaufgaben_wochen_passend` verlangt sie bei `alle_n_wochen` und
    # verbietet sie sonst — im Altprojekt fehlt die zweite Hälfte, eine
    # monatliche Aufgabe kann dort eine sinnlose „14" tragen (siehe
    # docs/modules/wartung.md). Reparieren lässt sich das hier nicht: ein
    # `wandler` sieht nur seinen eigenen Wert, nicht das Intervall daneben.
    # Was er kann, tut er (0 und Negatives werden zu NULL); der Rest ist im
    # Abzug gegenstandslos, weil die Tabelle leer ist. Käme je eine solche
    # Zeile, bricht das Einfügen an der Prüfbedingung ab — laut und sichtbar,
    # statt still etwas Falsches abzulegen.
    Umzug(
        alt="maintenance_tasks",
        neu="wartungsaufgaben",
        id_aus="alt",
        sortierung="created_at",
        spalten={
            "maschine_id": "machine_id",
            "titel": "title",
            "anleitung": "instructions",
            "intervall": "interval_type",
            "wochen": "interval_weeks",
            "erstellt_am": "created_at",
            "geaendert_am": "updated_at",
        },
        wandler={
            "intervall": lambda i: INTERVALL.get(i, i),
            "wochen": lambda w: w if w and w >= 1 else None,
        },
    ),
    # `directus_file_uuid` wird zum Pfad im Eimer `wartung`. Die Datei selbst
    # liegt in Directus und muss getrennt kopiert werden; `pfad` ist `not null`
    # und zugleich eindeutig, taugt also als Platz dafür.
    Umzug(
        alt="maintenance_files",
        neu="wartungsdateien",
        id_aus="alt",
        sortierung="uploaded_at",
        spalten={
            "maschine_id": "machine_id",
            "art": "file_kind",
            "pfad": "directus_file_uuid",
            "dateiname": "filename",
            "mime": "mime_type",
            "hochgeladen_am": "uploaded_at",
        },
        wandler={"art": lambda a: DATEI_ART.get(a, a), "pfad": _pfad("wartung")},
    ),
    # --- Sensoren -----------------------------------------------------------
    # Der Schlüssel wechselt von `integer` auf `uuid`, also gerechnet — dann
    # kann die Zeitreihe ihren Sensor ausrechnen, statt ihn nachzuschlagen.
    #
    # `temperatur_min`/`_max` und `feuchte_min`/`_max` sind neu: im Altprojekt
    # stehen die Grenzwerte einmal für alle Geräte im Einstellungs-Singleton
    # (siehe docs/modules/sensoren.md), hier hängen sie am Gerät. Sie bleiben
    # leer — ein Serverraum-Grenzwert am Lagersensor wäre eine erfundene
    # Aussage. Wer sie will, trägt sie je Gerät ein.
    #
    # `chart_color` ist im Abzug bei vier von sechs Geräten leer; die neue
    # Prüfbedingung lässt nur `#rrggbb` zu, eine leere Zeichenkette fiele durch.
    Umzug(
        alt="sensors",
        neu="sensoren",
        id_aus="uuid5",
        sortierung="id",
        spalten={
            "name": "name",
            "rechner": "host",
            "port": "port",
            "community": "community",
            "temperatur_oid": "temperature_oid",
            "feuchte_oid": "humidity_oid",
            "temperatur_faktor": "temperature_scale",
            "feuchte_faktor": "humidity_scale",
            "aktiv": "enabled",
            "farbe": "chart_color",
            "erstellt_am": "created_at",
            "geaendert_am": "updated_at",
        },
        wandler={
            "community": _community,
            "farbe": lambda f: f if f and FARBE.match(f) else None,
        },
    ),
    # Die einzige Zieltabelle mit eigener Nummerierung (`generated always as
    # identity`) — ein mitgeschickter Schlüssel wäre hier ein Fehler, also
    # `id_aus=None`. Auf `sensor_messungen` zeigt nichts, die Zuordnung alt →
    # neu braucht also niemand.
    #
    # `error_code` hat kein Zuhause: eine gescheiterte Abfrage ist im neuen
    # Stack keine Messung, sie steht in `sensor_versuche` (docs/modules/
    # sensoren.md). Im Abzug ist die Spalte in allen 12.415 Zeilen leer, es
    # geht also nichts verloren. `sensor_poll_log` kommt aus demselben Grund
    # nicht mit: ein Betriebsprotokoll, das ohnehin nach vierzehn Tagen
    # aufgeräumt wird.
    Umzug(
        alt="sensor_readings",
        neu="sensor_messungen",
        id_aus=None,
        schluessel=("sensor_id", "gemessen_am"),
        sortierung="id",
        verweise={"sensor_id": "sensors"},
        spalten={
            "sensor_id": "sensor_id",
            "gemessen_am": "recorded_at",
            "temperatur": "temperature",
            "feuchte": "humidity",
        },
    ),
    # --- FAIR ---------------------------------------------------------------
    # Wie bei den Wartungsdateien wird `directus_file_uuid` zum Pfad im Eimer
    # `fair`. Hier trifft es echte Daten: 17 Zeichnungen. Sie erscheinen in der
    # Liste, lassen sich aber erst öffnen, wenn die Dateien aus Directus unter
    # genau diesem Pfad im Eimer liegen.
    #
    # `drehung` ist im neuen Schema auf die vier rechten Winkel eingegrenzt
    # (im Abzug: 0 und 90), im alten ist es ein beliebiger Integer.
    Umzug(
        alt="fair_projects",
        neu="fair_zeichnungen",
        id_aus="alt",
        sortierung="created_at",
        spalten={
            "name": "name",
            "teilenummer": "part_number",
            "kunde": "customer",
            "artikelnummer": "article_number",
            "pfad": "directus_file_uuid",
            "art": "file_kind",
            "mime": "mime_type",
            "seiten": "page_count",
            "drehung": "rotation",
            "erstellt_am": "created_at",
            "geaendert_am": "updated_at",
        },
        wandler={
            "pfad": _pfad("fair"),
            "art": lambda a: ZEICHNUNGS_ART.get(a, a),
            "seiten": lambda s: s if s and s >= 1 else 1,
            "drehung": lambda d: d if d in (0, 90, 180, 270) else 0,
        },
    ),
    # `region_*` heißt jetzt `bereich_*`, `tail_*` heißt `blase_*` — die
    # Pfeilspitze wird im neuen Stack nicht gespeichert, sie ergibt sich aus
    # Feld und Blase (docs/modules/fair.md). Gespeichert ist beides dasselbe:
    # Bruchteile [0,1] der Seite.
    #
    # Der Schlüssel bleibt der Primärschlüssel und nicht die eindeutige
    # Nummer je Zeichnung: die ist `deferrable initially deferred` und taugt
    # damit nicht als Schiedsrichter für `on conflict`.
    Umzug(
        alt="fair_balloons",
        neu="fair_ballons",
        id_aus="alt",
        sortierung="project_id, number",
        spalten={
            "zeichnung_id": "project_id",
            "nummer": "number",
            "seite": "page_no",
            "bereich_x": "region_x",
            "bereich_y": "region_y",
            "bereich_b": "region_w",
            "bereich_h": "region_h",
            "blase_x": "tail_x",
            "blase_y": "tail_y",
            "wert": "value_text",
            "erstellt_am": "created_at",
            "geaendert_am": "updated_at",
        },
    ),
    # --- Newsletter ---------------------------------------------------------
    # Alle drei Tabellen sind im Abzug leer, die Form unterscheidet sich aber
    # so deutlich, dass die Abbildung nicht bloß eine Umbenennung ist. Die
    # Umzüge stehen trotzdem hier — als Beschreibung dessen, was zu tun wäre,
    # und weil der Motor bei einer leeren Quelltabelle ohnehin nichts tut.
    #
    # Was am Kopf wegfällt:
    #
    # * `cover_bild`/`rueck_bild` (`bytea`) → `titelbild`/`rueckseite` sind
    #   Pfade in den Eimer `newsletter`. Beide dürfen leer sein, also bleiben
    #   sie leer; ein Pfad auf ein Bild, das niemand hochgeladen hat, wäre
    #   schlechter als kein Bild.
    # * `kpi_snapshot`, `block_reihenfolge`, `rubrik_titel` (drei JSONB) haben
    #   im Kopf kein Gegenstück mehr. Im neuen Stack ist ein Kapitel eine Zeile
    #   (`newsletter_kapitel`) mit `titel`, `sortierung`, `art` und `stand` —
    #   genau diese drei Spalten sind darin aufgegangen
    #   (docs/modules/newsletter.md).
    Umzug(
        alt="newsletter",
        neu="newsletter",
        id_aus="uuid5",
        sortierung="jahr, quartal",
        spalten={
            "jahr": "jahr",
            "quartal": "quartal",
            "titel": "titel",
            # Beide Seiten kennen genau `entwurf` und `veroeffentlicht`; nur
            # prüft es jetzt die Datenbank statt des Modells.
            "status": "status",
            "erstellt_am": "erstellt_am",
            "geaendert_am": "aktualisiert_am",
        },
        wandler={"titel": _gekuerzt(200)},
    ),
    # **Hier fehlt mit Absicht eine Spalte.** Ein Eintrag hängt neu an einem
    # Kapitel (`kapitel_id`, `not null`), alt an der Ausgabe plus einer festen
    # `rubrik` aus sechs Werten. Das Kapitel dazu ist eine Zeile, die es noch
    # nicht gibt — aus n Einträgen müssten erst m Kapitel entstehen, und das
    # kann der Motor nicht: er übersetzt Zeile für Zeile, er erfindet keine.
    #
    # Die vorsichtige Fassung ist, den Verweis **nicht** zu raten. Die Ausgabe
    # als Kapitel einzusetzen wäre ein Fremdschlüssel auf die falsche Tabelle,
    # ein Kapitel je Eintrag zu rechnen ergäbe sechs Kapitel gleichen Namens.
    # Solange die Quelltabelle leer ist, kostet das nichts; käme je eine Zeile,
    # bricht das Einfügen an `not null` ab und jemand muss sich die Kapitel
    # ansehen — was ohnehin die richtige Reihenfolge wäre.
    Umzug(
        alt="newsletter_eintrag",
        neu="newsletter_eintrag",
        id_aus="uuid5",
        sortierung="newsletter_id, rubrik, reihenfolge",
        spalten={
            "untertitel": "untertitel",
            "inhalt_md": "inhalt_md",
            "sortierung": "reihenfolge",
        },
        wandler={"untertitel": _gekuerzt(200)},
    ),
    # `bild_data` (`bytea`) wird zum Pfad im Eimer `newsletter`; `bild_mime`
    # hat kein Gegenstück mehr, der Speicher kennt den Typ selbst. Anders als
    # bei FAIR liegen die Bytes hier in der alten Datenbank — ein Kopierschritt
    # bliebe also machbar, er gehört nur nicht in einen Zeilen-Umzug.
    #
    # Das Einzelbild am Eintrag (`newsletter_eintrag.bild_data`) fällt weg: im
    # neuen Stack deckt das Raster mit einem Bild diesen Fall ab.
    Umzug(
        alt="newsletter_eintrag_bild",
        neu="newsletter_bild",
        id_aus="uuid5",
        sortierung="eintrag_id, reihenfolge",
        verweise={"eintrag_id": "newsletter_eintrag"},
        spalten={
            "eintrag_id": "eintrag_id",
            "pfad": "id",
            "spalten": "spalten",
            "zeilen": "zeilen",
            "sortierung": "reihenfolge",
        },
        wandler={
            "pfad": _pfad("newsletter"),
            # Neu eingegrenzt auf 1–4 Spalten und 1–2 Zeilen: so viel gibt das
            # Raster her.
            "spalten": _zwischen(1, 4),
            "zeilen": _zwischen(1, 2),
        },
    ),
    # --- Querschnitt --------------------------------------------------------
    # Zehn Meldungen, alle mit Screenshot. Der Screenshot bleibt zurück:
    # `screenshot_data` (`bytea`) + `screenshot_mime` stehen im Altprojekt in
    # der Zeile, neu gibt es nur `bild_pfad` in den Eimer `feedback` — und der
    # Motor kopiert keine Bytes. `bild_pfad` bleibt deshalb leer; die Spalte
    # darf das, und eine Meldung ohne Bild ist immer noch eine Meldung.
    #
    # `melder` bleibt leer (Directus-UUID, siehe Modulkopf), `melder_email`
    # steht in der Abbildung, wird aber vom Trigger `feedback_melder`
    # überschrieben — beides landet als `NULL` in der Zeile.
    Umzug(
        alt="page_feedback",
        neu="feedback",
        id_aus="alt",
        sortierung="created_at",
        spalten={
            "seite": "page_url",
            "beschreibung": "description",
            "browser": "user_agent",
            "ansicht": "viewport",
            "status": "status",
            "gesehen_am": "viewed_at",
            "erstellt_am": "created_at",
            "melder_email": "reporter_email",
        },
        wandler={
            # Genau so kürzt es auch die Maske beim Melden.
            "seite": _gekuerzt(500),
            "status": lambda s: FEEDBACK_STATUS.get(s, s),
        },
    ),
    # Der neue Kommentar ist schlanker. Was wegfällt und warum:
    #
    # * `rating` (rot/gelb/grün) — die Bewertung einer Kennzahl kommt im neuen
    #   Stack aus dem Zielwert und seiner Richtung, nicht aus einer Hand.
    # * `region_x/y/w/h` und `number` — im Altprojekt klebt ein Kommentar als
    #   nummerierte Blase auf einem Bildausschnitt des Diagramms. Diesen
    #   Bildausschnitt gibt es nicht mehr; die Koordinaten zeigten ins Leere.
    # * `author_name` — der Name ohne Konto dahinter. `verfasser` ist ein
    #   Fremdschlüssel auf `auth.users`, dort passt er nicht hinein, und eine
    #   zweite Namensspalte gibt es nicht.
    # * `viewed_at` — „gesehen" kennt nur das Feedback, nicht der Kommentar.
    #
    # `zeitraum_von`/`zeitraum_bis` sind umgekehrt neu und bleiben leer: der
    # alte Kommentar hängt am Diagramm, nicht an einem Zeitraum.
    Umzug(
        alt="kpi_comment",
        neu="kpi_kommentare",
        id_aus="alt",
        sortierung="created_at",
        auslassen=_ohne_zielwert,
        spalten={
            "schluessel": "kpi_key",
            "text": "body",
            "erstellt_am": "created_at",
        },
        wandler={"schluessel": SCHLUESSEL.get},
    ),
    # Bei der Maßnahme fallen drei Dinge weg:
    #
    # * `priority` (low/medium/high) — die neue Tabelle führt keine Priorität;
    #   im Abzug steht überall der Vorgabewert `medium`.
    # * `comment_id` — die Verknüpfung Maßnahme → Kommentar. Beide hängen jetzt
    #   am selben `schluessel`; im Abzug ist die Spalte leer.
    # * `assignee_personio_id` — die Zuständigkeit ist neu ein Name
    #   (`zustaendig`, Text), keine Personio-Kennung. Der Name kommt mit.
    Umzug(
        alt="kpi_measure",
        neu="kpi_massnahmen",
        id_aus="alt",
        sortierung="created_at",
        auslassen=_ohne_zielwert,
        spalten={
            "schluessel": "kpi_key",
            "titel": "title",
            "beschreibung": "description",
            "zustaendig": "assignee_name",
            "faellig_am": "due_date",
            "status": "status",
            "erledigt_am": "done_at",
            "erstellt_am": "created_at",
        },
        wandler={
            "schluessel": SCHLUESSEL.get,
            "titel": _gekuerzt(255),
            "zustaendig": _gekuerzt(128),
            "status": lambda s: MASSNAHMEN_STATUS.get(s, s),
            "erledigt_am": _tag,
        },
    ),
]
