"""Signierte Anzeigen für die Bildschirme.

Die Tafeln im Haus zeigen Geburtstage der Woche und die Neuzugänge. Sie haben
keine Sitzung: ein Bildschirm meldet sich nicht an.

**Befund 4 aus der Sicherheitsanalyse.** Im Altprojekt sind das schlicht
sitzungslose Routen — wer die Adresse kennt, liest die Namen der Belegschaft,
und der Foto-Weg ließ sich über die laufende Nummer durchzählen. Die dortige
Doku nennt die richtige Lösung selbst: ein signierter Token je Playlist-Eintrag,
„der in der neuen Plattform liegt". Hier ist er.

Der Token ist kurz und trägt, was er sagt: Art der Anzeige und Ablaufdatum,
mit HMAC unterschrieben. Wer ihn hat, sieht genau eine Anzeige und nur solange
sie gilt. Und was hinausgeht, ist so wenig wie möglich: Name, Abteilung und
Wochentag — **kein Geburtsdatum, kein Alter**. Das Foto antwortet nur für
Personen, die gerade auf dieser Tafel stehen.
"""
from __future__ import annotations

import base64
import hmac
import json
import time
from dataclasses import dataclass
from hashlib import sha256

from app.config import settings


class TokenUngueltig(RuntimeError):
    """Der Token fehlt, ist verfälscht oder abgelaufen."""


@dataclass(frozen=True)
class Anzeige:
    art: str
    gueltig_bis: int


def _sig(rumpf: bytes) -> str:
    unterschrift = hmac.new(settings.EMBED_SECRET.encode(), rumpf, sha256).digest()
    return base64.urlsafe_b64encode(unterschrift).decode().rstrip("=")


def baue_token(art: str, gueltig_tage: int = 365) -> str:
    """Einen Token für eine Anzeige erzeugen.

    Er läuft ab. Ein Playlist-Eintrag, den niemand mehr pflegt, hört damit von
    selbst auf zu zeigen — statt jahrelang weiterzulaufen.
    """
    if not settings.EMBED_SECRET:
        raise TokenUngueltig("EMBED_SECRET ist nicht gesetzt — Anzeigen sind aus.")
    rumpf = json.dumps(
        {"art": art, "bis": int(time.time()) + gueltig_tage * 86400},
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return f"{base64.urlsafe_b64encode(rumpf).decode().rstrip('=')}.{_sig(rumpf)}"


def pruefe_token(token: str, erwartete_art: str) -> Anzeige:
    """Den Token prüfen — Unterschrift, Ablauf und Art."""
    if not settings.EMBED_SECRET:
        raise TokenUngueltig("EMBED_SECRET ist nicht gesetzt — Anzeigen sind aus.")
    try:
        teil, unterschrift = token.split(".", 1)
        rumpf = base64.urlsafe_b64decode(teil + "=" * (-len(teil) % 4))
    except (ValueError, AttributeError) as fehler:
        raise TokenUngueltig("Der Token ist unlesbar.") from fehler

    # `compare_digest`, nicht `==`: der Vergleich soll nicht verraten, wie weit
    # ein Versuch gekommen ist.
    if not hmac.compare_digest(unterschrift, _sig(rumpf)):
        raise TokenUngueltig("Der Token passt nicht zur Unterschrift.")

    try:
        daten = json.loads(rumpf)
        anzeige = Anzeige(art=str(daten["art"]), gueltig_bis=int(daten["bis"]))
    except (ValueError, KeyError, TypeError) as fehler:
        raise TokenUngueltig("Der Token ist unvollständig.") from fehler

    if anzeige.gueltig_bis < time.time():
        raise TokenUngueltig("Der Token ist abgelaufen.")
    if anzeige.art != erwartete_art:
        raise TokenUngueltig("Dieser Token gilt für eine andere Anzeige.")
    return anzeige
