"""Teilekatalog und Vorlagen aus lumeapps übernehmen.

Der Katalog im Altprojekt ist über viele Referenzmappen gewachsen — an der
echten Datenbank nachgesehen: 287 Teile aus neun Mappen. Eine einzelne Mappe
neu einzulesen reicht deshalb nicht; ohne diesen Lauf fände ein Lieferschein
nur den Bruchteil seiner Teile, den die zuletzt eingelesene Mappe kennt.

Zwei Dinge weichen ab und werden hier abgebildet:

* Die normierte Teilenummer ist im neuen Stack eine **erzeugte** Spalte. Sie
  wird nicht übernommen, sondern entsteht neu aus der Teilenummer. Beide Seiten
  rechnen gleich (nur die Ziffern), an den echten Daten geprüft.
* Die Gerüstdatei liegt im Altprojekt als `bytea` in der Zeile, hier im Eimer
  `atr`. Sie wandert über die Storage-API mit.

Der Lauf ist wiederholbar: der Schlüssel ist die normierte Teilenummer, und
eine zweite Übernahme aktualisiert statt zu verdoppeln.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.atr.format import programmfamilie
from app.atr.speicher import ablegen
from app.db import SessionLocal, atr_teile, atr_vorlagen

XLSX_TYP = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@dataclass
class Bericht:
    teile_neu: int = 0
    teile_aktualisiert: int = 0
    vorlagen: int = 0
    geruestdateien: int = 0
    ohne_ziffern: list[str] = field(default_factory=list)

    def zeilen(self) -> list[str]:
        z = [
            f"Teile: {self.teile_neu} neu, {self.teile_aktualisiert} aktualisiert",
            f"Vorlagen: {self.vorlagen} ({self.geruestdateien} mit Gerüstdatei)",
        ]
        if self.ohne_ziffern:
            z.append(
                "Ohne Ziffern in der Teilenummer — nicht übernommen, weil sie "
                "über keinen Schlüssel gefunden würden: "
                + ", ".join(sorted(self.ohne_ziffern))
            )
        return z


def _nur_ziffern(text: str | None) -> str:
    return "".join(z for z in (text or "") if z.isdigit())


def teile_aufbereiten(alte: list[dict]) -> tuple[list[dict], list[str]]:
    """Alte Katalogzeilen auf die neue Form bringen.

    Ohne Datenbank, damit die Abbildung für sich prüfbar bleibt. Zeilen ohne
    eine einzige Ziffer in der Teilenummer fallen heraus: die normierte Spalte
    bliebe leer, und über nichts lässt sich nichts finden.
    """
    jetzt = datetime.now(timezone.utc)
    zeilen: list[dict] = []
    ohne: list[str] = []
    for alt in alte:
        nummer = (alt.get("part_number") or "").strip()
        if not _nur_ziffern(nummer):
            ohne.append(nummer or "(leer)")
            continue
        zeilen.append(
            {
                "teilenummer": nummer,
                "lieferantennummer": alt.get("supplier_article_code"),
                "bezeichnung": alt.get("part_name"),
                "zeichnung": alt.get("drawing_number_issue"),
                "gewicht_kg": alt.get("default_weight_kg"),
                "menge": alt.get("qty") or 1,
                "kategorie": alt.get("category"),
                "bestellposition": alt.get("po_pos"),
                "herkunft": alt.get("source_filename") or "Übernahme",
                "erstellt_am": jetzt,
                "geaendert_am": jetzt,
            }
        )
    return zeilen, ohne


def vorlage_aufbereiten(alt: dict) -> dict | None:
    """Eine alte Vorlagenzeile auf die neue Form bringen.

    Der Schlüssel ist im Altprojekt eine feste Zahl (1 = A350, 2 = A380), hier
    die Programmfamilie. Steht dort kein Programm, hilft der Dateiname der
    Gerüstdatei weiter — bei `id = 1` ist er in der Produktion der einzige
    Hinweis.
    """
    programm = programmfamilie(alt.get("ac_programme"))
    if not programm:
        programm = programmfamilie(alt.get("structure_filename"))
    if not programm:
        return None
    return {
        "programm": programm,
        "kunde": alt.get("customer"),
        "arbeitspaket": alt.get("work_package"),
        "besteller_spez": alt.get("purchaser_spec"),
        "atp": alt.get("atp"),
        "lieferanten_spez": alt.get("supplier_spec"),
        "referenz": alt.get("reference_no"),
        "lieferant": alt.get("supplier"),
        "kunden_spez": alt.get("customer_spec"),
        "nscm": alt.get("nscm_code"),
        "ata_kapitel": alt.get("ata_chapter"),
        "waage": alt.get("weighing_equipment"),
        "qs_unterschrift": alt.get("qa_signer_default"),
        "geruest_dateiname": alt.get("structure_filename"),
        "geaendert_am": datetime.now(timezone.utc),
    }


async def uebernehmen(alte_datenbank, trocken: bool = False) -> Bericht:
    bericht = Bericht()

    with alte_datenbank.connect() as alt:
        teile_roh = [
            dict(z)
            for z in alt.execute(
                sa.text(
                    "select part_number, supplier_article_code, part_name,"
                    " drawing_number_issue, default_weight_kg, qty, category,"
                    " po_pos, source_filename from atr_part"
                )
            ).mappings()
        ]
        vorlagen_roh = [
            dict(z)
            for z in alt.execute(
                sa.text(
                    "select id, customer, ac_programme, work_package, purchaser_spec,"
                    " atp, supplier_spec, reference_no, supplier, customer_spec,"
                    " nscm_code, ata_chapter, weighing_equipment, qa_signer_default,"
                    " structure_filename, structure_xlsx from atr_template"
                )
            ).mappings()
        ]

    zeilen, ohne = teile_aufbereiten(teile_roh)
    bericht.ohne_ziffern = ohne

    if trocken:
        bericht.teile_neu = len(zeilen)
        bericht.vorlagen = sum(1 for v in vorlagen_roh if vorlage_aufbereiten(v))
        bericht.geruestdateien = sum(
            1 for v in vorlagen_roh if v.get("structure_xlsx")
        )
        return bericht

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            if zeilen:
                vorher = set(
                    (
                        await sitzung.execute(sa.select(atr_teile.c.teilenummer_norm))
                    ).scalars()
                )
                anweisung = pg_insert(atr_teile).values(zeilen)
                await sitzung.execute(
                    anweisung.on_conflict_do_update(
                        index_elements=[atr_teile.c.teilenummer_norm],
                        index_where=atr_teile.c.teilenummer_norm.isnot(None),
                        set_={
                            spalte: anweisung.excluded[spalte]
                            for spalte in (
                                "teilenummer", "lieferantennummer", "bezeichnung",
                                "zeichnung", "gewicht_kg", "menge", "kategorie",
                                "bestellposition", "herkunft", "geaendert_am",
                            )
                        },
                    )
                )
                nachher = set(
                    (
                        await sitzung.execute(sa.select(atr_teile.c.teilenummer_norm))
                    ).scalars()
                )
                bericht.teile_neu = len(nachher - vorher)
                bericht.teile_aktualisiert = len(zeilen) - bericht.teile_neu

    # Vorlagen einzeln: die Gerüstdatei geht in den Speicher, und ein Fehler
    # dabei soll nicht die anderen mitnehmen.
    for alt in vorlagen_roh:
        neu = vorlage_aufbereiten(alt)
        if neu is None:
            continue
        if alt.get("structure_xlsx"):
            pfad = f"uebernahme/{neu['programm']}/geruest.xlsx"
            await ablegen(pfad, bytes(alt["structure_xlsx"]), XLSX_TYP)
            neu["geruest_pfad"] = pfad
            bericht.geruestdateien += 1
        async with SessionLocal() as sitzung:
            async with sitzung.begin():
                anweisung = pg_insert(atr_vorlagen).values(neu)
                await sitzung.execute(
                    anweisung.on_conflict_do_update(
                        index_elements=[atr_vorlagen.c.programm],
                        set_={
                            spalte: anweisung.excluded[spalte]
                            for spalte in neu
                            if spalte != "programm"
                        },
                    )
                )
        bericht.vorlagen += 1

    return bericht
