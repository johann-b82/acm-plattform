"""Den Eingangsordner durchsehen.

Ein Lauf liest jedes Lieferschein-PDF im Eingangsordner, macht daraus eine
Lieferung und verschiebt die Quelle ins Archiv. Im Modus `automatisch`
entstehen dabei gleich die Dokumente, und sie wandern in den Ausgangsordner.

**Erst archivieren, wenn es geklappt hat.** Die Reihenfolge ist Absicht:
lesen, in die Datenbank schreiben, dann verschieben. Bricht der Lauf
dazwischen ab, liegt die Datei noch im Eingang und wird beim nächsten Mal
erneut gelesen — eine Lieferung doppelt anzulegen ist ärgerlich, eine Datei
zu verlieren ist schlimmer.

**Ein Fehler nimmt nicht den ganzen Lauf mit.** Ein PDF, das sich nicht lesen
lässt, bleibt liegen und wird gemeldet; die anderen laufen durch. Sonst
blockierte eine kaputte Datei den Ordner, bis jemand sie von Hand entfernt.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

import sqlalchemy as sa
from fastapi.concurrency import run_in_threadpool

from app.atr import dateiserver
from app.atr.dateiserver import DateiserverFehler, Ziel
from app.config import settings
from app.db import SessionLocal, atr_scan

log = logging.getLogger(__name__)


class NichtEingerichtet(RuntimeError):
    """Der Scan ist nicht vollständig konfiguriert."""


@dataclass
class Ergebnis:
    gelesen: int = 0
    angelegt: int = 0
    erzeugt: int = 0
    liegen_geblieben: list[str] = field(default_factory=list)
    hinweise: list[str] = field(default_factory=list)

    def als_text(self) -> str:
        teile = [f"{self.gelesen} gelesen", f"{self.angelegt} angelegt"]
        if self.erzeugt:
            teile.append(f"{self.erzeugt} erzeugt")
        if self.liegen_geblieben:
            teile.append(f"{len(self.liegen_geblieben)} liegen geblieben")
        return ", ".join(teile)


async def einstellungen() -> tuple[dict, Ziel]:
    """Liest die Einstellungen und baut daraus ein Ziel.

    Fehlt ein Stück — auch das Passwort aus der Umgebung —, ist der Scan nicht
    eingerichtet und läuft gar nicht erst an.
    """
    async with SessionLocal() as sitzung:
        zeile = (
            await sitzung.execute(sa.select(atr_scan).where(atr_scan.c.id))
        ).mappings().first()

    if zeile is None:
        raise NichtEingerichtet("Es gibt keine Scan-Einstellungen.")

    fehlt = [
        name
        for name in ("rechner", "freigabe", "benutzer", "eingang", "archiv")
        if not zeile[name]
    ]
    if not settings.ATR_SMB_PASSWORT:
        fehlt.append("ATR_SMB_PASSWORT (Umgebung)")
    if fehlt:
        raise NichtEingerichtet("Es fehlt: " + ", ".join(fehlt) + ".")

    return dict(zeile), Ziel(
        rechner=zeile["rechner"],
        freigabe=zeile["freigabe"],
        domaene=zeile["domaene"],
        benutzer=zeile["benutzer"],
        passwort=settings.ATR_SMB_PASSWORT,
        eingang=zeile["eingang"],
        ausgang=zeile["ausgang"] or "",
        archiv=zeile["archiv"],
    )


async def _vermerken(text: str) -> None:
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await sitzung.execute(
                atr_scan.update()
                .where(atr_scan.c.id)
                .values(zuletzt_am=datetime.now(timezone.utc), zuletzt_text=text)
            )


async def durchsehen(einlesen, erzeugen) -> Ergebnis:
    """Führt einen Lauf durch.

    `einlesen(daten, dateiname)` legt aus einem PDF eine Lieferung an und gibt
    ihre Kennung zurück; `erzeugen(lieferung_id)` erzeugt die Dokumente. Beide
    kommen als Parameter herein, damit dieser Ablauf ohne Datenbank und ohne
    Dateiserver prüfbar bleibt.
    """
    zeile, ziel = await einstellungen()
    ergebnis = Ergebnis()

    dateien = await run_in_threadpool(dateiserver.liste_eingang, ziel)
    for name in dateien:
        try:
            daten = await run_in_threadpool(dateiserver.lies, ziel, name)
            ergebnis.gelesen += 1

            lieferung_id = await einlesen(daten, name)
            ergebnis.angelegt += 1

            if zeile["modus"] == "automatisch" and ziel.ausgang:
                ausgaben = await erzeugen(lieferung_id)
                for dateiname, inhalt in ausgaben:
                    await run_in_threadpool(
                        dateiserver.schreibe_ausgang, ziel, dateiname, inhalt
                    )
                ergebnis.erzeugt += 1

            # Zuletzt: bis hierher ist alles gutgegangen.
            await run_in_threadpool(dateiserver.ins_archiv, ziel, name)
        except DateiserverFehler as fehler:
            # Der Dateiserver ist weg oder das Ziel nicht erlaubt — weitere
            # Versuche haetten dasselbe Ergebnis.
            ergebnis.hinweise.append(str(fehler))
            ergebnis.liegen_geblieben.append(name)
            break
        except Exception as fehler:  # noqa: BLE001
            log.warning("ATR-Scan: %s bleibt liegen (%s)", name, fehler)
            ergebnis.hinweise.append(f"„{name}“: {fehler}")
            ergebnis.liegen_geblieben.append(name)

    await _vermerken(ergebnis.als_text())
    return ergebnis
