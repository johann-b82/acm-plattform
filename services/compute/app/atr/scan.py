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
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app import geheim
from app.atr import dateiserver
from app.atr.dateiserver import DateiserverFehler, Ziel
from app.config import settings
from app.db import SessionLocal, atr_lieferungen, atr_scan, geheimnisse

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

    Fehlt ein Stück — auch das Passwort —, ist der Scan nicht eingerichtet
    und läuft gar nicht erst an.
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
    kennwort = await passwort()
    if not kennwort:
        fehlt.append("Passwort des Dienstkontos")
    if fehlt:
        raise NichtEingerichtet("Es fehlt: " + ", ".join(fehlt) + ".")

    return dict(zeile), Ziel(
        rechner=zeile["rechner"],
        freigabe=zeile["freigabe"],
        domaene=zeile["domaene"],
        benutzer=zeile["benutzer"],
        passwort=kennwort,
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
                # Wie im Altsystem: geschrieben heißt `abgelegt` (delivered) —
                # vor dem Archivieren, das danach noch scheitern darf.
                await abgelegt_vermerken(lieferung_id)
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


async def abgelegt_vermerken(lieferung_id: str) -> None:
    """Setzt den Status auf `abgelegt`.

    Zwei Wege führen hierher: der automatische Scan, der die Dokumente in den
    Ausgangsordner schreibt, und die Ablage von Hand aus der Durchsicht. Beide
    bedeuten dasselbe — die Dateien liegen auf dem Dateiserver.
    """
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await sitzung.execute(
                atr_lieferungen.update()
                .where(atr_lieferungen.c.id == lieferung_id)
                .values(status="abgelegt")
            )


# ---------------------------------------------------------------------------
# Nie zwei Läufe zugleich
# ---------------------------------------------------------------------------
#
# Der Stempel steht in der Datenbank, nicht im Prozess: `compute` darf mehrfach
# laufen, und ein Lauf von Hand darf nicht neben den geplanten geraten. Ein
# Stempel, der älter als eine Stunde ist, gehört zu einem abgestürzten Lauf.


async def belegen() -> bool:
    """Setzt den Laufstempel, wenn keiner steht. Gibt zurück, ob es geklappt hat."""
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            getroffen = await sitzung.execute(
                atr_scan.update()
                .where(
                    atr_scan.c.id,
                    sa.or_(
                        atr_scan.c.lauf_seit.is_(None),
                        atr_scan.c.lauf_seit < sa.literal_column("now() - interval '1 hour'"),
                    ),
                )
                .values(lauf_seit=sa.func.now())
                .returning(atr_scan.c.id)
            )
            return getroffen.first() is not None


async def freigeben() -> None:
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await sitzung.execute(atr_scan.update().where(atr_scan.c.id).values(lauf_seit=None))


# ---------------------------------------------------------------------------
# Das Passwort des Dienstkontos
# ---------------------------------------------------------------------------
#
# Zuerst aus `geheimnisse`, sonst `ATR_SMB_PASSWORT` aus der Umgebung — wie bei
# den Personio-Zugangsdaten. Wo es schon in der `.env` steht, gilt es weiter,
# bis jemand in der Maske eines einträgt. Heraus kommt es nur hier, für die
# Anmeldung am Dateiserver; die Maske erfährt bloß, ob eines dasteht.

PASSWORT = "atr_smb_passwort"


@dataclass(frozen=True)
class PasswortStand:
    gesetzt: bool
    quelle: str | None  # "datenbank" | "umgebung" | None
    geaendert_am: datetime | None = None
    schluessel_bereit: bool = True


async def _abgelegtes_passwort() -> tuple[bytes, datetime] | None:
    async with SessionLocal() as sitzung:
        zeile = (
            await sitzung.execute(
                sa.select(geheimnisse.c.geheimtext, geheimnisse.c.geaendert_am).where(
                    geheimnisse.c.schluessel == PASSWORT
                )
            )
        ).first()
    return (zeile.geheimtext, zeile.geaendert_am) if zeile else None


async def passwort() -> str | None:
    abgelegt = await _abgelegtes_passwort()
    if abgelegt:
        try:
            return geheim.entschluesseln(abgelegt[0])
        except (geheim.KeinSchluessel, geheim.NichtLesbar):
            # Schlüssel weg oder gewechselt: lieber die Umgebung als gar nichts.
            log.warning("ATR-Scan: abgelegtes Passwort nicht lesbar, Umgebung gilt")
    return settings.ATR_SMB_PASSWORT or None


async def passwort_stand() -> PasswortStand:
    abgelegt = await _abgelegtes_passwort()
    if abgelegt:
        return PasswortStand(
            gesetzt=True,
            quelle="datenbank",
            geaendert_am=abgelegt[1],
            schluessel_bereit=geheim.einsatzbereit(),
        )
    aus_umgebung = bool(settings.ATR_SMB_PASSWORT)
    return PasswortStand(
        gesetzt=aus_umgebung,
        quelle="umgebung" if aus_umgebung else None,
        schluessel_bereit=geheim.einsatzbereit(),
    )


async def passwort_setzen(klartext: str, benutzer_id: str | None) -> None:
    jetzt = datetime.now(timezone.utc)
    zeile = {
        "schluessel": PASSWORT,
        "geheimtext": geheim.verschluesseln(klartext),
        "geaendert_am": jetzt,
        "geaendert_von": benutzer_id,
    }
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await sitzung.execute(
                pg_insert(geheimnisse)
                .values(**zeile)
                .on_conflict_do_update(
                    index_elements=[geheimnisse.c.schluessel],
                    set_={k: v for k, v in zeile.items() if k != "schluessel"},
                )
            )
