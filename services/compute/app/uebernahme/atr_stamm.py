"""ATR-Stammdaten aus lumeapps übernehmen: Teile, Vorlagen, Lieferungen, Positionen.

Vier Tabellen, in dieser Reihenfolge — die Positionen hängen an beiden Eltern
(`lieferung_id` und `teil_id`), also müssen Teile und Lieferungen vorher stehen.

Die Umbenennung ist durchgängig: jede Spalte heißt im neuen Stack deutsch
(`part_number → teilenummer`, `qty → menge`, `source_filename → herkunft`).
Zugeordnet ist hier nach Bedeutung, Spalte für Spalte an beiden `\\d`
nachgesehen — die Reihenfolge stimmt bei `atr_part`/`atr_teile` zufällig
überein, das ist kein Argument.

**Der Schlüssel wechselt** von `integer` auf `uuid`. Drei der vier Tabellen
bekommen deshalb `id_aus="uuid5"`: die neue Kennung wird aus Tabellenname und
alter Zahl gerechnet, also können `delivery_id` und `matched_part_id` ihre
Ziele ausrechnen, statt sie nachzuschlagen. `atr_vorlagen` fällt heraus — die
Tabelle hat gar keine Spalte `id`, ihr Primärschlüssel ist das Programm.

**Was nicht mitkommt**, und warum:

* Die **erzeugten** Spalten `teilenummer_norm` (in `atr_teile` und
  `atr_positionen`) werden nie geschrieben, sie folgen der Teilenummer. Beide
  Seiten rechnen gleich (nur die Ziffern) — an den 292 echten Katalogzeilen
  geprüft: kein einziger Unterschied, keine Kollision.
* Die **Dateiinhalte**. Die alte `atr_delivery` trägt `atr_xlsx`, `atr_pdf` und
  `label_docx` als `bytea` in der Zeile, die neue verweist mit `mappe_pfad`,
  `pdf_pfad` und `etikett_pfad` auf den Speicher. Der Motor kopiert Spalten,
  nicht Dateien; die drei Pfade bleiben leer. Für den Betrieb heißt das: eine
  übernommene Lieferung hat ihre Dokumente nicht, sie muss im neuen Stack
  einmal neu erzeugt werden. Die Nutzlast dafür — Kopfdaten und Positionen —
  ist vollständig da, es ist ein Knopfdruck je Lieferung, kein Datenverlust.
* `atr_delivery_item.match_status`. Im neuen Stack sagt `teil_id`, ob eine
  Position ihr Teil gefunden hat — eine zweite, danebenstehende Meinung dazu
  gibt es bewusst nicht. Die beiden Angaben decken sich im Altbestand nicht
  ganz: 22 Zeilen stehen auf `matched`, haben aber kein `matched_part_id`
  mehr (das Teil wurde später gelöscht, der Verweis auf null gesetzt). Sie
  kommen als unzugeordnet an, was der Lage entspricht.
* `atr_delivery.origin` und `atr_delivery.source_path` — woher die Datei kam,
  Upload oder Eingangsordner. Die neue Tabelle führt das nicht; in der
  Produktion sind alle 132 Zeilen `upload` mit leerem Pfad, es geht also
  nichts Gefülltes verloren.
* Dasselbe bei `atr_template.structure_xlsx`: `atr.py` legt die Gerüstmappe
  über die Storage-API im Eimer `atr` ab und schreibt den Pfad. Das kann eine
  Spaltenabbildung nicht; `geruest_pfad` bleibt hier leer. `geruest_dateiname`
  kommt mit, damit sichtbar bleibt, welche Mappe fehlt.

**Unterschied zu `atr.py`** — dort steht der erprobte, eigene Weg für
Teilekatalog und Vorlagen, und wo beide sich widersprechen, gilt `atr.py`:
`atr.py` lässt Teilenummern ohne eine einzige Ziffer weg, weil sein
Konfliktschlüssel die normierte Nummer ist und die dort leer bliebe. Hier ist
der Konfliktschlüssel die gerechnete `id`, der Eindeutigkeitsindex auf
`teilenummer_norm` ist teilweise (`where … is not null`) und verträgt solche
Zeilen. Sie kommen deshalb mit, statt still zu verschwinden — in der
Produktion betrifft das null Zeilen, beide Wege liefern dieselben 292.

**Die beiden Wege vertragen sich nicht im selben Bestand.** `atr.py` vergibt
den Teilen zufällige Kennungen und stößt sich an der normierten Nummer; hier
ist die Kennung gerechnet und der Konflikt geht auf `id`. Steht der Katalog
schon aus einem `atr.py`-Lauf in der Datenbank, trifft dieser Umzug auf
`atr_teile_norm_idx` und bricht ab — `on conflict (id) do nothing` fängt einen
Konflikt auf einem anderen Index nicht. Also: **entweder** `uebernahme atr`
**oder** diesen Bereich, nicht beides. Auf leerem Ziel läuft er durch und ein
zweiter Lauf fügt nichts doppelt ein (an allen vier Tabellen geprüft).
"""
from __future__ import annotations

from app.atr.format import programmfamilie
from app.uebernahme.motor import Umzug

#: Alter Status → neuer. Der neue Check lässt nur `entwurf` und `freigegeben`
#: zu, der alte kennt `draft` (3 Zeilen) und `generated` (129) — verworfen wird
#: keine davon, aber **beide landen auf `entwurf`**, und das ist Absicht:
#: `atr_positionen` trägt den Trigger `atr_freigegeben_ist_fest`, der jedes
#: Einfügen in eine freigegebene Lieferung abweist. Käme eine Lieferung als
#: `freigegeben` an, scheiterte der nächste Umzug an genau ihren Positionen.
#: Sachlich passt `entwurf` ohnehin: `generated` heißt „ATR-Dokument erzeugt“,
#: und genau diese Dokumente kommen nicht mit (siehe oben) — die Lieferung ist
#: im neuen Stack wieder ein Entwurf, bis sie einmal erzeugt wurde.
#: Wer den alten Stand trotzdem braucht, setzt ihn nach dem Positionslauf
#: nach; die alte Datenbank sagt, welche es waren, und die Kennung ist
#: gerechnet: `neue_id("atr_delivery", <alte id>)`.
STATUS = {"draft": "entwurf", "generated": "entwurf"}


def _status(wert: str | None) -> str:
    """Unbekanntes gilt als Entwurf — ein erfundenes `freigegeben` wäre
    schlimmer als ein zu vorsichtiger Status."""
    return STATUS.get(wert or "", "entwurf")


def _seriennummern(wert: str | None) -> list[str]:
    """`"A08UAEL3393, A08UAEL3394"` → zwei Einträge.

    Im Altprojekt ist das ein Textfeld mit Komma dazwischen, hier ein
    `text[]`, das nicht null sein darf. Leeres wird zur leeren Liste, nicht zu
    `{""}` — eine leere Seriennummer wäre eine Seriennummer.
    """
    return [s.strip() for s in (wert or "").split(",") if s.strip()]


#: Teile und Lieferungen tragen das Programm in verschiedenen Schreibweisen
#: (`A350 XWB`, `A380 - 800`, leer). Die neue Spalte ist 20 Zeichen kurz und
#: dient als Schlüssel zur Vorlage, also wird auf die Familie reduziert —
#: dieselbe Funktion, die auch der laufende Betrieb benutzt.
_programm = programmfamilie


UMZUEGE: list[Umzug] = [
    # --- Teilekatalog -------------------------------------------------------
    # 292 Zeilen. `teilenummer_norm` fehlt mit Absicht: erzeugte Spalte.
    Umzug(
        alt="atr_part",
        neu="atr_teile",
        id_aus="uuid5",
        spalten={
            "teilenummer": "part_number",
            "lieferantennummer": "supplier_article_code",
            "bezeichnung": "part_name",
            # Zeichnungsnummer samt Ausgabestand, im Alten ein Feld, hier auch.
            "zeichnung": "drawing_number_issue",
            "gewicht_kg": "default_weight_kg",
            # Regelmenge je Teil; alt `integer`, neu `smallint`. Höchstwert in
            # der Produktion: 10. Der Check `menge >= 1` hält, alt ist es
            # `not null default 1`.
            "menge": "qty",
            "kategorie": "category",
            "bestellposition": "po_pos",
            # Woher die Zeile stammt — die Referenzmappe, aus der sie gelesen
            # wurde. Alt `not null`, neu freiwillig; der Wert kommt trotzdem
            # mit, er ist die einzige Herkunftsangabe des Katalogs.
            "herkunft": "source_filename",
            "erstellt_am": "imported_at",
            "geaendert_am": "updated_at",
        },
    ),
    # --- Vorlagen -----------------------------------------------------------
    # 2 Zeilen. Kein `id_aus`: `atr_vorlagen` hat keine Spalte `id`, der
    # Primärschlüssel ist `programm`. Die alte Zahl (1 = A350, 2 = A380) hat im
    # neuen Stack keine Bedeutung und wird deshalb gar nicht erst gelesen
    # (`alt_id=False`); auf `atr_template` verweist auch nichts.
    Umzug(
        alt="atr_template",
        neu="atr_vorlagen",
        id_aus=None,
        alt_id=False,
        schluessel=("programm",),
        spalten={
            # Nicht aus `ac_programme`: das ist bei der A350-Vorlage leer, und
            # der Dateiname ist dort der einzige Hinweis auf die Familie —
            # genau der Rückfall, den `atr.py` nimmt. Der Motor reicht einem
            # Wandler nur eine Spalte, also wird gleich die genommen, die bei
            # **beiden** Produktionszeilen trägt (`…A350…`, `…A380…`).
            "programm": "structure_filename",
            "kunde": "customer",
            "arbeitspaket": "work_package",
            "besteller_spez": "purchaser_spec",
            "atp": "atp",
            "lieferanten_spez": "supplier_spec",
            "referenz": "reference_no",
            "lieferant": "supplier",
            "kunden_spez": "customer_spec",
            "nscm": "nscm_code",
            "ata_kapitel": "ata_chapter",
            "waage": "weighing_equipment",
            "qs_unterschrift": "qa_signer_default",
            "geruest_dateiname": "structure_filename",
            "geaendert_am": "updated_at",
        },
        wandler={"programm": _programm},
    ),
    # --- Lieferungen --------------------------------------------------------
    # 132 Zeilen. `hinweise` bleibt beim Vorgabewert `[]` — das sind Meldungen
    # des Einlesers an den Bearbeiter, keine Stammdaten; erfundene Hinweise
    # stünden sonst als Warnung in der Oberfläche.
    Umzug(
        alt="atr_delivery",
        neu="atr_lieferungen",
        id_aus="uuid5",
        spalten={
            "quelle_dateiname": "source_filename",
            "lieferschein_nr": "lieferschein_nr",
            "datum": "datum",
            "ba_auftrag": "ba_auftrag",
            "bestellnummer": "po_number",
            "programm": "ac_programme",
            # Warum die Programmerkennung so entschieden hat.
            "programm_grund": "programme_reason",
            # Kabinenabschnitt (`FWD`, `AFT` …).
            "bereich": "compartment",
            "msn": "msn",
            # Bettvariante, im Alten `bed_config`, einstellig.
            "bettvariante": "bed_config",
            "satz_titel": "set_title",
            "atr_nummer": "atr_number",
            "containernummer": "container_number",
            "wiegedatum": "weighing_date",
            "pruefdatum": "testing_date",
            "qs_unterschrift": "qa_signer",
            "max_gewicht_kg": "max_guaranteed_weight_kg",
            "status": "status",
            # Wann das ATR-Dokument geschrieben wurde. In der Produktion
            # durchgehend leer — das Feld kam später als die Bestände.
            "erzeugt_am": "output_written_at",
            "erstellt_am": "created_at",
            "geaendert_am": "updated_at",
        },
        wandler={"status": _status, "programm": _programm},
    ),
    # --- Positionen ---------------------------------------------------------
    # 851 Zeilen. Beide Verweise zeigen auf Tabellen mit gerechnetem
    # Schlüssel, also setzt der Motor dieselbe UUID ein, die er dort vergeben
    # hat — ohne Nachschlagewerk, und beim zweiten Lauf wieder dieselbe.
    Umzug(
        alt="atr_delivery_item",
        neu="atr_positionen",
        id_aus="uuid5",
        verweise={"lieferung_id": "atr_delivery", "teil_id": "atr_part"},
        spalten={
            "lieferung_id": "delivery_id",
            # Zeilenfolge auf dem Lieferschein; eindeutig je Lieferung
            # (`unique (lieferung_id, reihenfolge)`), in der Produktion ohne
            # Dublette. Nicht dasselbe wie `pos`: das ist die gedruckte
            # Positionsnummer und darf fehlen.
            "reihenfolge": "row_order",
            "pos": "pos",
            "lieferantennummer": "supplier_article_code",
            "teilenummer": "part_number",
            "teil_id": "matched_part_id",
            "bezeichnung": "part_name",
            "zeichnung": "drawing_number_issue",
            "kategorie": "category",
            "menge": "qty",
            "gewicht_kg": "weight_kg",
            "bestellposition": "po_pos",
            "seriennummern": "serial_numbers",
        },
        wandler={"seriennummern": _seriennummern},
    ),
]
