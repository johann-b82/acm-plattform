"""Wohin ein fertiger ATR auf dem Dateiserver gehört.

Drei feste Ziele, wörtlich aus dem Altprojekt übernommen
(`backend/app/routers/atr_delivery.py`, `_server_targets`). Sie stehen im
Code und nicht in den Einstellungen, weil sie es dort auch standen: es sind
die Ordner, in denen QS und Logistik ihre Unterlagen suchen, und ein Tippfehler
in einer Maske legte ein ATR still an einen Ort, an dem niemand nachsieht.

Nur das Mappen-Ziel ist programmabhängig — A350 und A380 haben eigene
Unterordner **und** eigene Jahresordner. Die beiden PDF-Ziele tragen keine
Programmkennung und gelten für beide.

Ein weiteres Ziel ist ein weiterer Eintrag in der Liste, sonst nichts.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

#: Der Jahresordner des A380 trägt ein Leerzeichen hinter dem „A" und fünf
#: Punkte vor der Jahreszahl. Das ist kein Vertipper hier, sondern der Name
#: des Ordners auf dem Server; er stand so schon im Altprojekt.
_JAHRESORDNER = {
    "A380": "ACM_ATR_A 380_.....{jahr}",
    "A350": "ACM_ATR_A350_.....{jahr}",
}

_QS_DIEHL = (
    "1300 - Qualität\\1320_QS\\132002_WA-Prüfung\\132002_02_TR_Spec_QAA\\DIEHL"
)


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


def ziele(programm: str | None) -> list[ServerZiel]:
    """Die Ablageorte für eine Lieferung dieses Programms."""
    prog = "A380" if ist_a380(programm) else "A350"
    return [
        ServerZiel(
            art="mappe",
            vorlage=(
                f"{_QS_DIEHL}\\{prog}\\ATR_Acceptance Test Report"
                f"\\{_JAHRESORDNER[prog]}"
            ),
            bezeichnung=f"QS – Acceptance Test Report ({prog})",
        ),
        ServerZiel(
            art="pdf",
            vorlage="1200 - Logistik\\Versand\\ATR`S_Weight Reports_Firma Diehl_Portal",
            bezeichnung="Logistik – Versand",
        ),
        ServerZiel(
            art="pdf",
            vorlage=(
                f"{_QS_DIEHL}\\Weight Report für Firma Diehl ( verschicken )"
                "\\{jahr}\\KW {kw}"
            ),
            bezeichnung="QS – Weight Report (verschicken)",
        ),
    ]


def pfad(ziel: ServerZiel, tag: date) -> str:
    """Setzt Jahr und Kalenderwoche ein.

    Die Kalenderwoche ist **zweistellig** (`KW 07`), wie die Ordner auf dem
    Server heißen. Und es ist die ISO-Woche: der Januar kann in die Woche 52
    des Vorjahres fallen — dann steht der Ordner unter dem Jahr, das der
    Kalender nennt, nicht unter dem der ISO-Woche. So macht es das Altprojekt,
    und die Ordner dort sind entsprechend abgelegt.
    """
    return ziel.vorlage.format(jahr=tag.year, kw=f"{tag.isocalendar()[1]:02d}")
