"""Geheimnisse verschlüsselt in der Datenbank ablegen.

Manches Geheimnis passt nicht in die Umgebung: die SNMP-Community, weil jedes
Gerät seine eigene hat, und die Personio-Zugangsdaten, weil sie jemand über die
Oberfläche eintragen können soll, ohne an den Server zu kommen. Beides gehört
deshalb in eine Zeile — verschlüsselt, mit einem Schlüssel, der woanders
liegt: in der Umgebung von `compute`. Ein Abzug der Datenbank allein gibt
nichts her.

Der Schlüssel ist ein Fernet-Schlüssel (32 Byte, url-sicher base64):

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

`GEHEIM_SCHLUESSEL` ist der Name. `SENSOR_SCHLUESSEL` gilt weiter, solange er
gesetzt ist: unter dem Namen steht er in laufenden Umgebungen, und ein
Namenswechsel, der beim Ausrollen die Sensoren stumm schaltet, wäre ein
schlechter Tausch für ein hübscheres Wort.

Ohne gesetzten Schlüssel lässt sich nichts ablegen. Das ist Absicht — die
Alternative wäre, das Geheimnis im Klartext zu speichern und es später zu
vergessen.
"""
from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


class KeinSchluessel(RuntimeError):
    """Weder `GEHEIM_SCHLUESSEL` noch `SENSOR_SCHLUESSEL` taugt."""


class NichtLesbar(RuntimeError):
    """Der Geheimtext passt nicht zum Schlüssel — meist ein Schlüsselwechsel."""


def _schluessel() -> str:
    """Der neue Name zuerst, der alte als Rückfall."""
    return settings.GEHEIM_SCHLUESSEL or settings.SENSOR_SCHLUESSEL


def _fernet() -> Fernet:
    roh = _schluessel()
    if not roh:
        raise KeinSchluessel(
            "GEHEIM_SCHLUESSEL ist nicht gesetzt — ohne ihn lässt sich nichts "
            "verschlüsselt ablegen."
        )
    try:
        return Fernet(roh.encode())
    except (ValueError, TypeError) as fehler:
        raise KeinSchluessel(f"GEHEIM_SCHLUESSEL ist unbrauchbar: {fehler}") from fehler


def einsatzbereit() -> bool:
    """Ob überhaupt ein brauchbarer Schlüssel dasteht — für Masken, die das
    sagen wollen, bevor jemand etwas eintippt."""
    try:
        _fernet()
        return True
    except KeinSchluessel:
        return False


def verschluesseln(klartext: str) -> bytes:
    return _fernet().encrypt(klartext.encode())


def entschluesseln(geheimtext: bytes) -> str:
    try:
        return _fernet().decrypt(bytes(geheimtext)).decode()
    except InvalidToken as fehler:
        raise NichtLesbar(
            "Der abgelegte Geheimtext passt nicht zum GEHEIM_SCHLUESSEL."
        ) from fehler
