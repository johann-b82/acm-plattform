"""Die Dateien nachholen — Zeilen allein genügen nicht.

Der Motor kopiert Zeilen. Die Dateien liegen woanders, und zwar an zwei
verschiedenen Orten:

* **In der alten Datenbank selbst**, als `bytea`: die erzeugten ATR-Mappen,
  ihre PDFs und Etiketten (129 Lieferungen), die beiden Gerüstdateien der
  Vorlagen und die zehn Feedback-Screenshots. Die stecken im Abzug und lassen
  sich ohne Netz übernehmen.
* **In Directus**, als Datei auf der Platte des alten Servers: die siebzehn
  FAIR-Zeichnungen. Die müssen erst herüberkopiert werden; dieser Lauf nimmt
  ein Verzeichnis entgegen und sucht darin nach der alten Dateikennung.

Abgelegt wird über die Storage-API mit dem Dienstschlüssel, unter genau den
Pfaden, die die Zeilen schon nennen oder die der neue Stack selbst vergeben
würde — sonst zeigt die Oberfläche auf ein Bild, das anderswo liegt.

Wiederholbar: `x-upsert` ersetzt eine vorhandene Datei, und die Pfade sind
gerechnet, nicht gewürfelt.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import httpx
import sqlalchemy as sa

from app.config import settings
from app.db import SessionLocal
from app.uebernahme.motor import neue_id

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class AblageFehler(RuntimeError):
    """Die Storage-API hat abgelehnt."""


@dataclass
class Bericht:
    atr_mappen: int = 0
    atr_pdfs: int = 0
    atr_etiketten: int = 0
    geruestdateien: int = 0
    screenshots: int = 0
    zeichnungen: int = 0
    fehlend: list[str] = field(default_factory=list)

    def zeilen(self) -> list[str]:
        z = [
            f"ATR-Mappen: {self.atr_mappen}",
            f"ATR-PDFs: {self.atr_pdfs}",
            f"ATR-Etiketten: {self.atr_etiketten}",
            f"Gerüstdateien: {self.geruestdateien}",
            f"Feedback-Bilder: {self.screenshots}",
            f"FAIR-Zeichnungen: {self.zeichnungen}",
        ]
        if self.fehlend:
            z.append(f"Ohne Datei geblieben: {len(self.fehlend)}")
            z += [f"   {e}" for e in self.fehlend[:10]]
            if len(self.fehlend) > 10:
                z.append(f"   … und {len(self.fehlend) - 10} weitere")
        return z


async def _ablegen(eimer: str, pfad: str, daten: bytes, typ: str) -> None:
    ziel = f"{settings.STORAGE_URL}/object/{eimer}/{pfad}"
    async with httpx.AsyncClient(timeout=120) as klient:
        antwort = await klient.post(
            ziel,
            content=daten,
            headers={
                "apikey": settings.SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {settings.SERVICE_ROLE_KEY}",
                "Content-Type": typ,
                "x-upsert": "true",
            },
        )
    if antwort.status_code >= 400:
        raise AblageFehler(f"{eimer}/{pfad}: {antwort.status_code} {antwort.text[:160]}")


async def _setze(tabelle: str, kennung, spalten: dict[str, str]) -> None:
    """Den Pfad in die Zeile schreiben — ohne die Trigger zu wecken.

    `atr_lieferungen` führt einen Trigger, der bei jeder Änderung
    `geaendert_am` neu setzt. Hier wäre das falsch: nachgereichte Dateien sind
    keine Änderung an der Lieferung, und die Maske läse hinterher „erzeugt,
    aber danach geändert" — eine Warnung über einen Vorgang, den es nie gab.
    """
    satz = ", ".join(f"{s} = :{s}" for s in spalten)
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await sitzung.execute(sa.text("set local session_replication_role = replica"))
            await sitzung.execute(
                sa.text(f"update public.{tabelle} set {satz} where id = :id"),
                {**spalten, "id": kennung},
            )


async def _atr_lieferungen(quelle: sa.engine.Engine, bericht: Bericht) -> None:
    """Mappe, PDF und Etikett je Lieferung — unter denselben Pfaden, die der
    Dienst vergeben würde, wenn er sie neu erzeugte."""
    with quelle.connect() as verbindung:
        zeilen = verbindung.execute(
            sa.text(
                "select id, atr_xlsx, atr_pdf, label_docx, updated_at, output_written_at"
                " from public.atr_delivery"
                " where atr_xlsx is not null or atr_pdf is not null"
                " or label_docx is not null order by id"
            )
        ).mappings()
        for zeile in zeilen:
            kennung = neue_id("atr_delivery", zeile["id"])
            stamm = f"erzeugt/{kennung}"
            neu: dict[str, str] = {}
            if zeile["atr_xlsx"]:
                await _ablegen("atr", f"{stamm}/atr.xlsx", bytes(zeile["atr_xlsx"]), XLSX)
                neu["mappe_pfad"] = f"{stamm}/atr.xlsx"
                bericht.atr_mappen += 1
            if zeile["atr_pdf"]:
                await _ablegen(
                    "atr", f"{stamm}/atr.pdf", bytes(zeile["atr_pdf"]), "application/pdf"
                )
                neu["pdf_pfad"] = f"{stamm}/atr.pdf"
                bericht.atr_pdfs += 1
            if zeile["label_docx"]:
                await _ablegen(
                    "atr", f"{stamm}/etikett.docx", bytes(zeile["label_docx"]), DOCX
                )
                neu["etikett_pfad"] = f"{stamm}/etikett.docx"
                bericht.atr_etiketten += 1
            if neu:
                # Ohne `erzeugt_am` hält die Maske die Dokumente für nicht
                # vorhanden und lässt sie nicht herunterladen. Das Altsystem
                # führt `output_written_at` nicht; dann ist der Zeitpunkt der
                # letzten Änderung der ehrlichste Wert, den es gibt — und er
                # hält die Frage „nach der Änderung erzeugt?" beantwortbar.
                neu["erzeugt_am"] = zeile["output_written_at"] or zeile["updated_at"]
                await _setze("atr_lieferungen", kennung, neu)


async def _atr_vorlagen(quelle: sa.engine.Engine, bericht: Bericht) -> None:
    """Das Gerüst je Vorlage. Ohne es lässt sich keine Mappe mehr erzeugen —
    `atr.py` legt es unter demselben Pfad ab."""
    with quelle.connect() as verbindung:
        zeilen = verbindung.execute(
            sa.text(
                "select structure_filename, structure_xlsx from public.atr_template"
                " where structure_xlsx is not null"
            )
        ).mappings().all()

    async with SessionLocal() as sitzung:
        vorhandene = (
            await sitzung.execute(sa.text("select programm from public.atr_vorlagen"))
        ).scalars().all()

    for zeile in zeilen:
        name = (zeile["structure_filename"] or "").upper()
        treffer = next((p for p in vorhandene if p and p.upper() in name), None)
        if treffer is None:
            bericht.fehlend.append(f"Gerüst ohne Vorlage: {zeile['structure_filename']}")
            continue
        pfad = f"uebernahme/{treffer}/geruest.xlsx"
        await _ablegen("atr", pfad, bytes(zeile["structure_xlsx"]), XLSX)
        async with SessionLocal() as sitzung:
            async with sitzung.begin():
                await sitzung.execute(
                    sa.text(
                        "update public.atr_vorlagen set geruest_pfad = :p,"
                        " geruest_dateiname = coalesce(geruest_dateiname, :n)"
                        " where programm = :prog"
                    ),
                    {"p": pfad, "n": zeile["structure_filename"], "prog": treffer},
                )
        bericht.geruestdateien += 1


async def _feedback(quelle: sa.engine.Engine, bericht: Bericht) -> None:
    """Die Screenshots. Der Schlüssel wandert unverändert mit, der Pfad kann
    deshalb aus ihm entstehen."""
    with quelle.connect() as verbindung:
        zeilen = verbindung.execute(
            sa.text(
                "select id, screenshot_data, screenshot_mime from public.page_feedback"
                " where screenshot_data is not null"
            )
        ).mappings()
        for zeile in zeilen:
            typ = zeile["screenshot_mime"] or "image/png"
            endung = "jpg" if "jpeg" in typ else typ.rsplit("/", 1)[-1]
            pfad = f"uebernahme/{zeile['id']}.{endung}"
            await _ablegen("feedback", pfad, bytes(zeile["screenshot_data"]), typ)
            await _setze("feedback", str(zeile["id"]), {"bild_pfad": pfad})
            bericht.screenshots += 1


async def _fair(verzeichnis: Path, bericht: Bericht) -> None:
    """Die Zeichnungen aus Directus. Der Pfad steht schon in der Zeile — der
    Umzug hat ihn aus der alten Dateikennung gerechnet; hier werden die Bytes
    dorthin gelegt.

    Directus legt seine Dateien als `<kennung>.<endung>` ab; gesucht wird
    deshalb nach dem Anfang des Namens."""
    async with SessionLocal() as sitzung:
        zeilen = (
            await sitzung.execute(
                sa.text("select id, pfad, mime, name from public.fair_zeichnungen")
            )
        ).mappings().all()

    dateien = {d.name.split(".")[0]: d for d in verzeichnis.iterdir() if d.is_file()}
    for zeile in zeilen:
        kennung = (zeile["pfad"] or "").rsplit("/", 1)[-1]
        datei = dateien.get(kennung)
        if datei is None:
            bericht.fehlend.append(f"FAIR ohne Datei: {zeile['name']} ({kennung})")
            continue
        await _ablegen(
            "fair", zeile["pfad"], datei.read_bytes(), zeile["mime"] or "application/pdf"
        )
        bericht.zeichnungen += 1


async def uebernehmen(
    quelle: sa.engine.Engine, verzeichnis: Path | None = None
) -> Bericht:
    bericht = Bericht()
    await _atr_vorlagen(quelle, bericht)
    await _atr_lieferungen(quelle, bericht)
    await _feedback(quelle, bericht)
    if verzeichnis is not None:
        await _fair(verzeichnis, bericht)
    return bericht
