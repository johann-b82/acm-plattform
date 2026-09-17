"""Wohin ein fertiger ATR auf dem Dateiserver gehört.

Drei Ziele wie im Altprojekt (`backend/app/routers/atr_delivery.py`,
`_server_targets`). Die Ordner selbst stehen in den Einstellungen (`atr_scan`,
Migration `0058_atr_ablageziele`) und sind dort mit den Pfaden des Altprojekts
vorbelegt; hier steht nur, welche Datei in welches Ziel gehört.

Nur das Mappen-Ziel ist programmabhängig — A350 und A380 haben eigene
Unterordner **und** eigene Jahresordner, deshalb zwei Einstellungen. Die beiden
PDF-Ziele tragen keine Programmkennung und gelten für beide.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class ServerZiel:
    """Ein Ablageort: welche Datei, wohin, und wie er im Bericht heißt."""

    art: str
    """`mappe` oder `pdf` — welches der erzeugten Dokumente hier hingehört."""

    vorlage: str
    """Pfad unterhalb der Freigabe, mit `{jahr}` und `{kw}` als Platzhaltern."""

    bezeichnung: str
    """Was die Oberfläche nennt, wenn dieses Ziel scheitert."""


def ist_a380(programm: str | None) -> bool:
    """Wie im Altprojekt: entscheidend ist die Ziffernfolge, nicht die Schreibweise.

    Die Quelle schreibt mal „A380", mal „A 380", mal mit Zusatz. Auf `380`
    zu prüfen deckt alle Fälle ab — und `A350` enthält es nicht.
    """
    return "380" in (programm or "")


def ziele(programm: str | None, einstellung: dict) -> list[ServerZiel]:
    """Die Ablageorte für eine Lieferung dieses Programms.

    `einstellung` ist die Zeile aus `atr_scan`.
    """
    prog = "A380" if ist_a380(programm) else "A350"
    return [
        ServerZiel(
            art="mappe",
            vorlage=einstellung[f"ziel_mappe_{prog.lower()}"],
            bezeichnung=f"QS – Acceptance Test Report ({prog})",
        ),
        ServerZiel(
            art="pdf",
            vorlage=einstellung["ziel_logistik"],
            bezeichnung="Logistik – Versand",
        ),
        ServerZiel(
            art="pdf",
            vorlage=einstellung["ziel_weight_report"],
            bezeichnung="QS – Weight Report (verschicken)",
        ),
    ]


def pfad(ziel: ServerZiel, tag: date) -> str:
    """Setzt Jahr und Kalenderwoche ein.

    Ersetzt wird wörtlich statt mit `str.format`: ein Pfad aus der Maske ist
    kein Formatstring, und andere Klammern weist die Datenbank ohnehin ab.

    Die Kalenderwoche ist **zweistellig** (`KW 07`), wie die Ordner auf dem
    Server heißen. Und es ist die ISO-Woche: der Januar kann in die Woche 52
    des Vorjahres fallen — dann steht der Ordner unter dem Jahr, das der
    Kalender nennt, nicht unter dem der ISO-Woche. So macht es das Altprojekt,
    und die Ordner dort sind entsprechend abgelegt.
    """
    return ziel.vorlage.replace("{jahr}", str(tag.year)).replace(
        "{kw}", f"{tag.isocalendar()[1]:02d}"
    )
