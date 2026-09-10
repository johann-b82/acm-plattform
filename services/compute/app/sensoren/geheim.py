"""Die SNMP-Community verschlüsselt ablegen.

Anders als beim ATR-Dateiserver, wo ein einziges Passwort in die Umgebung
passt, hat hier jedes Gerät sein eigenes Geheimnis — sie gehören deshalb in die
Zeile. Der Schlüssel dazu steht in der Umgebung von `compute`: ein Abzug der
Datenbank allein gibt die Community nicht her.

Der Schlüssel ist ein Fernet-Schlüssel (32 Byte, url-sicher base64):

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Ohne gesetzten Schlüssel lässt sich kein Sensor anlegen. Das ist Absicht — die
Alternative wäre, das Geheimnis im Klartext abzulegen und es später zu
vergessen.
"""
from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


class KeinSchluessel(RuntimeError):
    """`SENSOR_SCHLUESSEL` fehlt oder taugt nicht."""


class NichtLesbar(RuntimeError):
    """Der Geheimtext passt nicht zum Schlüssel — meist ein Schlüsselwechsel."""


def _fernet() -> Fernet:
    if not settings.SENSOR_SCHLUESSEL:
        raise KeinSchluessel(
            "SENSOR_SCHLUESSEL ist nicht gesetzt — ohne ihn lässt sich keine "
            "Community ablegen."
        )
    try:
        return Fernet(settings.SENSOR_SCHLUESSEL.encode())
    except (ValueError, TypeError) as fehler:
        raise KeinSchluessel(f"SENSOR_SCHLUESSEL ist unbrauchbar: {fehler}") from fehler


def verschluesseln(community: str) -> bytes:
    return _fernet().encrypt(community.encode())


def entschluesseln(geheimtext: bytes) -> str:
    try:
        return _fernet().decrypt(bytes(geheimtext)).decode()
    except InvalidToken as fehler:
        raise NichtLesbar(
            "Die abgelegte Community passt nicht zum SENSOR_SCHLUESSEL."
        ) from fehler
