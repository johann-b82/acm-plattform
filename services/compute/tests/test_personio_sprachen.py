"""Die Sprachliste aus Personios Rohdaten.

Die Feldnamen sind nicht vorhersagbar — jedes Haus nennt das Feld anders und
pflegt es anders. Diese Fälle stehen hier, weil sie alle in echten
Personio-Beständen vorkommen.
"""
from app.personio.sprachen import sprachen_aus


def test_findet_ein_schlicht_benanntes_feld():
    roh = [{"attributes": {"muttersprache": {"value": "Türkisch"}}}]
    assert sprachen_aus(roh) == [("muttersprache", "Türkisch", 1)]


def test_findet_englische_feldnamen():
    roh = [
        {"attributes": {"mother_tongue": {"value": "Polish"}}},
        {"attributes": {"native_language": {"value": "Romanian"}}},
    ]
    felder = {f for f, _, _ in sprachen_aus(roh)}
    assert felder == {"mother_tongue", "native_language"}


def test_zaehlt_und_sortiert_haeufigste_zuerst():
    roh = [{"attributes": {"sprache": {"value": s}}} for s in ["Deutsch", "Türkisch", "Deutsch"]]
    assert sprachen_aus(roh)[0] == ("sprache", "Deutsch", 2)


def test_nimmt_jede_sprache_einer_mehrfachauswahl_einzeln():
    # Wer zwei Sprachen gepflegt hat, spricht zwei — nicht eine namens
    # „Deutsch, Türkisch".
    roh = [{"attributes": {"sprachen": {"value": ["Deutsch", "Türkisch"]}}}]
    assert sorted(sprachen_aus(roh)) == [
        ("sprachen", "Deutsch", 1),
        ("sprachen", "Türkisch", 1),
    ]


def test_loest_eine_referenz_auf():
    # Ein Auswahlfeld kommt als Referenz mit eigenen Attributen zurück.
    roh = [{"attributes": {"language": {"value": {"attributes": {"name": "Italiano"}}}}}]
    assert sprachen_aus(roh) == [("language", "Italiano", 1)]


def test_uebergeht_leere_und_fehlende_werte():
    roh = [
        {"attributes": {"sprache": {"value": None}}},
        {"attributes": {"sprache": {"value": "   "}}},
        {"attributes": {}},
        {},
        None,
    ]
    assert sprachen_aus(roh) == []


def test_uebergeht_felder_die_nicht_nach_sprache_klingen():
    # „Sprachkenntnisse" ja, „Abteilung" nein — und „position" erst recht
    # nicht, sonst steht die halbe Stammdatenmaske in der Liste.
    roh = [
        {
            "attributes": {
                "department": {"value": "Fertigung"},
                "position": {"value": "Näherin"},
                "sprachkenntnisse": {"value": "Türkisch"},
            }
        }
    ]
    assert sprachen_aus(roh) == [("sprachkenntnisse", "Türkisch", 1)]


def test_haelt_schreibweisen_auseinander():
    # „Türkisch" und „Turkish" zu vereinheitlichen hiesse raten. Die Liste
    # soll zeigen, was wirklich gepflegt ist — auch wenn es uneinheitlich ist.
    roh = [
        {"attributes": {"sprache": {"value": "Türkisch"}}},
        {"attributes": {"sprache": {"value": "Turkish"}}},
    ]
    assert len(sprachen_aus(roh)) == 2
