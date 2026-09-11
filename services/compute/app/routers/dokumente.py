"""Der Dokumentenlauf: Blätter erzeugen, weiterschalten, Scans prüfen.

Das Anlegen und der Scan brauchen Python — QR erzeugen, PDF setzen, Bilder
rechnen. Das Lesen der Vorgangsliste nicht; das geht über PostgREST.

    POST /api/dokumente/vorgang            Blatt erzeugen (mit QR)
    POST /api/dokumente/{id}/weiter        eine Station vorrücken
    POST /api/dokumente/{id}/scan          Scan hochladen und prüfen
    POST /api/dokumente/{id}/nachweis      Zertifikat anhängen
    GET  /api/dokumente/{id}/blatt.pdf     das erzeugte Blatt
    GET  /api/dokumente/{id}/scan          der hochgeladene Scan

Warum der Scan hier durchläuft und nicht direkt in den Eimer: er wird beim
Hochladen geprüft, und dafür braucht es das Blanko-Blatt daneben. Ein Upload
aus dem Browser hätte das nicht.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

import sqlalchemy as sa
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Path,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel

from app.auth import require_app
from app.config import settings
from app.db import (
    SessionLocal,
    dokument_nachweise,
    dokumentvorgaenge,
    externe_personen,
    onboarding_abteilung,
    personio_employees,
)
from app.dokumente import pruefung, speicher, vorgang
from app.dokumente.logo import lade_logo
from app.dokumente.pdf import PdfFehlgeschlagen
from app.routers.einarbeitung import _inhalte

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/dokumente",
    tags=["dokumente"],
    # Ein Vorgang entsteht, wandert und wird beurteilt — das ist Pflege,
    # keine Ansicht.
    dependencies=[Depends(require_app("hr", "editor"))],
)


class VorgangAnlegen(BaseModel):
    art: str
    employee_id: int | None = None
    extern_id: str | None = None
    #: Nur nötig, wenn weder Personio noch eine externe Person gemeint ist.
    name: str | None = None
    funktion: str | None = None
    beginn: date | None = None
    #: Zusätzliche Abteilungen für den Einarbeitungsteil.
    abteilungen: list[str] | None = None


class VorgangRead(BaseModel):
    id: str
    art: str
    doc_uid: str
    name: str
    funktion: str | None
    status: str
    erstellt_am: datetime
    uebergeben_am: datetime | None
    zurueck_am: datetime | None
    geprueft_am: datetime | None
    vollstaendig: bool | None
    kommentar: str | None
    pruef_ergebnis: dict | None


def _read(zeile) -> VorgangRead:
    return VorgangRead(
        id=str(zeile["id"]),
        art=zeile["art"],
        doc_uid=zeile["doc_uid"],
        name=zeile["name"],
        funktion=zeile["funktion"],
        status=zeile["status"],
        erstellt_am=zeile["erstellt_am"],
        uebergeben_am=zeile["uebergeben_am"],
        zurueck_am=zeile["zurueck_am"],
        geprueft_am=zeile["geprueft_am"],
        vollstaendig=zeile["vollstaendig"],
        kommentar=zeile["kommentar"],
        pruef_ergebnis=zeile["pruef_ergebnis"],
    )


async def _laden(vorgang_id: str):
    async with SessionLocal() as sitzung:
        zeile = (
            await sitzung.execute(
                sa.select(dokumentvorgaenge).where(dokumentvorgaenge.c.id == vorgang_id)
            )
        ).mappings().one_or_none()
    if zeile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diesen Vorgang gibt es nicht.")
    return zeile


async def _person(eingabe: VorgangAnlegen) -> tuple[str, str | None, date | None, str | None]:
    """Name, Funktion, Beginn und Abteilung — als Abschrift für den Vorgang."""
    if eingabe.employee_id is not None:
        async with SessionLocal() as sitzung:
            zeile = (
                await sitzung.execute(
                    sa.select(
                        personio_employees.c.first_name,
                        personio_employees.c.last_name,
                        personio_employees.c.department,
                        personio_employees.c.hire_date,
                        personio_employees.c.raw_json,
                        onboarding_abteilung.c.abteilung.label("uebersteuert"),
                    ).select_from(
                        personio_employees.outerjoin(
                            onboarding_abteilung,
                            onboarding_abteilung.c.employee_id == personio_employees.c.id,
                        )
                    ).where(personio_employees.c.id == eingabe.employee_id)
                )
            ).mappings().one_or_none()
        if zeile is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Diese Person gibt es nicht.")
        roh = zeile["raw_json"] or {}
        stelle = ((roh.get("attributes") or {}).get("position") or {}).get("value")
        return (
            f"{zeile['first_name'] or ''} {zeile['last_name'] or ''}".strip(),
            eingabe.funktion or (stelle if isinstance(stelle, str) else None),
            eingabe.beginn or zeile["hire_date"],
            zeile["uebersteuert"] or zeile["department"],
        )

    if eingabe.extern_id is not None:
        async with SessionLocal() as sitzung:
            zeile = (
                await sitzung.execute(
                    sa.select(externe_personen).where(
                        externe_personen.c.id == eingabe.extern_id
                    )
                )
            ).mappings().one_or_none()
        if zeile is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Diese Person gibt es nicht.")
        return (
            zeile["name"],
            eingabe.funktion or zeile["position"],
            eingabe.beginn or zeile["eintritt"],
            zeile["abteilung"],
        )

    if not (eingabe.name or "").strip():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Ohne Person oder Namen lässt sich kein Blatt anlegen.",
        )
    return eingabe.name.strip(), eingabe.funktion, eingabe.beginn, None


async def _inhalt_bauen(art: str, employee_id: int | None, abteilung: str | None,
                        zusatz: list[str] | None) -> list[dict]:
    """Was auf dem Blatt steht — als Abschrift, nicht als Verweis."""
    if art == "einarbeitung":
        gewaehlt = [a.strip() for a in (zusatz or []) if a and a.strip()]
        if not gewaehlt and abteilung:
            gewaehlt = [abteilung]
        return [
            {"abteilung": i.abteilung, "ansprechpartner": i.ansprechpartner, "inhalt": i.inhalt}
            for i in await _inhalte(gewaehlt)
        ]

    if employee_id is None:
        # Ohne Personio-Kennung gibt es keinen Plan. Das Blatt kommt leer, mit
        # Tabellenkopf — ein leeres Formular ist brauchbar, ein erfundenes nicht.
        return []
    async with SessionLocal() as sitzung:
        zeilen = (
            await sitzung.execute(
                sa.text(
                    "select p.bereich, p.name, k.verantwortlicher"
                    " from public.schulungsplan(:i) p"
                    " join public.schulung_katalog k on k.id = p.schulung_id"
                    " where p.quelle <> 'kuerzel_fehlt'"
                    " order by p.bereich, p.name"
                ),
                {"i": employee_id},
            )
        ).mappings().all()
    gesehen: set[str] = set()
    inhalt: list[dict] = []
    for zeile in zeilen:
        text = f"{zeile['bereich']}: {zeile['name']}" if zeile["bereich"] else zeile["name"]
        if text in gesehen:
            continue
        gesehen.add(text)
        inhalt.append({"bezeichnung": text, "anbieter": zeile["verantwortlicher"] or ""})
    return inhalt


@router.post("/vorgang", response_model=VorgangRead, status_code=status.HTTP_201_CREATED)
async def anlegen(eingabe: VorgangAnlegen) -> VorgangRead:
    """Ein Blatt erzeugen und den Vorgang eröffnen.

    Das erzeugte PDF trägt den QR-Code; die Rechtecke seiner Pflichtfelder
    wandern als `feld_layout` in die Zeile. Ohne beides ließe sich ein später
    eingescannter Bogen weder zuordnen noch prüfen.
    """
    if eingabe.art not in vorgang.ARTEN:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unbekannte Art.")

    name, funktion, beginn, abteilung = await _person(eingabe)
    inhalt = await _inhalt_bauen(eingabe.art, eingabe.employee_id, abteilung, eingabe.abteilungen)
    doc_uid = vorgang.neue_kennung()

    try:
        pdf, layout = await vorgang.blatt_bauen(
            eingabe.art, doc_uid,
            name=name, funktion=funktion, beginn=beginn,
            inhalt=inhalt, logo=await lade_logo(),
        )
    except PdfFehlgeschlagen as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler

    try:
        pfad = await vorgang.blatt_ablegen(doc_uid, pdf)
    except speicher.SpeicherFehler as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            zeile = (
                await sitzung.execute(
                    dokumentvorgaenge.insert().values(
                        art=eingabe.art,
                        doc_uid=doc_uid,
                        employee_id=eingabe.employee_id,
                        extern_id=eingabe.extern_id,
                        name=name,
                        funktion=funktion,
                        beginn=beginn,
                        inhalt=inhalt,
                        pdf_pfad=pfad,
                        feld_layout=layout,
                        status="erstellt",
                        erstellt_am=datetime.now(timezone.utc),
                    ).returning(dokumentvorgaenge)
                )
            ).mappings().one()
    return _read(zeile)


class Weiter(BaseModel):
    ziel: str


@router.post("/{vorgang_id}/weiter", response_model=VorgangRead)
async def weiter(vorgang_id: str = Path(...), eingabe: Weiter = ...) -> VorgangRead:
    """Eine Station vorrücken — genau eine, nicht zwei, nicht zurück."""
    zeile = await _laden(vorgang_id)
    if not vorgang.darf_weiter(zeile["status"], eingabe.ziel):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Von ‚{zeile['status']}‘ führt kein Weg direkt nach ‚{eingabe.ziel}‘.",
        )
    spalte = vorgang.STEMPEL[eingabe.ziel]
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            neu = (
                await sitzung.execute(
                    dokumentvorgaenge.update()
                    .where(dokumentvorgaenge.c.id == vorgang_id)
                    # Nur, wenn der Stand noch derselbe ist: zwei gleichzeitige
                    # Klicks sollen nicht zwei Stationen weiterschalten.
                    .where(dokumentvorgaenge.c.status == zeile["status"])
                    .values(**{"status": eingabe.ziel, spalte: datetime.now(timezone.utc)})
                    .returning(dokumentvorgaenge)
                )
            ).mappings().one_or_none()
    if neu is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Der Stand hat sich inzwischen geändert.")
    return _read(neu)


@router.post("/{vorgang_id}/scan", response_model=VorgangRead)
async def scan(
    vorgang_id: str = Path(...),
    datei: UploadFile = File(...),
) -> VorgangRead:
    """Den ausgefüllten Bogen hochladen und nachsehen, ob er vollständig ist.

    Geprüft wird, **ob** in einem Feld etwas steht, nicht was. Deshalb ist das
    Urteil hinterher von Hand überstimmbar.
    """
    zeile = await _laden(vorgang_id)
    if not zeile["feld_layout"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Zu diesem Vorgang gibt es keine Feldliste — er stammt aus einer älteren Fassung.",
        )

    daten = await datei.read(settings.MAX_UPLOAD_BYTES + 1)
    if len(daten) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Die Datei ist zu groß.")
    if not daten:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Die Datei ist leer.")

    endung = vorgang.endung_aus(datei.filename or "", datei.content_type)
    typ = vorgang.mime_aus(datei.filename or "", datei.content_type)
    if typ is None or endung not in {"pdf", "png", "jpg"}:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Ein Scan muss ein PDF, PNG oder JPEG sein.",
        )
    try:
        bild = await pruefung.rastern(daten, ist_pdf=endung == "pdf")
    except pruefung.ScanFehlgeschlagen as fehler:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(fehler)) from fehler

    # Das Blanko daneben: seine Rahmen und Linien sind selbst Tinte und werden
    # feldweise abgezogen.
    blanko = None
    if zeile["pdf_pfad"]:
        try:
            blanko = await pruefung.rastern(await speicher.holen(zeile["pdf_pfad"]), ist_pdf=True)
        except (speicher.SpeicherFehler, pruefung.ScanFehlgeschlagen):
            log.warning("Scan-Prüfung ohne Blanko-Vergleich: das Blatt fehlt im Speicher")

    ergebnis = pruefung.felder_pruefen(bild, zeile["feld_layout"], blanko)
    if ergebnis["qr_ok"] and ergebnis["doc_uid"] != zeile["doc_uid"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Der QR auf dem Scan gehört zu einem anderen Vorgang ({ergebnis['doc_uid']}).",
        )

    try:
        pfad = await speicher.ablegen(
            vorgang.pfad_scan(zeile["doc_uid"], endung), daten, typ
        )
    except speicher.SpeicherFehler as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler

    jetzt = datetime.now(timezone.utc)
    werte = {
        "scan_pfad": pfad,
        "pruef_ergebnis": ergebnis,
        "vollstaendig": ergebnis["vollstaendig"],
        "geprueft_am": jetzt,
        "status": "geprueft",
    }
    # Ein Scan setzt den Weg voraus. Fehlen die Stationen davor, werden sie
    # jetzt gesetzt — das Blatt ist ja nachweislich draußen gewesen.
    if zeile["uebergeben_am"] is None:
        werte["uebergeben_am"] = zeile["erstellt_am"]
    if zeile["zurueck_am"] is None:
        werte["zurueck_am"] = jetzt

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            neu = (
                await sitzung.execute(
                    dokumentvorgaenge.update()
                    .where(dokumentvorgaenge.c.id == vorgang_id)
                    .values(**werte)
                    .returning(dokumentvorgaenge)
                )
            ).mappings().one()
    return _read(neu)


class Urteil(BaseModel):
    vollstaendig: bool
    kommentar: str | None = None


@router.post("/{vorgang_id}/urteil", response_model=VorgangRead)
async def urteil(vorgang_id: str = Path(...), eingabe: Urteil = ...) -> VorgangRead:
    """Das Urteil von Hand setzen.

    Die Messung sieht, ob in einem Feld Tinte ist — nicht, ob das Richtige
    darin steht. Wer das Blatt in der Hand hatte, weiß es besser.
    """
    await _laden(vorgang_id)
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            neu = (
                await sitzung.execute(
                    dokumentvorgaenge.update()
                    .where(dokumentvorgaenge.c.id == vorgang_id)
                    .values(vollstaendig=eingabe.vollstaendig, kommentar=eingabe.kommentar)
                    .returning(dokumentvorgaenge)
                )
            ).mappings().one()
    return _read(neu)


@router.post("/{vorgang_id}/nachweis", status_code=status.HTTP_201_CREATED)
async def nachweis(
    vorgang_id: str = Path(...),
    datei: UploadFile = File(...),
    zeile: str | None = Form(default=None),
) -> dict:
    """Ein Zertifikat an den Vorgang hängen — auf Wunsch an eine bestimmte Zeile."""
    vg = await _laden(vorgang_id)
    daten = await datei.read(settings.MAX_UPLOAD_BYTES + 1)
    if len(daten) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Die Datei ist zu groß.")
    if not daten:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Die Datei ist leer.")

    dateiname = datei.filename or "nachweis"
    typ = vorgang.mime_aus(dateiname, datei.content_type)
    if typ is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Nachweise nehmen wir als PDF, Bild oder Office-Datei an.",
        )
    try:
        pfad = await speicher.ablegen(
            vorgang.pfad_nachweis(vg["doc_uid"], dateiname), daten, typ
        )
    except speicher.SpeicherFehler as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            neu = (
                await sitzung.execute(
                    dokument_nachweise.insert().values(
                        vorgang_id=vorgang_id,
                        zeile=zeile,
                        pfad=pfad,
                        dateiname=dateiname,
                        hochgeladen_am=datetime.now(timezone.utc),
                    ).returning(dokument_nachweise.c.id)
                )
            ).scalar_one()
    return {"id": str(neu), "pfad": pfad, "dateiname": dateiname}


def _ausliefern(inhalt: bytes, dateiname: str, typ: str) -> Response:
    return Response(
        content=inhalt,
        media_type=typ,
        headers={
            "Content-Disposition": f'inline; filename="{dateiname}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{vorgang_id}/blatt.pdf")
async def blatt(vorgang_id: str = Path(...)) -> Response:
    zeile = await _laden(vorgang_id)
    if not zeile["pdf_pfad"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Zu diesem Vorgang gibt es kein Blatt.")
    try:
        inhalt = await speicher.holen(zeile["pdf_pfad"])
    except speicher.SpeicherFehler as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler
    return _ausliefern(inhalt, f"{zeile['name']} {zeile['doc_uid']}.pdf", "application/pdf")


@router.get("/{vorgang_id}/scan")
async def scan_holen(vorgang_id: str = Path(...)) -> Response:
    zeile = await _laden(vorgang_id)
    if not zeile["scan_pfad"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Zu diesem Vorgang gibt es keinen Scan.")
    try:
        inhalt = await speicher.holen(zeile["scan_pfad"])
    except speicher.SpeicherFehler as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler
    endung = zeile["scan_pfad"].rsplit(".", 1)[-1]
    typ = {"pdf": "application/pdf", "png": "image/png"}.get(endung, "image/jpeg")
    return _ausliefern(inhalt, f"Scan {zeile['name']}.{endung}", typ)
