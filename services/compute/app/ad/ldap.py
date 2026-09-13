"""Passwortprüfung gegen ein lokales AD per LDAPS-Bind (ADR-0004, Weg 3).

Kein SSO: der Nutzer tippt sein AD-Passwort in die Anmeldemaske, `compute`
prüft es mit einem LDAP-Bind und liest E-Mail, Name und Gruppen. Danach
provisioniert `anmeldung.py` einen GoTrue-Nutzer und spiegelt die Gruppen.

Die LDAP-Mechanik steckt hinter dem schmalen Protokoll `AdVerzeichnis`, damit
die Provisionierung ohne echtes AD getestet werden kann. `Ldap3Verzeichnis` ist
die echte Umsetzung mit `ldap3`; die Tests setzen eine Attrappe ein.
"""
from __future__ import annotations

import ssl
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class AdKonfig:
    host: str
    port: int
    basis_dn: str
    upn_suffix: str | None
    dienst_konto_dn: str | None
    dienst_passwort: str | None
    gruppen_basis_dn: str | None
    tls_pruefen: bool


@dataclass(frozen=True)
class AdPerson:
    email: str
    name: str
    #: DNs der AD-Gruppen (memberOf), ggf. auf `gruppen_basis_dn` gefiltert.
    gruppen: tuple[str, ...]
    dn: str


class AdNichtErreichbar(Exception):
    """Der Domain-Controller antwortet nicht oder TLS scheitert."""


class AdVerzeichnis(Protocol):
    def person_lesen(self, benutzer: str, passwort: str) -> AdPerson | None:
        """Gibt die Person zurück, wenn Benutzer+Passwort stimmen; sonst `None`.

        Wirft `AdNichtErreichbar`, wenn der DC nicht antwortet — das ist etwas
        anderes als ein falsches Passwort und darf nicht als „abgelehnt"
        durchgehen."""
        ...


def _gruppen(member_of: list[str], basis: str | None) -> tuple[str, ...]:
    if not basis:
        return tuple(member_of)
    unten = basis.strip().lower()
    return tuple(g for g in member_of if g.strip().lower().endswith(unten))


class Ldap3Verzeichnis:
    """Echte LDAPS-Anbindung mit `ldap3`."""

    def __init__(self, konfig: AdKonfig):
        self.k = konfig

    def _server(self):
        from ldap3 import Server, Tls

        pruefung = ssl.CERT_REQUIRED if self.k.tls_pruefen else ssl.CERT_NONE
        tls = Tls(validate=pruefung)
        return Server(self.k.host, port=self.k.port, use_ssl=True, tls=tls, connect_timeout=8)

    def person_lesen(self, benutzer: str, passwort: str) -> AdPerson | None:
        from ldap3 import Connection, SUBTREE
        from ldap3.core.exceptions import LDAPException

        # Ein leeres Passwort ist bei LDAP ein „unauthenticated bind" und würde
        # fälschlich gelingen — hier hart abweisen.
        if not benutzer or not passwort:
            return None

        server = self._server()
        attribute = ["mail", "userPrincipalName", "displayName", "memberOf", "distinguishedName"]
        try:
            if self.k.dienst_konto_dn:
                # Erst das Dienstkonto: den Nutzer suchen, dann mit seinem
                # Passwort erneut binden — so verrät ein Tippfehler im Namen
                # nichts über die Existenz des Kontos.
                dienst = Connection(
                    server, self.k.dienst_konto_dn, self.k.dienst_passwort or "", auto_bind=True
                )
                filter_ = f"(&(objectClass=user)(|(sAMAccountName={_escape(benutzer)})(userPrincipalName={_escape(benutzer)})))"
                dienst.search(self.k.basis_dn, filter_, search_scope=SUBTREE, attributes=attribute)
                if not dienst.entries:
                    return None
                eintrag = dienst.entries[0]
                nutzer_dn = str(eintrag.entry_dn)
                pruef = Connection(server, nutzer_dn, passwort)
                if not pruef.bind():
                    return None
                pruef.unbind()
                return _aus_eintrag(eintrag, nutzer_dn, self.k.gruppen_basis_dn)

            # Ohne Dienstkonto: direkt als der Nutzer binden.
            upn = benutzer if "@" in benutzer else f"{benutzer}@{self.k.upn_suffix or ''}"
            conn = Connection(server, upn, passwort)
            if not conn.bind():
                return None
            conn.search(
                self.k.basis_dn,
                f"(userPrincipalName={_escape(upn)})",
                search_scope=SUBTREE,
                attributes=attribute,
            )
            if not conn.entries:
                conn.unbind()
                return None
            eintrag = conn.entries[0]
            dn = str(eintrag.entry_dn)
            person = _aus_eintrag(eintrag, dn, self.k.gruppen_basis_dn)
            conn.unbind()
            return person
        except LDAPException as fehler:
            raise AdNichtErreichbar(str(fehler)[:200]) from fehler


def _escape(wert: str) -> str:
    """RFC-4515-Escape für den Suchfilter — kein LDAP-Injection über den Namen."""
    ersatz = {"\\": "\\5c", "*": "\\2a", "(": "\\28", ")": "\\29", "\x00": "\\00"}
    return "".join(ersatz.get(z, z) for z in wert)


def _wert(eintrag, name: str) -> str:
    feld = getattr(eintrag, name, None)
    return str(feld.value) if feld is not None and feld.value else ""


def _aus_eintrag(eintrag, dn: str, gruppen_basis: str | None) -> AdPerson:
    email = _wert(eintrag, "mail") or _wert(eintrag, "userPrincipalName")
    member = getattr(eintrag, "memberOf", None)
    dns = [str(g) for g in member.values] if member is not None and member.value else []
    return AdPerson(
        email=email.lower(),
        name=_wert(eintrag, "displayName") or email,
        gruppen=_gruppen(dns, gruppen_basis),
        dn=dn,
    )
