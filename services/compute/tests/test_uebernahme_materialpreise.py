"""Übernahme der Materialpreise aus dem Altsystem.

Die alte Tabelle `material_prices` ist die Preisquelle der Materialkostenquote
und kommt deshalb mit — in die gleichnamige neue Tabelle, nicht in die
Artikel-Preisliste des Lagers. Ihre Upload-Protokolle heißen im neuen Stack
wie die Kachel auf der Hochladeseite. Gegen die echte Alt-Datenbank läuft das
nur im Umzug selbst; hier steht, was sich still verschieben könnte.
"""
from app.db import material_prices
from app.routers.uploads import ARTEN
from app.uebernahme import vertrieb_einkauf
from app.uebernahme.abgleich import PAARE


def _umzug(alt: str):
    return next(u for u in vertrieb_einkauf.UMZUEGE if u.alt == alt)


def test_protokolle_heissen_wie_die_kachel():
    assert vertrieb_einkauf.KIND_ABBILDUNG["material_prices"] == "materialpreise"
    assert vertrieb_einkauf.KIND_ABBILDUNG["stock_prices"] == "lagerpreise"


def test_jede_abgebildete_sorte_hat_eine_route():
    """Sonst stünde ein übernommenes Protokoll unter einer Art, die es nicht gibt."""
    assert set(vertrieb_einkauf.KIND_ABBILDUNG.values()) <= set(ARTEN)


def test_materialpreise_ziehen_in_ihre_eigene_tabelle():
    umzug = _umzug("material_prices")
    assert umzug.neu == "material_prices"
    assert set(umzug.spalten) <= set(material_prices.c.keys())
    assert umzug.verweise == {"upload_batch_id": "upload_batches"}
    # Derselbe Schlüssel wie beim Upload — ein zweiter Lauf fügt nichts doppelt ein.
    assert umzug.schluessel == ("vorgang_nr", "pos", "upos")


def test_erst_das_protokoll_dann_die_preise():
    alte = [u.alt for u in vertrieb_einkauf.UMZUEGE]
    assert alte.index("upload_batches") < alte.index("material_prices")


def test_abgleich_zaehlt_sie():
    (paar,) = [p for p in PAARE if p.alt == "material_prices"]
    assert paar.neu == "material_prices"
