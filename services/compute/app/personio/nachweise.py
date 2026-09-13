"""Nachweise nach einer Schulungs- oder Kompetenzänderung nach Personio (SET-09).

Aus lumeapps übernommen (`services/personio_writeback.py`), aber anders
ausgelöst. Dort startete der Router nach dem Speichern eine Hintergrundaufgabe
im Prozess. Hier ändert die Oberfläche Schulungen und Kompetenzen über
PostgREST; einen Aufruf, an den man etwas hängen könnte, gibt es nicht — und
`compute` bleibt zustandslos. Deshalb:

1. Ein Trigger (Migration 0051) merkt je Person und Art einen Auftrag in
   `personio_nachweise` vor, sobald sich etwas ändert — nur mit eingeschaltetem
   Schalter und hinterlegter Kategorie. Die lokale Änderung ist da schon
   geschrieben; was danach mit Personio passiert, nimmt sie nicht zurück.
2. pg_cron stößt alle zehn Minuten `POST /api/personio/nachweise/geplant` an,
   wenn ein Auftrag offen ist.
3. `abarbeiten` erzeugt je Auftrag eine schlichte PDF-Übersicht und lädt sie
   hoch. Erfolg: erledigt, mit Prüfsumme. Fehler: ein Versuch mehr und die
   Meldung; nach fünf Versuchen bleibt der Auftrag stehen.

**Keine Doppelnachweise.** Mehrere Änderungen bis zum nächsten Lauf ergeben
einen offenen Auftrag. Ist der Inhalt gleich dem zuletzt hochgeladenen, geht
nichts hoch. Parallele Läufe nehmen sich über `for update skip locked` nicht
denselben Auftrag.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

import sqlalchemy as sa

from app.db import SessionLocal, personio_nachweise, plattform_einstellungen
from app.personio import zugang
from app.personio.client import PersonioFehler

log = logging.getLogger(__name__)

MAX_VERSUCHE = 5
JE_LAUF = 50


@dataclass
class Lauf:
    hochgeladen: int = 0
    unveraendert: int = 0
    fehlgeschlagen: int = 0
    meldungen: list[str] = field(default_factory=list)


def einfaches_pdf(titel: str, zeilen: list[str]) -> bytes:
    """Einseitiges A4-PDF mit Titel und Textzeilen, ohne Bibliothek.

    Aus dem Altprojekt; die Zeichen gehen über Latin-1, Umlaute bleiben lesbar."""

    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    stroeme = [f"BT /F1 16 Tf 50 800 Td ({esc(titel)}) Tj ET"]
    y = 770
    for zeile in zeilen:
        stroeme.append(f"BT /F1 10 Tf 50 {y} Td ({esc(zeile)}) Tj ET")
        y -= 15
        if y < 40:
            break
    inhalt = "\n".join(stroeme).encode("latin-1", "replace")
    objekte = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(inhalt), inhalt),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    aus = b"%PDF-1.4\n"
    stellen: list[int] = []
    for i, obj in enumerate(objekte, start=1):
        stellen.append(len(aus))
        aus += b"%d 0 obj\n" % i + obj + b"\nendobj\n"
    xref = len(aus)
    aus += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objekte) + 1)
    for stelle in stellen:
        aus += b"%010d 00000 n \n" % stelle
    aus += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objekte) + 1, xref)
    return aus


async def _zeilen(sitzung, employee_id: int, art: str) -> list[str]:
    if art == "schulung":
        ergebnis = await sitzung.execute(sa.text(
            "select k.name, t.aktuell_datum from public.schulung_teilnahmen t"
            " join public.schulung_katalog k on k.id = t.schulung_id"
            " where t.employee_id = :e order by lower(k.name), k.id"
        ), {"e": employee_id})
        zeilen = [
            f"{name}: {datum.strftime('%d.%m.%Y') if datum else 'offen'}"
            for name, datum in ergebnis.all()
        ]
        return zeilen or ["(keine Schulungen hinterlegt)"]
    ergebnis = await sitzung.execute(sa.text(
        "select m.bereich, q.bezeichnung, b.anforderungslevel, b.erfuellungsgrad"
        " from public.kompetenz_bewertungen b"
        " join public.kompetenz_personen p on p.id = b.person_id"
        " join public.kompetenz_qualifikationen q on q.id = b.qualifikation_id"
        " join public.kompetenz_matrizen m on m.id = q.matrix_id"
        " where p.employee_id = :e order by m.bereich, lower(q.bezeichnung), q.id"
    ), {"e": employee_id})
    zeilen = [
        f"{bereich} · {bezeichnung}: AL {'-' if al is None else al} / Erfüllung {'-' if eg is None else eg}%"
        for bereich, bezeichnung, al, eg in ergebnis.all()
    ]
    return zeilen or ["(keine Bewertungen hinterlegt)"]


async def abarbeiten() -> Lauf:
    lauf = Lauf()
    async with SessionLocal() as sitzung:
        einstellung = (await sitzung.execute(sa.select(
            plattform_einstellungen.c.personio_nachweis_aktiv,
            plattform_einstellungen.c.personio_nachweis_kategorie,
        ))).one()
    kategorie = (einstellung.personio_nachweis_kategorie or "").strip()
    if not einstellung.personio_nachweis_aktiv or not kategorie:
        # Ausgeschaltet: Aufträge bleiben stehen und gehen nicht verloren.
        return lauf

    klient = await zugang.klient()
    if klient is None:
        return lauf

    # Die offenen Aufträge einmal einsammeln, dann jeden genau einmal versuchen.
    # Würde in der Schleife immer „der nächste offene“ geholt, käme derselbe
    # Auftrag nach einem Fehlversuch sofort wieder dran und wäre in einem Lauf
    # fünfmal probiert — der Wiederholungsabstand gehört zwischen die Läufe.
    async with SessionLocal() as sitzung:
        ids = (await sitzung.execute(
            sa.select(personio_nachweise.c.id)
            .where(personio_nachweise.c.erledigt_am.is_(None),
                   personio_nachweise.c.versuche < MAX_VERSUCHE)
            .order_by(personio_nachweise.c.angelegt_am, personio_nachweise.c.id)
            .limit(JE_LAUF)
        )).scalars().all()

    try:
        for auftrag_id in ids:
            async with SessionLocal() as sitzung:
                async with sitzung.begin():
                    auftrag = (await sitzung.execute(
                        sa.select(personio_nachweise)
                        .where(personio_nachweise.c.id == auftrag_id,
                               personio_nachweise.c.erledigt_am.is_(None),
                               personio_nachweise.c.versuche < MAX_VERSUCHE)
                        .with_for_update(skip_locked=True)
                    )).mappings().one_or_none()
                    if auftrag is None:
                        continue

                    name = (await sitzung.execute(sa.text(
                        "select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))"
                        " from public.personio_employees where id = :e"
                    ), {"e": auftrag["employee_id"]})).scalar_one_or_none() or f"#{auftrag['employee_id']}"
                    art_titel = "Schulungsübersicht" if auftrag["art"] == "schulung" else "Qualifikationsübersicht"
                    zeilen = await _zeilen(sitzung, auftrag["employee_id"], auftrag["art"])
                    pruefsumme = hashlib.sha256(
                        "\n".join([art_titel, name, *zeilen]).encode()
                    ).hexdigest()

                    zuletzt = (await sitzung.execute(
                        sa.select(personio_nachweise.c.inhalt_hash)
                        .where(personio_nachweise.c.employee_id == auftrag["employee_id"],
                               personio_nachweise.c.art == auftrag["art"],
                               personio_nachweise.c.erledigt_am.is_not(None),
                               personio_nachweise.c.inhalt_hash.is_not(None))
                        .order_by(personio_nachweise.c.erledigt_am.desc())
                        .limit(1)
                    )).scalar_one_or_none()

                    jetzt = datetime.now(timezone.utc)
                    fertig = sa.update(personio_nachweise).where(personio_nachweise.c.id == auftrag["id"])
                    if zuletzt == pruefsumme:
                        await sitzung.execute(fertig.values(erledigt_am=jetzt, inhalt_hash=pruefsumme,
                                                            fehler=None))
                        lauf.unveraendert += 1
                        continue

                    datum = jetzt.strftime("%d.%m.%Y")
                    try:
                        await klient.dokument_hochladen(
                            auftrag["employee_id"],
                            kategorie,
                            f"{art_titel} {name} ({datum})",
                            f"{art_titel.replace('ü', 'ue')}_{auftrag['employee_id']}.pdf",
                            einfaches_pdf(f"{art_titel} — {name}", zeilen),
                        )
                    except PersonioFehler as fehler:
                        await sitzung.execute(fertig.values(
                            versuche=personio_nachweise.c.versuche + 1, fehler=str(fehler)[:500]
                        ))
                        lauf.fehlgeschlagen += 1
                        lauf.meldungen.append(str(fehler))
                        log.warning("Personio-Nachweis fehlgeschlagen (Mitarbeiter %s): %s",
                                    auftrag["employee_id"], fehler)
                        continue
                    await sitzung.execute(fertig.values(erledigt_am=jetzt, inhalt_hash=pruefsumme,
                                                        fehler=None))
                    lauf.hochgeladen += 1
    finally:
        await klient.schliessen()
    return lauf
