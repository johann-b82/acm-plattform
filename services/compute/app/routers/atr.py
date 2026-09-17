"""ATR: Referenzmappe einlesen.

Der Teil, der in Python bleiben muss. Die Referenzmappe ist ein ausgefülltes
ATR-Formular in Excel; Kopfdaten stehen in festen Zellen, die Teile ab Zeile 14
zwischen Abschnittsüberschriften. Das lässt sich weder in SQL noch über
PostgREST lesen.

Alles danach ist gewöhnliches Lesen und Schreiben und geht direkt über
PostgREST — auch das Pflegen einzelner Teile.

    POST /api/atr/referenz       Mappe einlesen und in den Katalog übernehmen
    POST /api/atr/lieferschein   Lieferschein einlesen, abgleichen, als Entwurf ablegen
    POST /api/atr/lieferungen/{id}/erzeugen   Mappe, PDF und Etikett erzeugen
    POST /api/atr/lieferungen/{id}/ablegen    Mappe und PDF in die festen Ordner auf dem Dateiserver
    GET  /api/atr/naechste-nummer  Vorschlag für die laufende ATR-Nummer
    POST /api/atr/container-etikett   Containernummer zuweisen, Beschriftung holen
    POST /api/atr/scan/probe     Verbindung zum Dateiserver pruefen
    POST /api/atr/scan           Eingangsordner von Hand durchsehen
    POST /api/atr/scan/geplant   derselbe Lauf aus pg_cron, gemeinsames Geheimnis
    GET  /api/atr/scan/passwort  ob ein Passwort hinterlegt ist (Plattform-Verwaltung)
    PUT  /api/atr/scan/passwort  Passwort eintragen oder ersetzen (Plattform-Verwaltung)
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone
from urllib.parse import quote

import logging
import sqlalchemy as sa
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Response, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app import geheim
from app.auth import Claims, require_app
from app.config import settings
from app.db import (
    SessionLocal,
    atr_lieferungen,
    atr_positionen,
    atr_teile,
    atr_vorlagen,
)
from app.parsing.atr_lieferschein import (
    Lieferschein,
    Position,
    TextNichtLesbar,
    lies_pdf,
)
from app.atr import dateiserver, nummer as nummer_modul, scan as scan_modul, ziele as ziele_modul
from app.atr.dateiserver import DateiserverFehler
from app.atr.excel import VorlageUnbrauchbar, baue_atr
from app.atr.format import dateiname_basis, programmfamilie
from app.atr.etikett import baue_container_etikett, baue_etikett
from app.dokumente.pdf import PdfFehlgeschlagen, nach_pdf
from app.atr.speicher import SpeicherFehler, ablegen
from app.parsing.atr_referenz import MappeUnbrauchbar, lies_referenzmappe

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/atr",
    tags=["atr"],
    dependencies=[Depends(require_app("atr", "editor"))],
)


class ImportErgebnis(BaseModel):
    dateiname: str
    programm: str | None
    teile_gelesen: int
    teile_neu: int
    teile_aktualisiert: int
    vorlage_uebernommen: bool
    hinweise: list[str]


async def _lies_begrenzt(datei: UploadFile) -> bytes:
    """Liest den Upload und bricht ab, sobald das Limit überschritten ist."""
    stuecke: list[bytes] = []
    gesamt = 0
    while stueck := await datei.read(64 * 1024):
        gesamt += len(stueck)
        if gesamt > settings.MAX_UPLOAD_BYTES:
            raise HTTPException(
                413,
                f"Datei überschreitet {settings.MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
            )
        stuecke.append(stueck)
    return b"".join(stuecke)


@router.post("/referenz", response_model=ImportErgebnis)
async def referenz_einlesen(datei: UploadFile) -> ImportErgebnis:
    """Liest eine ATR-Referenzmappe und übernimmt Teile und Kopfdaten.

    Der Schlüssel ist die normierte Teilenummer. Ein Teil, das es schon gibt,
    wird aktualisiert statt verdoppelt — eine neuere Mappe soll die ältere
    korrigieren dürfen, ohne dass jemand vorher aufräumt.
    """
    daten = await _lies_begrenzt(datei)
    # openpyxl ist blockierend; ohne Thread stünde währenddessen der ganze
    # Prozess. Dieselbe Überlegung wie bei den ERP-Uploads.
    try:
        mappe = await run_in_threadpool(lies_referenzmappe, daten)
    except MappeUnbrauchbar as fehler:
        raise HTTPException(422, str(fehler)) from fehler

    jetzt = datetime.now(timezone.utc)
    # Die Mappe schreibt „A350 XWB", der Lieferschein „A350". Als Schlüssel
    # dient die Familie, sonst fände eine Lieferung ihre Vorlage nie.
    programm = programmfamilie(mappe.kopf.get("programm"))
    hinweise = list(mappe.hinweise)

    zeilen = [
        {
            "teilenummer": t.teilenummer,
            "lieferantennummer": t.lieferantennummer,
            "bezeichnung": t.bezeichnung,
            "zeichnung": t.zeichnung,
            "gewicht_kg": t.gewicht_kg,
            "menge": t.menge,
            "kategorie": t.kategorie,
            "herkunft": datei.filename or "unbekannt",
            "erstellt_am": jetzt,
            "geaendert_am": jetzt,
        }
        for t in mappe.teile
    ]

    neu = 0
    aktualisiert = 0
    vorlage = False

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            if zeilen:
                vorher = set(
                    (
                        await sitzung.execute(
                            sa.select(atr_teile.c.teilenummer_norm)
                        )
                    ).scalars()
                )
                anweisung = pg_insert(atr_teile).values(zeilen)
                # `teilenummer_norm` ist erzeugt und steht deshalb nicht in den
                # Werten; der Index darauf ist trotzdem das Ziel des Konflikts.
                anweisung = anweisung.on_conflict_do_update(
                    index_elements=[atr_teile.c.teilenummer_norm],
                    index_where=atr_teile.c.teilenummer_norm.isnot(None),
                    set_={
                        spalte: anweisung.excluded[spalte]
                        for spalte in (
                            "teilenummer",
                            "lieferantennummer",
                            "bezeichnung",
                            "zeichnung",
                            "gewicht_kg",
                            "menge",
                            "kategorie",
                            "herkunft",
                            "geaendert_am",
                        )
                    },
                )
                await sitzung.execute(anweisung)

                nachher = set(
                    (
                        await sitzung.execute(
                            sa.select(atr_teile.c.teilenummer_norm)
                        )
                    ).scalars()
                )
                neu = len(nachher - vorher)
                aktualisiert = len(zeilen) - neu

            if programm:
                kopf = {
                    feld: wert
                    for feld, wert in mappe.kopf.items()
                    if feld != "programm"
                }
                vorlagen_zeile = {
                    "programm": programm,
                    **kopf,
                    "geaendert_am": jetzt,
                }
                anweisung = pg_insert(atr_vorlagen).values(vorlagen_zeile)
                # Die Gerüstdatei bleibt, wo sie ist: sie wird getrennt
                # hochgeladen und hat mit den Kopfdaten der Mappe nichts zu tun.
                await sitzung.execute(
                    anweisung.on_conflict_do_update(
                        index_elements=[atr_vorlagen.c.programm],
                        set_={
                            spalte: anweisung.excluded[spalte]
                            for spalte in (*kopf, "geaendert_am")
                        },
                    )
                )
                vorlage = True
            else:
                hinweise.append(
                    "Kein Programm in Zelle D2 — die Vorlage wurde nicht angelegt."
                )

    return ImportErgebnis(
        dateiname=datei.filename or "unbekannt",
        programm=programm,
        teile_gelesen=len(zeilen),
        teile_neu=neu,
        teile_aktualisiert=aktualisiert,
        vorlage_uebernommen=vorlage,
        hinweise=hinweise,
    )


class LieferscheinErgebnis(BaseModel):
    lieferung_id: str
    dateiname: str
    lieferschein_nr: str | None
    programm: str | None
    programm_grund: str
    positionen: int
    zugeordnet: int
    hinweise: list[str]


def _datum(deutsch: str | None) -> date | None:
    if not deutsch:
        return None
    try:
        tag, monat, jahr = deutsch.split(".")
        return date(int(jahr), int(monat), int(tag))
    except (ValueError, AttributeError):
        return None


def _programm_und_grund(schein: Lieferschein) -> tuple[str | None, str, str | None]:
    """Programm, Begründung und Satztitel aus der ersten Position.

    Die Begründung steht mit in der Zeile, damit später nachvollziehbar ist,
    warum ein ATR unter A350 oder A380 läuft — im Altprojekt ist das ein
    stiller Zweig, und wer die Ausgabe prüft, sieht nur das Ergebnis.
    """
    kopf: Position | None = schein.positionen[0] if schein.positionen else None
    programm = kopf.programm if kopf else None
    bereich = kopf.bereich if kopf else None
    bett = kopf.bettvariante if kopf else None
    titel = f"SET {bett} BED {bereich}" if bett and bereich else None

    if programm == "A380":
        return programm, "A380 aus den Bestelldaten erkannt.", titel or "SET MSN UAE"
    if programm == "A350":
        return programm, "A350 aus den Bestelldaten erkannt.", titel
    return (
        None,
        "Kein A350- oder A380-Merkmal im Lieferschein — Programm bitte prüfen.",
        titel,
    )


@router.post("/lieferschein", response_model=LieferscheinErgebnis)
async def lieferschein_einlesen(datei: UploadFile) -> LieferscheinErgebnis:
    """Liest einen hochgeladenen Lieferschein."""
    daten = await _lies_begrenzt(datei)
    return await _lieferung_aus_pdf(daten, datei.filename or "unbekannt")


async def _lieferung_aus_pdf(daten: bytes, dateiname: str) -> LieferscheinErgebnis:
    """Liest einen Lieferschein, gleicht gegen den Katalog ab und legt einen
    Entwurf an.

    Was der Katalog liefert, wird in die Position **kopiert**, nicht verlinkt.
    Der Katalog ändert sich; ein freigegebener ATR nicht.

    Zwei Wege kommen hier zusammen: der Upload aus der Oberfläche und der
    Scan des Eingangsordners. Beide sollen dieselbe Lieferung ergeben.
    """
    try:
        schein = await lies_pdf(daten)
    except TextNichtLesbar as fehler:
        raise HTTPException(422, str(fehler)) from fehler

    programm, grund, titel = _programm_und_grund(schein)
    kopf: Position | None = schein.positionen[0] if schein.positionen else None
    jetzt = datetime.now(timezone.utc)

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            nummern = [
                p.teilenummer for p in schein.positionen if p.teilenummer
            ]
            katalog: dict[str, dict] = {}
            if nummern:
                treffer = await sitzung.execute(
                    sa.select(
                        atr_teile.c.id,
                        atr_teile.c.teilenummer_norm,
                        atr_teile.c.bezeichnung,
                        atr_teile.c.zeichnung,
                        atr_teile.c.kategorie,
                        atr_teile.c.gewicht_kg,
                    ).where(
                        atr_teile.c.teilenummer_norm.in_(
                            sa.select(
                                sa.func.public.atr_teilenummer_norm(
                                    sa.func.unnest(sa.literal(nummern, sa.ARRAY(sa.Text)))
                                )
                            )
                        )
                    )
                )
                katalog = {
                    zeile.teilenummer_norm: dict(zeile._mapping)
                    for zeile in treffer
                    if zeile.teilenummer_norm
                }

            lieferung = (
                await sitzung.execute(
                    atr_lieferungen.insert()
                    .values(
                        quelle_dateiname=dateiname,
                        lieferschein_nr=schein.lieferschein_nr,
                        datum=_datum(schein.datum),
                        ba_auftrag=kopf.ba_auftrag if kopf else None,
                        bestellnummer=kopf.bestellnummer if kopf else None,
                        programm=programm,
                        programm_grund=grund,
                        bereich=kopf.bereich if kopf else None,
                        msn=kopf.msn if kopf else None,
                        bettvariante=kopf.bettvariante if kopf else None,
                        satz_titel=titel,
                        status="entwurf",
                        hinweise=schein.hinweise,
                        erstellt_am=jetzt,
                        geaendert_am=jetzt,
                    )
                    .returning(atr_lieferungen.c.id)
                )
            ).scalar_one()

            zugeordnet = 0
            zeilen = []
            for reihe, p in enumerate(schein.positionen, start=1):
                norm = "".join(c for c in (p.teilenummer or "") if c.isdigit())
                teil = katalog.get(norm)
                if teil:
                    zugeordnet += 1
                zeilen.append(
                    {
                        "lieferung_id": lieferung,
                        "reihenfolge": reihe,
                        "pos": p.pos,
                        "lieferantennummer": p.lieferantennummer,
                        "teilenummer": p.teilenummer,
                        "teil_id": teil["id"] if teil else None,
                        # Aus dem Katalog kopiert, wo es ihn gibt; sonst das,
                        # was auf dem Lieferschein stand.
                        "bezeichnung": (teil or {}).get("bezeichnung") or p.bezeichnung,
                        "zeichnung": (teil or {}).get("zeichnung"),
                        "kategorie": (teil or {}).get("kategorie"),
                        "menge": p.menge,
                        "gewicht_kg": (teil or {}).get("gewicht_kg"),
                        "bestellposition": p.bestellposition,
                        "seriennummern": p.seriennummern,
                        "erstellt_am": jetzt,
                        "geaendert_am": jetzt,
                    }
                )
            if zeilen:
                await sitzung.execute(atr_positionen.insert(), zeilen)

    return LieferscheinErgebnis(
        lieferung_id=str(lieferung),
        dateiname=dateiname,
        lieferschein_nr=schein.lieferschein_nr,
        programm=programm,
        programm_grund=grund,
        positionen=len(schein.positionen),
        zugeordnet=zugeordnet,
        hinweise=schein.hinweise,
    )



class ErzeugtErgebnis(BaseModel):
    mappe_pfad: str
    pdf_pfad: str | None
    etikett_pfad: str
    pdf_hinweis: str | None


class NaechsteNummer(BaseModel):
    nummer: str | None


@router.get("/naechste-nummer", response_model=NaechsteNummer)
async def naechste_nummer(programm: str | None = None) -> NaechsteNummer:
    """Die höchste vergebene Nummer dieser Programmfamilie plus eins.

    Nur ein Vorschlag für die Maske; vergeben wird beim Erzeugen. `null` heißt:
    es gibt noch keine numerische Nummer, die erste setzt jemand von Hand.
    """
    return NaechsteNummer(nummer=await nummer_modul.naechste(programm))


@router.post("/lieferungen/{lieferung_id}/erzeugen", response_model=ErzeugtErgebnis)
async def erzeugen(lieferung_id: str = Path(...)) -> ErzeugtErgebnis:
    ergebnis, _ = await _erzeuge(lieferung_id)
    return ergebnis


class AbgelegtesZiel(BaseModel):
    bezeichnung: str
    pfad: str
    dateiname: str


class GescheitertesZiel(BaseModel):
    bezeichnung: str
    fehler: str


class AblageErgebnis(BaseModel):
    abgelegt: list[AbgelegtesZiel]
    gescheitert: list[GescheitertesZiel]


@router.post("/lieferungen/{lieferung_id}/ablegen", response_model=AblageErgebnis)
async def auf_server_ablegen(lieferung_id: str = Path(...)) -> AblageErgebnis:
    """Legt Mappe und PDF in den festen Ordnern auf dem Dateiserver ab.

    Bis hierher landeten die Dokumente nur im Eimer, und auf den Dateiserver
    kamen sie ausschließlich über den automatischen Scan. Eine von Hand
    durchgesehene Lieferung erreichte den Server damit nie — im Altprojekt tat
    das der Knopf „Auf Server speichern", und den gibt es jetzt wieder.

    **Jedes Ziel wird einzeln versucht.** Scheitert eines, laufen die übrigen
    weiter und die Antwort nennt das gescheiterte beim Namen. Alles oder nichts
    wäre hier falsch: die drei Ordner gehören verschiedenen Abteilungen, und
    ein gesperrter Ordner in der Logistik ist kein Grund, der QS ihr Dokument
    vorzuenthalten.

    Den Status auf `abgelegt` zieht erst der **vollständige** Lauf. Eine
    Lieferung, von der ein Ziel fehlt, ist nicht ausgeliefert, und der Status
    soll nicht mehr behaupten, als auf dem Server liegt.
    """
    async with SessionLocal() as sitzung:
        lieferung = (
            await sitzung.execute(
                sa.select(atr_lieferungen).where(atr_lieferungen.c.id == lieferung_id)
            )
        ).mappings().first()
        positionen = [
            dict(z)
            for z in (
                await sitzung.execute(
                    sa.select(atr_positionen)
                    .where(atr_positionen.c.lieferung_id == lieferung_id)
                    .order_by(atr_positionen.c.reihenfolge)
                )
            ).mappings()
        ]
    if lieferung is None:
        raise HTTPException(404, "Lieferung nicht gefunden.")
    if not lieferung["mappe_pfad"] or not lieferung["pdf_pfad"]:
        # Wie im Altprojekt: ohne beide Dokumente gibt es nichts abzulegen.
        # Das PDF darf beim Erzeugen fehlschlagen, ohne den Rest mitzunehmen —
        # dann steht es hier, und die Meldung sagt, was zu tun ist.
        raise HTTPException(
            400, "Erst die Dokumente erzeugen — Mappe und PDF müssen vorliegen."
        )

    try:
        # Nur der Zugang — Eingang und Archiv braucht der Scan, nicht die Ablage.
        einstellung, ziel = await scan_modul.zugang()
    except scan_modul.NichtEingerichtet as fehler:
        raise HTTPException(503, str(fehler)) from fehler

    # Derselbe Name wie im Altprojekt — QS und Logistik suchen danach.
    stamm = dateiname_basis(dict(lieferung), positionen)
    inhalt = {
        "mappe": (f"{stamm}.xlsx", await _hole_datei(lieferung["mappe_pfad"])),
        "pdf": (f"{stamm}.pdf", await _hole_datei(lieferung["pdf_pfad"])),
    }

    heute = date.today()
    abgelegt: list[AbgelegtesZiel] = []
    gescheitert: list[GescheitertesZiel] = []
    for serverziel in ziele_modul.ziele(lieferung["programm"], einstellung):
        name, daten = inhalt[serverziel.art]
        pfad = ziele_modul.pfad(serverziel, heute)
        try:
            geschrieben = await run_in_threadpool(
                dateiserver.schreibe, ziel, pfad, name, daten
            )
            abgelegt.append(
                AbgelegtesZiel(
                    bezeichnung=serverziel.bezeichnung,
                    pfad=pfad,
                    dateiname=geschrieben,
                )
            )
        except DateiserverFehler as fehler:
            log.warning(
                "ATR-Ablage gescheitert [%s] für Lieferung %s: %s",
                serverziel.bezeichnung,
                lieferung_id,
                fehler,
            )
            gescheitert.append(
                GescheitertesZiel(bezeichnung=serverziel.bezeichnung, fehler=str(fehler))
            )

    if not gescheitert:
        await scan_modul.abgelegt_vermerken(lieferung_id)
    return AblageErgebnis(abgelegt=abgelegt, gescheitert=gescheitert)


async def _erzeuge(lieferung_id: str) -> tuple[ErzeugtErgebnis, list[tuple[str, bytes]]]:
    """Erzeugt Mappe, PDF und Etikett und legt sie im Eimer `atr` ab.

    Die Mappe entsteht aus dem Gerüst der Vorlage des Programms. Fehlt das
    Gerüst, gibt es nichts zu füllen — dann bricht der Vorgang ab, statt eine
    Mappe ohne Rahmen zu erzeugen.

    Das PDF ist der einzige Schritt, der scheitern darf, ohne den Rest
    mitzunehmen: LibreOffice ist ein fremder Prozess. Mappe und Etikett stehen
    dann trotzdem, und der Hinweis sagt, was fehlt.
    """
    async with SessionLocal() as sitzung:
        lieferung = (
            await sitzung.execute(
                sa.select(atr_lieferungen).where(atr_lieferungen.c.id == lieferung_id)
            )
        ).mappings().first()
        if lieferung is None:
            raise HTTPException(404, "Lieferung nicht gefunden.")

        positionen = [
            dict(z)
            for z in (
                await sitzung.execute(
                    sa.select(atr_positionen)
                    .where(atr_positionen.c.lieferung_id == lieferung_id)
                    .order_by(atr_positionen.c.reihenfolge)
                )
            ).mappings()
        ]
        if not positionen:
            raise HTTPException(422, "Die Lieferung hat keine Positionen.")

        vorlage = (
            await sitzung.execute(
                sa.select(atr_vorlagen).where(
                    atr_vorlagen.c.programm
                    == (programmfamilie(lieferung["programm"]) or "")
                )
            )
        ).mappings().first()

    if vorlage is None or not vorlage["geruest_pfad"]:
        raise HTTPException(
            422,
            f"Für das Programm {lieferung['programm'] or '—'} ist keine "
            "Gerüstdatei hinterlegt.",
        )

    gerüst = await _hole_geruest(vorlage["geruest_pfad"])

    daten = dict(lieferung)
    # Wie im Altprojekt (`generate_and_deliver`): ist das Feld leer, bekommt die
    # Lieferung jetzt die nächste laufende Nummer. Eine von Hand eingetragene
    # gewinnt immer. Auch der unbeaufsichtigte Scan geht hier durch — er hat
    # keine Maske, in der jemand eine Nummer setzen könnte.
    if not (daten.get("atr_nummer") or "").strip():
        daten["atr_nummer"] = await nummer_modul.naechste(daten.get("programm"))
    try:
        mappe = await run_in_threadpool(baue_atr, gerüst, daten, positionen)
    except VorlageUnbrauchbar as fehler:
        raise HTTPException(422, str(fehler)) from fehler
    etikett = await run_in_threadpool(baue_etikett, daten, positionen)

    stamm = f"erzeugt/{lieferung_id}"
    mappe_pfad = await ablegen(
        f"{stamm}/atr.xlsx",
        mappe,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    etikett_pfad = await ablegen(
        f"{stamm}/etikett.docx",
        etikett,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

    pdf_pfad: str | None = None
    hinweis: str | None = None
    try:
        pdf = await nach_pdf(mappe, name="atr")
        pdf_pfad = await ablegen(f"{stamm}/atr.pdf", pdf, "application/pdf")
    except (PdfFehlgeschlagen, SpeicherFehler) as fehler:
        hinweis = f"Das PDF ist nicht entstanden: {fehler}"

    jetzt = datetime.now(timezone.utc)
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await sitzung.execute(
                atr_lieferungen.update()
                .where(atr_lieferungen.c.id == lieferung_id)
                .values(
                    atr_nummer=daten["atr_nummer"],
                    mappe_pfad=mappe_pfad,
                    pdf_pfad=pdf_pfad,
                    etikett_pfad=etikett_pfad,
                    erzeugt_am=jetzt,
                    # Wie im Altsystem: jede Erzeugung heißt `generated`, auch
                    # eine erneute nach dem Ablegen.
                    status="erzeugt",
                )
            )

    # Die Bytes kommen mit zurueck: der Scan legt sie zusaetzlich in den
    # Ausgangsordner auf dem Dateiserver.
    # Die Namen des Altprojekts (`generate_and_deliver`): das Etikett trägt
    # `_Container`, Mappe und PDF nur die Endung.
    stamm_name = dateiname_basis(daten, positionen)
    dateien: list[tuple[str, bytes]] = [
        (f"{stamm_name}.xlsx", mappe),
        (f"{stamm_name}_Container.docx", etikett),
    ]
    if pdf_pfad is not None:
        dateien.insert(1, (f"{stamm_name}.pdf", pdf))

    return (
        ErzeugtErgebnis(
            mappe_pfad=mappe_pfad,
            pdf_pfad=pdf_pfad,
            etikett_pfad=etikett_pfad,
            pdf_hinweis=hinweis,
        ),
        dateien,
    )


async def _hole_datei(pfad: str, was: str = "Die Datei") -> bytes:
    """Holt eine Datei mit dem Service-Schlüssel aus dem Eimer."""
    import httpx

    from app.atr.speicher import EIMER, _kopfzeilen

    async with httpx.AsyncClient(timeout=60) as klient:
        antwort = await klient.get(
            f"{settings.STORAGE_URL}/object/{EIMER}/{pfad}",
            headers=_kopfzeilen(),
        )
    if antwort.status_code >= 400:
        raise HTTPException(
            502, f"{was} ließ sich nicht laden ({antwort.status_code})."
        )
    return antwort.content


async def _hole_geruest(pfad: str) -> bytes:
    """Holt die Gerüstdatei mit dem Service-Schlüssel aus dem Eimer."""
    return await _hole_datei(pfad, "Die Gerüstdatei")


DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_UNZULAESSIG = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


class ContainerAuftrag(BaseModel):
    containernummer: str
    lieferungen: list[str]


async def container_etikett_bauen(nummer: str, lieferungen: list[str]) -> tuple[str, bytes]:
    """Weist den ausgewählten Lieferungen die Containernummer zu und baut das
    Etikett des ganzen Containers.

    Wie im Altsystem (`/api/atr/deliveries/container-label`): auf dem Etikett
    steht alles, was diesem Container zugeordnet ist — auch eine Lieferung,
    die schon vorher darin lag. Zuweisen und Lesen in einem Schreibvorgang;
    ist eine der ausgewählten Lieferungen nicht da, bleibt alles, wie es war.
    """
    nr = (nummer or "").strip()
    if not nr or len(nr) > 40:
        raise HTTPException(422, "Bitte eine Containernummer mit höchstens 40 Zeichen angeben.")
    try:
        kennungen = {uuid.UUID(k) for k in lieferungen}
    except ValueError as fehler:
        raise HTTPException(422, "Unbekannte Kennung einer Lieferung.") from fehler
    if not kennungen:
        raise HTTPException(422, "Keine Lieferung ausgewählt.")

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            getroffen = (
                await sitzung.execute(
                    atr_lieferungen.update()
                    .where(atr_lieferungen.c.id.in_(kennungen))
                    .values(containernummer=nr)
                    .returning(atr_lieferungen.c.id)
                )
            ).scalars().all()
            if set(getroffen) != kennungen:
                raise HTTPException(404, "Lieferung nicht gefunden.")

            im_container = [
                dict(z)
                for z in (
                    await sitzung.execute(
                        sa.select(atr_lieferungen)
                        .where(atr_lieferungen.c.containernummer == nr)
                        .order_by(atr_lieferungen.c.erstellt_am, atr_lieferungen.c.id)
                    )
                ).mappings()
            ]
            positionen: dict = {z["id"]: [] for z in im_container}
            for p in (
                await sitzung.execute(
                    sa.select(atr_positionen)
                    .where(atr_positionen.c.lieferung_id.in_(list(positionen)))
                    .order_by(atr_positionen.c.reihenfolge)
                )
            ).mappings():
                positionen[p["lieferung_id"]].append(dict(p))

    daten = await run_in_threadpool(
        baue_container_etikett, nr, [(z, positionen[z["id"]]) for z in im_container]
    )
    name = f"Container_{_UNZULAESSIG.sub('', nr) or 'ATR'}.docx"
    return name, daten


@router.post("/container-etikett")
async def container_etikett(auftrag: ContainerAuftrag) -> Response:
    name, daten = await container_etikett_bauen(auftrag.containernummer, auftrag.lieferungen)
    einfach = name.encode("ascii", "replace").decode()
    return Response(
        content=daten,
        media_type=DOCX,
        headers={
            "Content-Disposition": f'attachment; filename="{einfach}"; '
            f"filename*=UTF-8''{quote(name)}"
        },
    )


class ScanErgebnis(BaseModel):
    gelesen: int
    angelegt: int
    erzeugt: int
    liegen_geblieben: list[str]
    hinweise: list[str]


class ProbeErgebnis(BaseModel):
    erreichbar: bool
    dateien: int | None = None
    meldung: str | None = None


@router.post("/scan/probe", response_model=ProbeErgebnis)
async def scan_probe() -> ProbeErgebnis:
    """Prüft die Verbindung, ohne etwas zu verändern."""
    try:
        _, ziel = await scan_modul.einstellungen()
    except scan_modul.NichtEingerichtet as fehler:
        return ProbeErgebnis(erreichbar=False, meldung=str(fehler))

    def _probe() -> tuple[bool, str | None, int | None]:
        gut, meldung = dateiserver.probe(ziel)
        if not gut:
            return False, meldung, None
        return True, None, len(dateiserver.liste_eingang(ziel))

    gut, meldung, anzahl = await run_in_threadpool(_probe)
    return ProbeErgebnis(erreichbar=gut, dateien=anzahl, meldung=meldung)


async def _lauf() -> ScanErgebnis:
    """Ein Durchgang. Die beiden Arbeitsschritte kommen als Funktionen herein,
    damit der Ablauf selbst ohne Datenbank prüfbar bleibt."""

    async def einlesen(daten: bytes, name: str) -> str:
        return (await _lieferung_aus_pdf(daten, name)).lieferung_id

    async def erzeugen(lieferung_id: str) -> list[tuple[str, bytes]]:
        _, dateien = await _erzeuge(lieferung_id)
        return dateien

    # Nie zwei Läufe zugleich — sonst läsen beide dieselbe Datei und legten
    # die Lieferung doppelt an.
    if not await scan_modul.belegen():
        raise HTTPException(409, "Der Eingangsordner wird gerade durchgesehen.")
    try:
        ergebnis = await scan_modul.durchsehen(einlesen, erzeugen)
    except scan_modul.NichtEingerichtet as fehler:
        raise HTTPException(503, str(fehler)) from fehler
    except DateiserverFehler as fehler:
        raise HTTPException(502, str(fehler)) from fehler
    finally:
        await scan_modul.freigeben()

    return ScanErgebnis(
        gelesen=ergebnis.gelesen,
        angelegt=ergebnis.angelegt,
        erzeugt=ergebnis.erzeugt,
        liegen_geblieben=ergebnis.liegen_geblieben,
        hinweise=ergebnis.hinweise,
    )


@router.post("/scan", response_model=ScanErgebnis)
async def scan_von_hand() -> ScanErgebnis:
    return await _lauf()


# Der geplante Lauf haengt nicht am Router-Gate: ein SQL-Job hat kein
# Nutzer-Token und koennte keins erzeugen, ohne den JWT-Schluessel in der
# Datenbank zu haben. Er weist sich mit einem gemeinsamen Geheimnis aus —
# dasselbe Verfahren wie beim naechtlichen Personio-Abgleich.
geplant = APIRouter(prefix="/api/atr", tags=["atr"])


@geplant.post("/scan/geplant", response_model=ScanErgebnis, include_in_schema=False)
async def scan_geplant(
    x_atr_scan_token: str = Header(default=""),
) -> ScanErgebnis:
    if not settings.ATR_SCAN_TOKEN:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not hmac.compare_digest(x_atr_scan_token, settings.ATR_SCAN_TOKEN):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    return await _lauf()


# Das Passwort des Dienstkontos. Nicht am Router-Gate oben: wohin und womit
# sich `compute` am Dateiserver anmeldet, bestimmt die Plattform-Verwaltung,
# nicht wer ATR bearbeitet. Heraus kommt nur, ob eines dasteht.
verwaltung = APIRouter(
    prefix="/api/atr",
    tags=["atr"],
    dependencies=[Depends(require_app("platform", "admin"))],
)


class PasswortStand(BaseModel):
    gesetzt: bool
    quelle: str | None
    geaendert_am: str | None = None
    schluessel_bereit: bool


class PasswortEingabe(BaseModel):
    # Leer heißt in der Maske „beibehalten“ — und wird deshalb gar nicht erst
    # geschickt. Kommt es doch, wird nichts überschrieben.
    passwort: str = Field(min_length=1, max_length=500)


async def _passwort_stand() -> PasswortStand:
    stand = await scan_modul.passwort_stand()
    return PasswortStand(
        gesetzt=stand.gesetzt,
        quelle=stand.quelle,
        geaendert_am=stand.geaendert_am.isoformat() if stand.geaendert_am else None,
        schluessel_bereit=stand.schluessel_bereit,
    )


@verwaltung.get("/scan/passwort", response_model=PasswortStand)
async def passwort_stand() -> PasswortStand:
    return await _passwort_stand()


@verwaltung.put("/scan/passwort", response_model=PasswortStand)
async def passwort_setzen(
    eingabe: PasswortEingabe, claims: Claims = Depends(require_app("platform", "admin"))
) -> PasswortStand:
    try:
        await scan_modul.passwort_setzen(eingabe.passwort, claims.sub)
    except geheim.KeinSchluessel as fehler:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(fehler)) from fehler
    return await _passwort_stand()
