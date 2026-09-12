"""Vertrieb und Einkauf: die Upload-Protokolle und alles, was an ihnen hängt.

Der ganze Strang ist eine getreue Portierung — die Spalten heißen auf beiden
Seiten gleich, nur ihre Reihenfolge weicht ab. Darum steht hier fast überall
`_gleich(...)`; aufgeschrieben wird nur, was sich tatsächlich unterscheidet.

`upload_batches` steht zuerst, und das ist keine Geschmacksfrage: elf der
zwölf Tabellen tragen einen `upload_batch_id`, und den kann der Motor erst
übersetzen, wenn die neue Datenbank ihre Schlüssel vergeben hat.

Drei Dinge weichen inhaltlich ab:

* `upload_batches.kind` benennt im neuen Stack die Hochladeart so, wie die
  Oberfläche sie anbietet (`umsatz` statt `revenues`) — siehe `KIND_ABBILDUNG`.
* `upload_batches.uploaded_by` ist neu und bleibt leer: die alte Tabelle weiß
  nicht, wer hochgeladen hat, und ein erfundener Name wäre schlimmer als eine
  leere Spalte.
* `interessenten.name` und `offers.name` heißen jetzt `customer_name`, wie in
  allen anderen Vertriebstabellen auch.

Zwei alte Spalten haben im neuen Stack kein Gegenstück und bleiben zurück:
`auftrag_positionen.external_order_nr` und `goods_receipt_records.order_date`.
Beide stehen zusätzlich in `raw`, gehen also nicht wirklich verloren, sind
dort aber nicht abfragbar.
"""
from __future__ import annotations

from typing import Any

from app.uebernahme.motor import Umzug

#: Die alten Sorten heißen im neuen Stack wie die Kacheln der Hochladeseite.
#: Alle sechzehn Sorten aus der Produktion stehen hier; eine Altsorte fällt
#: mit ihrem Nachfolger zusammen, weil auch die Tabellen zusammengefallen sind:
#: `orders` schrieb in `sales_records`, das im neuen Stack in `revenues`
#: aufgegangen ist. `material_prices` hat wieder eine eigene Tabelle und eine
#: eigene Kachel — die Preisquelle der Materialkostenquote, nicht die
#: Artikel-Preisliste des Lagers.
KIND_ABBILDUNG = {
    "revenues": "umsatz",
    "orders": "umsatz",
    "auftraege": "auftraege",
    "auftrag_positionen": "auftragspositionen",
    "deliveries": "lieferscheine",
    "goods_receipts": "wareneingaenge",
    "delivery_reliability": "liefertreue",
    "material_movements": "lagerbewegungen",
    "stock_prices": "lagerpreise",
    "material_prices": "materialpreise",
    "quality": "acht_d",
    "inspections": "pruefungen",
    "contacts": "kontakte",
    "offers": "angebote",
    "interessenten": "interessenten",
}

#: Das Tippspiel kommt nicht mit (siehe `abgleich.PAARE`). Sein Protokoll
#: ohne Zeilen stehen zu lassen, wäre ein Eintrag in der Hochladeliste, den
#: niemand mehr aufklappen kann.
OHNE_ZUHAUSE = {"tippspiel"}

#: Die neue Tabelle prüft den Status. Was sie nicht kennt, wäre sonst ein
#: abgebrochener Lauf — in der Produktion kommen nur diese drei vor.
ERLAUBTE_STATUS = {"success", "partial", "failed"}

#: Elf Tabellen zeigen auf dasselbe Protokoll. Einmal benannt, elfmal benutzt.
PROTOKOLL = {"upload_batch_id": "upload_batches"}


def _gleich(*namen: str) -> dict[str, str]:
    """Spalten, die beidseitig gleich heißen — der Normalfall hier."""
    return {name: name for name in namen}


def _sorte(wert: Any) -> Any:
    """Eine unbekannte Sorte bleibt, wie sie ist: `kind` hat keine Prüfregel,
    und ein durchgereichter Name ist ehrlicher als ein geratener."""
    return KIND_ABBILDUNG.get(wert, wert)


def _status(wert: Any) -> Any:
    """Ein unbekannter Status wäre eine stille Lüge; lieber deutlich."""
    return wert if wert in ERLAUBTE_STATUS else "failed"


def _tippspiel(zeile: dict) -> bool:
    return zeile.get("kind") in OHNE_ZUHAUSE


#: Reihenfolge = Abhängigkeit: das Protokoll zuerst, dann seine Zeilen.
UMZUEGE: list[Umzug] = [
    # Der Schlüssel ist beidseitig eine Zahl, die neue Tabelle vergibt ihn
    # aber selbst (`generated always as identity`) — also `id_aus=None`, und
    # der Motor merkt sich alt → neu für alle Kindtabellen.
    #
    # `schluessel=("id",)` ist hier nur der Primärschlüssel und trifft nie:
    # einen natürlichen Schlüssel hat die Tabelle bewusst nicht (er würde
    # zwei echte Uploads mit gleichem Namen und Zeitpunkt verbieten). Ein
    # zweiter Lauf legt die Protokolle deshalb erneut an.
    Umzug(
        alt="upload_batches",
        neu="upload_batches",
        spalten=_gleich(
            "filename", "uploaded_at", "kind", "row_count", "error_count", "status"
        ),
        id_aus=None,
        schluessel=("id",),
        wandler={"kind": _sorte, "status": _status},
        auslassen=_tippspiel,
        sortierung="id",
    ),
    # revenues, auftraege, offers, interessenten und stock_article_prices
    # führen beidseitig keine `id`: ihr Primärschlüssel ist die Vorgangs-,
    # Adress- bzw. Artikelnummer. Darum `alt_id=False` und der fachliche
    # Schlüssel als Konfliktziel.
    Umzug(
        alt="revenues",
        neu="revenues",
        spalten=_gleich(
            "vorgang_nr", "typ", "datum", "adr_nr", "customer_name", "wert_eur",
            "upload_batch_id", "imported_at", "raw",
        ),
        id_aus=None,
        alt_id=False,
        verweise=PROTOKOLL,
        schluessel=("vorgang_nr",),
    ),
    Umzug(
        alt="auftraege",
        neu="auftraege",
        spalten=_gleich(
            "vorgang_nr", "typ", "datum", "adr_nr", "customer_name", "erfasser",
            "wert_eur", "upload_batch_id", "imported_at", "raw",
        ),
        id_aus=None,
        alt_id=False,
        verweise=PROTOKOLL,
        schluessel=("vorgang_nr",),
    ),
    # Die vier Positionstabellen haben dieselbe Form und denselben fachlichen
    # Schlüssel: Vorgang, Position, Unterposition. Ihr `imported_at` kennt die
    # alte Seite nicht — die neue Spalte setzt es selbst auf `now()`.
    Umzug(
        alt="auftrag_positionen",
        neu="auftrag_positionen",
        spalten=_gleich(
            "vorgang_nr", "pos", "upos", "typ", "entry_date", "lieferdatum",
            "customer_id", "customer_name", "customer_city", "article_number",
            "article_version", "article_name", "quantity", "unit", "price",
            "position_value", "pos_typ_2", "upload_batch_id", "raw",
        ),
        id_aus=None,
        verweise=PROTOKOLL,
        schluessel=("vorgang_nr", "pos", "upos"),
    ),
    # Der einzige Vertriebsexport ohne Protokollbezug: die alte Tabelle führt
    # keinen `upload_batch_id`, die neue schon. Die Spalte bleibt leer.
    Umzug(
        alt="sales_contacts",
        neu="sales_contacts",
        spalten=_gleich(
            "contact_date", "employee_token", "contact_type", "customer_group",
            "status", "customer_name", "comment", "external_id", "imported_at",
            "raw",
        ),
        id_aus=None,
        schluessel=("id",),
    ),
    Umzug(
        alt="interessenten",
        neu="interessenten",
        spalten={
            "adress_nr": "adress_nr",
            "customer_name": "name",
            "datum_save": "datum_save",
            "upload_batch_id": "upload_batch_id",
            "imported_at": "imported_at",
            "raw": "raw",
        },
        id_aus=None,
        alt_id=False,
        verweise=PROTOKOLL,
        schluessel=("adress_nr",),
    ),
    Umzug(
        alt="offers",
        neu="offers",
        spalten={
            "vorgang_nr": "vorgang_nr",
            "datum": "datum",
            "adr_nr": "adr_nr",
            "customer_name": "name",
            "ort": "ort",
            "erfasser": "erfasser",
            "wert_eur": "wert_eur",
            "upload_batch_id": "upload_batch_id",
            "imported_at": "imported_at",
            "raw": "raw",
        },
        id_aus=None,
        alt_id=False,
        verweise=PROTOKOLL,
        schluessel=("vorgang_nr",),
    ),
    Umzug(
        alt="delivery_records",
        neu="delivery_records",
        spalten=_gleich(
            "vorgang_nr", "pos", "upos", "typ", "entry_date", "delivery_date",
            "customer_id", "customer_name", "customer_city", "article_number",
            "article_version", "article_name", "quantity", "unit", "price",
            "position_value", "external_order_nr", "order_nr",
            "upload_batch_id", "raw",
        ),
        id_aus=None,
        verweise=PROTOKOLL,
        schluessel=("vorgang_nr", "pos", "upos"),
    ),
    # Hier heißt der Vorgang `auftrag` — es ist der Auftrag beim Lieferanten,
    # nicht der eigene. Entsprechend anderes Konfliktziel.
    Umzug(
        alt="delivery_reliability",
        neu="delivery_reliability",
        spalten=_gleich(
            "auftrag", "pos", "upos", "adr_nr", "supplier_name", "delivered_date",
            "target_date", "verzug_tage", "quantity", "unit", "article_number",
            "article_name", "upload_batch_id", "raw",
        ),
        id_aus=None,
        verweise=PROTOKOLL,
        schluessel=("auftrag", "pos", "upos"),
    ),
    # `order_date` fehlt der neuen Tabelle. Das Bestelldatum steht weiter in
    # `raw`; abfragbar ist es nicht mehr.
    Umzug(
        alt="goods_receipt_records",
        neu="goods_receipt_records",
        spalten=_gleich(
            "vorgang_nr", "pos", "upos", "typ", "entry_date", "receipt_date",
            "supplier_id", "supplier_name", "supplier_city", "article_number",
            "article_version", "article_name", "quantity", "unit", "price",
            "position_value", "order_nr", "material_group", "purchase_account",
            "upload_batch_id", "raw",
        ),
        id_aus=None,
        verweise=PROTOKOLL,
        schluessel=("vorgang_nr", "pos", "upos"),
    ),
    # Die Preisquelle der Materialkostenquote. Dieselbe Datei wie die
    # Wareneingänge darüber, aber ein eigener Upload mit eigenem Stand — darum
    # eine eigene Tabelle, sonst rechnete die Quote mit anderen Preisen als
    # das Altsystem. Schlüssel wie beim Upload.
    Umzug(
        alt="material_prices",
        neu="material_prices",
        spalten=_gleich(
            "vorgang_nr", "pos", "upos", "typ", "datum", "artnr", "article_name",
            "menge", "unit", "preis", "pos_wert", "upload_batch_id", "raw",
        ),
        id_aus=None,
        verweise=PROTOKOLL,
        schluessel=("vorgang_nr", "pos", "upos"),
    ),
    # Die größte Tabelle des Laufs (rund 193.000 Zeilen). Ein fachlicher
    # Schlüssel wäre falsch: dieselbe Entnahme darf zweimal in derselben
    # Minute stehen — deshalb bleibt nur der Primärschlüssel als Konfliktziel,
    # und der trifft nie. Ein zweiter Lauf verdoppelt die Bewegungen.
    Umzug(
        alt="material_movements",
        neu="material_movements",
        spalten=_gleich(
            "artikelnr", "article_name", "buch_datum", "bewegungsmenge",
            "buchtyp", "kommentar", "upload_batch_id", "imported_at", "raw",
        ),
        id_aus=None,
        verweise=PROTOKOLL,
        schluessel=("id",),
    ),
    # Preise je Artikel, ohne Protokollbezug auf beiden Seiten.
    Umzug(
        alt="stock_article_prices",
        neu="stock_article_prices",
        spalten=_gleich(
            "artnr", "unit_price", "price_unit", "article_name", "updated_at"
        ),
        id_aus=None,
        alt_id=False,
        schluessel=("artnr",),
    ),
]
