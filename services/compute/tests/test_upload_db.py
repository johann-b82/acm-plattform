"""Stapel-Upload: der Weg QR → Vorgang.

Die Ablage und der Abschluss brauchen den Storage (nur auf der Plattform); hier
geprüft wird das Lesen des QR und die Zuordnung über die Kennung.
"""
from __future__ import annotations

import pytest

from app.einarbeitung import upload
from app.einarbeitung.bogen import Inhalt, baue_pdf

pytestmark = pytest.mark.asyncio


async def test_unbekannte_kennung_bleibt_nicht_zugeordnet(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    # Ein Bogen mit QR, zu dem es keinen Vorgang gibt.
    pdf = await baue_pdf(
        "Test Person", None, None,
        [Inhalt("Nähen", "Chef", "Einarbeitung in das Nähen.")],
        None, doc_uid="STAPELTESTXY",
    )
    z = await upload.ein_blatt("scan.pdf", pdf, "pdf", "application/pdf")
    assert z.status == "nicht_zugeordnet"
    assert z.doc_uid == "STAPELTESTXY"


async def test_manuell_ohne_person_meldet_fehler(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    z = await upload.manuell_abschliessen(999_999_999, b"x", "pdf", "application/pdf")
    assert z.status == "fehler"
