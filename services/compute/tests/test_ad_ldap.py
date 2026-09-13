"""LDAP-Helfer der AD-Anbindung (ohne echtes Verzeichnis)."""
from __future__ import annotations

from app.ad import anmeldung
from app.ad.ldap import _escape, _gruppen


class TestGruppenFilter:
    def test_ohne_basis_bleiben_alle(self):
        dns = ["CN=A,OU=G,DC=x", "CN=B,OU=H,DC=x"]
        assert _gruppen(dns, None) == tuple(dns)

    def test_mit_basis_nur_darunter(self):
        dns = ["CN=A,OU=Gruppen,DC=firma,DC=local", "CN=B,CN=Builtin,DC=firma,DC=local"]
        gefiltert = _gruppen(dns, "OU=Gruppen,DC=firma,DC=local")
        assert gefiltert == ("CN=A,OU=Gruppen,DC=firma,DC=local",)

    def test_basis_ist_gross_klein_egal(self):
        dns = ["CN=A,ou=gruppen,dc=firma,dc=local"]
        assert _gruppen(dns, "OU=Gruppen,DC=firma,DC=local") == tuple(dns)


class TestGruppenname:
    def test_cn_wird_gelesen(self):
        assert anmeldung._gruppenname("CN=Vertrieb,OU=Gruppen,DC=firma,DC=local") == "Vertrieb"

    def test_ohne_cn_bleibt_der_dn(self):
        assert anmeldung._gruppenname("seltsam") == "seltsam"


class TestEscape:
    def test_klammern_und_stern_werden_maskiert(self):
        # Kein Filter-Ausbruch über den Benutzernamen.
        assert _escape("a*)(uid=*") == "a\\2a\\29\\28uid=\\2a"

    def test_normaler_name_bleibt(self):
        assert _escape("max.mustermann") == "max.mustermann"
