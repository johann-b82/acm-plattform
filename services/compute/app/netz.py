"""Wohin sich der Dienst überhaupt verbinden darf.

Befund 16 im Altprojekt: ein Admin trägt in einer Maske einen Rechner ein, und
der Dienst verbindet sich dorthin — beim Dateiserver mit der Anmeldung des
Dienstkontos, beim Sensor mit der SNMP-Community. Beides ist ein Weg, den
Dienst gegen ein beliebiges Ziel im Netz laufen zu lassen und ihm dabei ein
Geheimnis vorzuhalten.

Der Betreiber gibt deshalb je Zweck eine Liste vor. Ein Eintrag ist entweder
ein Rechnername (genau so, ohne Rücksicht auf Groß- und Kleinschreibung) oder
ein Netz in CIDR-Schreibweise. Bei einem Netz wird der Name aufgelöst und
**jede** Adresse geprüft: ein Name, der auf zwei Adressen zeigt, darf nicht
über die eine hinein- und über die andere hinauskommen.
"""
from __future__ import annotations

import ipaddress
import socket


class ZielNichtErlaubt(RuntimeError):
    """Das eingetragene Ziel steht nicht in der Allowlist."""


def erlaubte(roh: str) -> list[str]:
    """Zerlegt eine kommagetrennte Liste aus der Umgebung."""
    return [teil.strip() for teil in roh.split(",") if teil.strip()]


def pruefe_ziel(rechner: str, freigegeben: list[str], *, port: int, name: str) -> None:
    """Lässt nur durch, was der Betreiber freigegeben hat.

    `name` ist der Name der Umgebungsvariablen — er steht in der Meldung, damit
    der Betreiber weiß, wo er nachsehen muss.
    """
    if not freigegeben:
        raise ZielNichtErlaubt(f"{name} ist nicht gesetzt — es ist kein Ziel freigegeben.")

    namen = {eintrag.lower() for eintrag in freigegeben if "/" not in eintrag}
    if rechner.lower() in namen:
        return

    netze = [
        ipaddress.ip_network(eintrag, strict=False)
        for eintrag in freigegeben
        if "/" in eintrag
    ]
    if not netze:
        raise ZielNichtErlaubt(f'„{rechner}“ steht nicht in {name}.')

    try:
        adressen = {
            ipaddress.ip_address(eintrag[4][0])
            for eintrag in socket.getaddrinfo(rechner, port)
        }
    except OSError as fehler:
        raise ZielNichtErlaubt(f'„{rechner}“ ließ sich nicht auflösen: {fehler}') from fehler

    if not adressen:
        raise ZielNichtErlaubt(f'„{rechner}“ löst auf keine Adresse auf.')
    for adresse in adressen:
        if not any(adresse in netz for netz in netze):
            raise ZielNichtErlaubt(
                f'„{rechner}“ zeigt auf {adresse} — das liegt in keinem '
                "freigegebenen Netz."
            )
