"""Eine Excel-Mappe nach PDF wandeln.

LibreOffice im Kopflos-Betrieb. Zwei Dinge sind dabei zu wissen:

**Nur ein Lauf gleichzeitig.** LibreOffice hält ein Nutzerprofil und verträgt
keine zwei Läufe darin. Ein Semaphor reiht sie auf; im Altprojekt steht
dieselbe Sperre.

**Das Kopfbild fehlt im PDF.** LibreOffice rendert die VML-Grafik einer
Druckkopfzeile nicht — nachgemessen an einer ATR-Mappe. Das Altprojekt löst
das, indem es LibreOffice über UNO fernsteuert und das Logo als schwebende
Form in das Kopfband setzt. Hier steht das PDF ohne Logo; die Mappe selbst
trägt es. Was das Schließen kostet, steht in `docs/modules/atr.md`.
"""
from __future__ import annotations

import asyncio
import shutil
import uuid
from pathlib import Path

#: LibreOffice verträgt keine zwei gleichzeitigen Läufe im selben Profil.
_EINER = asyncio.Semaphore(1)
_FRIST = 120


class PdfFehlgeschlagen(RuntimeError):
    """LibreOffice kam nicht durch."""


async def nach_pdf(xlsx: bytes, name: str = "dokument") -> bytes:
    async with _EINER:
        ordner = Path(f"/tmp/{name}_{uuid.uuid4()}")
        try:
            ordner.mkdir(parents=True, exist_ok=True)
            quelle = ordner / f"{name}.xlsx"
            quelle.write_bytes(xlsx)
            prozess = await asyncio.create_subprocess_exec(
                "soffice",
                "--headless",
                "--norestore",
                "--convert-to",
                "pdf",
                "--outdir",
                str(ordner),
                str(quelle),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                # Eigenes Profil je Lauf; ein geteiltes bleibt nach einem
                # Abbruch gesperrt zurück.
                env={"HOME": str(ordner), "PATH": "/usr/bin:/bin"},
            )
            try:
                _, fehler = await asyncio.wait_for(prozess.communicate(), timeout=_FRIST)
            except asyncio.TimeoutError as ausnahme:
                try:
                    prozess.kill()
                except ProcessLookupError:
                    pass
                await prozess.wait()
                raise PdfFehlgeschlagen(
                    f"Die Umwandlung hat nach {_FRIST} s nicht geantwortet."
                ) from ausnahme

            ziel = ordner / f"{name}.pdf"
            if prozess.returncode != 0 or not ziel.exists():
                raise PdfFehlgeschlagen(
                    "LibreOffice ist gescheitert: "
                    + fehler.decode("utf-8", "replace")[-300:]
                )
            return ziel.read_bytes()
        finally:
            shutil.rmtree(ordner, ignore_errors=True)
