"""Der Messdurchgang, ohne Gerät im Netz.

Geprüft wird das, was zwischen Abfrage und Zeile passiert: die Umrechnung, die
Trennung von Messwert und Versuch, und dass ein Gerät die anderen nicht
aufhält.
"""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest

from app import netz
from app import geheim
from app.sensoren import messen, snmp


class TestGeheimnis:
    def test_hin_und_zurueck(self):
        from cryptography.fernet import Fernet

        echt = Fernet.generate_key().decode()
        with patch.object(geheim.settings, "GEHEIM_SCHLUESSEL", echt):
            assert geheim.entschluesseln(geheim.verschluesseln("geheim123")) == "geheim123"

    def test_der_alte_name_gilt_weiter(self):
        # `SENSOR_SCHLUESSEL` steht in laufenden Umgebungen. Ein Namenswechsel,
        # der beim Ausrollen die Sensoren stumm schaltet, wäre ein schlechter
        # Tausch für ein hübscheres Wort.
        from cryptography.fernet import Fernet

        alt = Fernet.generate_key().decode()
        with patch.object(geheim.settings, "GEHEIM_SCHLUESSEL", ""):
            with patch.object(geheim.settings, "SENSOR_SCHLUESSEL", alt):
                assert geheim.entschluesseln(geheim.verschluesseln("geheim123")) == "geheim123"

    def test_der_neue_name_gewinnt(self):
        from cryptography.fernet import Fernet

        neu, alt = Fernet.generate_key().decode(), Fernet.generate_key().decode()
        with patch.object(geheim.settings, "GEHEIM_SCHLUESSEL", neu):
            with patch.object(geheim.settings, "SENSOR_SCHLUESSEL", alt):
                text = geheim.verschluesseln("geheim123")
        with patch.object(geheim.settings, "GEHEIM_SCHLUESSEL", neu):
            with patch.object(geheim.settings, "SENSOR_SCHLUESSEL", ""):
                assert geheim.entschluesseln(text) == "geheim123"

    def test_ohne_schluessel_geht_nichts(self):
        with patch.object(geheim.settings, "GEHEIM_SCHLUESSEL", ""):
            with patch.object(geheim.settings, "SENSOR_SCHLUESSEL", ""):
                with pytest.raises(geheim.KeinSchluessel, match="GEHEIM_SCHLUESSEL"):
                    geheim.verschluesseln("egal")
                assert geheim.einsatzbereit() is False

    def test_unbrauchbarer_schluessel_faellt_beim_ersten_griff_auf(self):
        # Nicht erst, wenn jemand etwas ablegen will: die Maske fragt vorher.
        with patch.object(geheim.settings, "GEHEIM_SCHLUESSEL", "kein-fernet-schluessel"):
            assert geheim.einsatzbereit() is False
            with pytest.raises(geheim.KeinSchluessel):
                geheim.verschluesseln("egal")

    def test_falscher_schluessel_faellt_auf(self):
        from cryptography.fernet import Fernet

        einer, anderer = Fernet.generate_key().decode(), Fernet.generate_key().decode()
        with patch.object(geheim.settings, "GEHEIM_SCHLUESSEL", einer):
            text = geheim.verschluesseln("geheim123")
        with patch.object(geheim.settings, "GEHEIM_SCHLUESSEL", anderer):
            with pytest.raises(geheim.NichtLesbar):
                geheim.entschluesseln(text)


class TestAllowlist:
    """Befund 16, zweiter Fall: auch ein SNMP-Ziel ist nicht frei wählbar."""

    def test_ohne_freigabe_geht_gar_nichts(self):
        with patch.object(messen.settings, "SNMP_ERLAUBT", ""):
            with pytest.raises(netz.ZielNichtErlaubt, match="SNMP_ERLAUBT"):
                messen.pruefe_ziel("sensor.acm.local")

    def test_name_passt_genau(self):
        with patch.object(messen.settings, "SNMP_ERLAUBT", "sensor.acm.local"):
            messen.pruefe_ziel("SENSOR.ACM.LOCAL")
            with pytest.raises(netz.ZielNichtErlaubt):
                messen.pruefe_ziel("fremd.example")

    def test_netz_wird_aufgeloest(self):
        with patch.object(messen.settings, "SNMP_ERLAUBT", "192.9.200.0/24"):
            with patch.object(
                netz.socket, "getaddrinfo",
                return_value=[(0, 0, 0, "", ("192.9.200.40", 161))],
            ):
                messen.pruefe_ziel("sensor.acm.local")

    def test_ausserhalb_des_netzes_faellt_durch(self):
        with patch.object(messen.settings, "SNMP_ERLAUBT", "192.9.200.0/24"):
            with patch.object(
                netz.socket, "getaddrinfo",
                return_value=[(0, 0, 0, "", ("8.8.8.8", 161))],
            ):
                with pytest.raises(netz.ZielNichtErlaubt, match="keinem freigegebenen Netz"):
                    messen.pruefe_ziel("umgeleitet.example")


class TestUmrechnung:
    @pytest.mark.parametrize(
        "roh, faktor, erwartet",
        [
            (23.5, Decimal(1), Decimal("23.500")),
            # Ein Gerät, das Zehntelgrad als ganze Zahl liefert.
            (235, Decimal("0.1"), Decimal("23.500")),
            (None, Decimal(1), None),
        ],
    )
    def test_faktor_wird_angewandt(self, roh, faktor, erwartet):
        assert messen._skaliert(roh, faktor) == erwartet


class Zeile:
    """Eine Sensorzeile, so viel davon wie der Durchgang anfasst."""

    def __init__(self, name, temperatur_oid="1.1", feuchte_oid=None):
        self.id = f"id-{name}"
        self.name = name
        self.rechner = "sensor.acm.local"
        self.port = 161
        self.community = b"egal"
        self.temperatur_oid = temperatur_oid
        self.feuchte_oid = feuchte_oid
        self.temperatur_faktor = Decimal(1)
        self.feuchte_faktor = Decimal(1)


class TestEinDurchgang:
    """`_einen` ist der Teil ohne Datenbank — hier lässt er sich zeigen."""

    @pytest.mark.asyncio
    async def test_ein_wert_reicht(self, monkeypatch):
        monkeypatch.setattr(messen, "pruefe_ziel", lambda r: None)
        monkeypatch.setattr(geheim, "entschluesseln", lambda t: "public")

        async def hole(rechner, port, community, oid):
            return 21.5, None

        monkeypatch.setattr(snmp, "hole", hole)
        messung, fehler = await messen._einen(Zeile("Serverraum"))
        assert messung["temperatur"] == Decimal("21.500")
        assert messung["feuchte"] is None
        assert fehler is None

    @pytest.mark.asyncio
    async def test_keine_antwort_ist_kein_messwert(self, monkeypatch):
        monkeypatch.setattr(messen, "pruefe_ziel", lambda r: None)
        monkeypatch.setattr(geheim, "entschluesseln", lambda t: "public")

        async def hole(rechner, port, community, oid):
            return None, snmp.Fehler("No SNMP response received before timeout")

        monkeypatch.setattr(snmp, "hole", hole)
        messung, fehler = await messen._einen(Zeile("Lager"))
        assert messung is None
        assert "timeout" in fehler

    @pytest.mark.asyncio
    async def test_ein_verbotenes_ziel_wird_gar_nicht_erst_gefragt(self, monkeypatch):
        def verboten(rechner):
            raise netz.ZielNichtErlaubt("steht nicht in SNMP_ERLAUBT")

        monkeypatch.setattr(messen, "pruefe_ziel", verboten)

        async def nie(*args):  # pragma: no cover — darf nicht laufen
            raise AssertionError("es wurde trotzdem gefragt")

        monkeypatch.setattr(snmp, "hole", nie)
        messung, fehler = await messen._einen(Zeile("fremd"))
        assert messung is None
        assert "SNMP_ERLAUBT" in fehler


class TestKeineGrenzenJeGeraet:
    """SET-11: Grenzen gibt es nur noch global. Die alten Spalten bleiben
    stehen, aber über `compute` lässt sich dort nichts mehr eintragen."""

    def test_die_aenderung_nimmt_keine_grenze_mehr_an(self):
        from app.routers.sensoren import SensorAenderung

        aenderung = SensorAenderung(temperatur_min=5, feuchte_max=90, name="Lager")
        assert aenderung.model_dump(exclude_unset=True) == {"name": "Lager"}

    def test_das_anlegen_auch_nicht(self):
        from app.routers.sensoren import SensorEingabe

        eingabe = SensorEingabe(
            name="Lager", rechner="x", community="c", temperatur_oid="1.1",
            temperatur_min=5, temperatur_max=9,
        )
        assert "temperatur_min" not in eingabe.model_dump()
