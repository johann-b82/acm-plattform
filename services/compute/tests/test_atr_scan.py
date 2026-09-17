"""Der Scan des Eingangsordners.

Zwei Dinge stehen im Blick, und beide lassen sich ohne Dateiserver prüfen:
die Allowlist auf das Ziel (Befund 16 im Altprojekt) und die Reihenfolge im
Ablauf — erst lesen und schreiben, dann archivieren.
"""
from __future__ import annotations

import ipaddress
from unittest.mock import patch

import pytest

from app import netz
from app.atr import dateiserver, scan as scan_modul
from app.atr.dateiserver import DateiserverFehler, ZielNichtErlaubt, Ziel, unc


def ziel(rechner: str = "acm_file.acm.local") -> Ziel:
    return Ziel(
        rechner=rechner, freigabe="Dateiablage", domaene="ACM", benutzer="dienst",
        passwort="geheim", eingang="ATR/Input", ausgang="ATR/Output",
        archiv="ATR/Archiv",
    )


class TestAllowlist:
    """Befund 16: ohne diese Prüfung verbindet sich der Dienst dorthin, wo ein
    Admin ihn hinschickt — und nimmt die Anmeldung mit."""

    def test_ohne_freigabe_geht_gar_nichts(self):
        with patch.object(dateiserver.settings, "ATR_SMB_ERLAUBT", ""):
            with pytest.raises(ZielNichtErlaubt, match="kein Ziel freigegeben"):
                dateiserver.pruefe_ziel("beliebig.example")

    def test_name_passt_genau(self):
        with patch.object(
            dateiserver.settings, "ATR_SMB_ERLAUBT", "acm_file.acm.local"
        ):
            dateiserver.pruefe_ziel("acm_file.acm.local")
            dateiserver.pruefe_ziel("ACM_FILE.ACM.LOCAL")  # Schreibweise egal
            with pytest.raises(ZielNichtErlaubt, match="steht nicht"):
                dateiserver.pruefe_ziel("boeser.example")

    def test_netz_wird_aufgeloest(self):
        with patch.object(dateiserver.settings, "ATR_SMB_ERLAUBT", "192.9.200.0/24"):
            with patch.object(
                netz.socket,
                "getaddrinfo",
                return_value=[(0, 0, 0, "", ("192.9.200.18", 445))],
            ):
                dateiserver.pruefe_ziel("acm_file.acm.local")

    def test_ausserhalb_des_netzes_faellt_durch(self):
        with patch.object(dateiserver.settings, "ATR_SMB_ERLAUBT", "192.9.200.0/24"):
            with patch.object(
                netz.socket,
                "getaddrinfo",
                return_value=[(0, 0, 0, "", ("10.1.2.3", 445))],
            ):
                with pytest.raises(ZielNichtErlaubt, match="keinem freigegebenen Netz"):
                    dateiserver.pruefe_ziel("umgeleitet.example")

    def test_jede_adresse_muss_passen(self):
        """Ein Name, der auf zwei Adressen zeigt, darf nicht über die eine
        hinein und über die andere hinaus."""
        with patch.object(dateiserver.settings, "ATR_SMB_ERLAUBT", "192.9.200.0/24"):
            with patch.object(
                netz.socket,
                "getaddrinfo",
                return_value=[
                    (0, 0, 0, "", ("192.9.200.18", 445)),
                    (0, 0, 0, "", ("8.8.8.8", 445)),
                ],
            ):
                with pytest.raises(ZielNichtErlaubt):
                    dateiserver.pruefe_ziel("zweideutig.example")

    def test_unaufloesbarer_name_faellt_durch(self):
        with patch.object(dateiserver.settings, "ATR_SMB_ERLAUBT", "192.9.200.0/24"):
            with patch.object(
                netz.socket, "getaddrinfo", side_effect=OSError("kein DNS")
            ):
                with pytest.raises(ZielNichtErlaubt, match="nicht auflösen"):
                    dateiserver.pruefe_ziel("weg.example")


class TestPfade:
    """Befund 17: der Riegel sitzt im Erbauer, weil jeder Aufruf ihn passiert."""

    def test_setzt_zusammen(self):
        assert unc("srv", "Share", "a/b", "c.pdf") == r"\\srv\Share\a\b\c.pdf"

    def test_ohne_teile_bleibt_die_freigabe(self):
        assert unc("srv", "Share") == r"\\srv\Share"

    @pytest.mark.parametrize("boese", ["..", "a/../..", "ATR/../../etc"])
    def test_hinaus_geht_nicht(self, boese):
        with pytest.raises(DateiserverFehler, match="Unzulässig"):
            unc("srv", "Share", boese)

    def test_punkt_und_leere_abschnitte_fallen_weg(self):
        assert unc("srv", "Share", "./a//b/") == r"\\srv\Share\a\b"


class Dateiserver:
    """Ein Dateiserver im Speicher — er merkt sich, was in welcher Reihenfolge
    geschah."""

    def __init__(self, dateien: dict[str, bytes], liest_fehler: set[str] = frozenset()):
        self.eingang = dict(dateien)
        self.archiv: dict[str, bytes] = {}
        self.ausgang: dict[str, bytes] = {}
        self.liest_fehler = set(liest_fehler)
        self.ablauf: list[str] = []

    def liste_eingang(self, ziel):
        return sorted(self.eingang)

    def lies(self, ziel, name):
        self.ablauf.append(f"lies:{name}")
        if name in self.liest_fehler:
            raise ValueError("kaputtes PDF")
        return self.eingang[name]

    def schreibe_ausgang(self, ziel, name, daten):
        self.ablauf.append(f"schreib:{name}")
        self.ausgang[name] = daten
        return name

    def ins_archiv(self, ziel, name):
        self.ablauf.append(f"archiv:{name}")
        self.archiv[name] = self.eingang.pop(name)
        return name


def als_dateiserver(server: Dateiserver):
    return patch.multiple(
        "app.atr.scan.dateiserver",
        liste_eingang=server.liste_eingang,
        lies=server.lies,
        schreibe_ausgang=server.schreibe_ausgang,
        ins_archiv=server.ins_archiv,
    )


def als_einstellungen(modus: str = "entwurf"):
    zeile = {"modus": modus}
    return patch.object(
        scan_modul, "einstellungen", return_value=(zeile, ziel())
    )


class TestAblauf:
    async def test_jede_datei_wird_gelesen_und_archiviert(self, monkeypatch):
        server = Dateiserver({"a.pdf": b"A", "b.pdf": b"B"})
        angelegt = []

        async def einlesen(daten, name):
            angelegt.append((name, daten))
            return f"id-{name}"

        async def erzeugen(lieferung_id):
            raise AssertionError("im Entwurfsmodus wird nicht erzeugt")

        with als_dateiserver(server), als_einstellungen():
            with patch.object(scan_modul, "_vermerken", return_value=None):
                ergebnis = await scan_modul.durchsehen(einlesen, erzeugen)

        assert ergebnis.gelesen == 2
        assert ergebnis.angelegt == 2
        assert ergebnis.erzeugt == 0
        assert server.eingang == {}
        assert set(server.archiv) == {"a.pdf", "b.pdf"}
        assert [n for n, _ in angelegt] == ["a.pdf", "b.pdf"]

    async def test_archiviert_wird_zuletzt(self):
        """Bricht der Lauf vorher ab, liegt die Datei noch im Eingang und wird
        beim nächsten Mal erneut gelesen. Eine Lieferung doppelt anzulegen ist
        ärgerlich, eine Datei zu verlieren ist schlimmer."""
        server = Dateiserver({"a.pdf": b"A"})

        async def einlesen(daten, name):
            return "id"

        async def erzeugen(lieferung_id):
            return []

        with als_dateiserver(server), als_einstellungen():
            with patch.object(scan_modul, "_vermerken", return_value=None):
                await scan_modul.durchsehen(einlesen, erzeugen)

        assert server.ablauf == ["lies:a.pdf", "archiv:a.pdf"]

    async def test_ein_kaputtes_pdf_blockiert_den_ordner_nicht(self):
        server = Dateiserver(
            {"gut.pdf": b"A", "kaputt.pdf": b"X", "auchgut.pdf": b"B"},
            liest_fehler={"kaputt.pdf"},
        )

        async def einlesen(daten, name):
            return "id"

        async def erzeugen(lieferung_id):
            return []

        with als_dateiserver(server), als_einstellungen():
            with patch.object(scan_modul, "_vermerken", return_value=None):
                ergebnis = await scan_modul.durchsehen(einlesen, erzeugen)

        assert ergebnis.angelegt == 2
        assert ergebnis.liegen_geblieben == ["kaputt.pdf"]
        # Die kaputte bleibt liegen, die anderen sind durch.
        assert set(server.eingang) == {"kaputt.pdf"}
        assert set(server.archiv) == {"gut.pdf", "auchgut.pdf"}

    async def test_im_automatikmodus_gehen_die_dateien_zurueck(self):
        server = Dateiserver({"a.pdf": b"A"})

        async def einlesen(daten, name):
            return "id-1"

        async def erzeugen(lieferung_id):
            return [("704511_ATR.xlsx", b"XLSX"), ("704511_ATR.pdf", b"PDF")]

        async def abgelegt(lieferung_id):
            server.ablauf.append(f"abgelegt:{lieferung_id}")

        with als_dateiserver(server), als_einstellungen("automatisch"):
            with patch.object(scan_modul, "_vermerken", return_value=None):
                with patch.object(scan_modul, "abgelegt_vermerken", abgelegt):
                    ergebnis = await scan_modul.durchsehen(einlesen, erzeugen)

        assert ergebnis.erzeugt == 1
        assert set(server.ausgang) == {"704511_ATR.xlsx", "704511_ATR.pdf"}
        # Wie im Altsystem: geschrieben → `abgelegt` (delivered), erst dann
        # wandert die Quelle ins Archiv.
        assert server.ablauf == [
            "lies:a.pdf",
            "schreib:704511_ATR.xlsx",
            "schreib:704511_ATR.pdf",
            "abgelegt:id-1",
            "archiv:a.pdf",
        ]

    async def test_im_entwurfsmodus_wird_nichts_abgelegt(self):
        server = Dateiserver({"a.pdf": b"A"})

        async def einlesen(daten, name):
            return "id-1"

        async def erzeugen(lieferung_id):
            raise AssertionError("im Entwurfsmodus wird nicht erzeugt")

        async def abgelegt(lieferung_id):
            raise AssertionError("ein Entwurf ist nicht abgelegt")

        with als_dateiserver(server), als_einstellungen("entwurf"):
            with patch.object(scan_modul, "_vermerken", return_value=None):
                with patch.object(scan_modul, "abgelegt_vermerken", abgelegt):
                    ergebnis = await scan_modul.durchsehen(einlesen, erzeugen)

        assert (ergebnis.angelegt, ergebnis.erzeugt) == (1, 0)
        assert server.ausgang == {}

    async def test_ein_wegbrechender_dateiserver_haelt_den_lauf_an(self):
        """Weitere Versuche hätten dasselbe Ergebnis."""
        server = Dateiserver({"a.pdf": b"A", "b.pdf": b"B"})

        def weg(ziel, name):
            raise DateiserverFehler("Verbindung verloren")

        async def einlesen(daten, name):
            return "id"

        async def erzeugen(lieferung_id):
            return []

        with als_dateiserver(server), als_einstellungen():
            with patch("app.atr.scan.dateiserver.lies", weg):
                with patch.object(scan_modul, "_vermerken", return_value=None):
                    ergebnis = await scan_modul.durchsehen(einlesen, erzeugen)

        assert ergebnis.gelesen == 0
        assert ergebnis.liegen_geblieben == ["a.pdf"]  # nach dem ersten Schluss
        assert len(server.eingang) == 2


class TestEinrichtung:
    async def test_ohne_passwort_laeuft_nichts_an(self):
        async def keins():
            return None

        with patch("app.atr.scan.SessionLocal") as sitzung, patch.object(
            scan_modul, "passwort", keins
        ):
            sitzung.return_value.__aenter__.return_value.execute.return_value = _Zeile(
                {
                    "rechner": "srv", "freigabe": "S", "benutzer": "u",
                    "eingang": "in", "archiv": "arch", "ausgang": "out",
                    "domaene": None, "modus": "entwurf",
                }
            )
            with pytest.raises(scan_modul.NichtEingerichtet, match="Passwort des Dienstkontos"):
                await scan_modul.einstellungen()


class _Zeile:
    """Antwort-Attrappe für `execute(...).mappings().first()`."""

    def __init__(self, daten):
        self._daten = daten

    def mappings(self):
        return self

    def first(self):
        return self._daten
