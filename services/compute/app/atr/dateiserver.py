"""Zugriff auf den Eingangsordner auf dem Dateiserver (SMB).

Dünne Schicht über `smbclient`. Synchron — die Aufrufer im asynchronen Teil
legen jeden Aufruf in einen Thread.

**Das Ziel ist nicht frei wählbar.** Befund 16 im Altprojekt: der Rechner
kommt aus einer Eingabemaske, und der Dienst verbindet sich dorthin. Das ist
ein Weg, den Dienst gegen ein beliebiges Ziel im Netz laufen zu lassen — die
Anmeldung geht mit, und ein fremder Rechner bekommt sie zu sehen. Der
Betreiber gibt in `ATR_SMB_ERLAUBT` vor, welche Rechner und Netze in Frage
kommen; alles andere wird abgelehnt, bevor eine Verbindung entsteht.

**`..` fällt beim Zusammensetzen durch.** Befund 17: die Bestandteile kommen
teils aus der Maske, teils sind es Dateinamen vom Server selbst. Der Riegel
sitzt im Erbauer, weil das die Stelle ist, die jeder Aufruf passiert.
"""
from __future__ import annotations

from dataclasses import dataclass

import smbclient

from app import netz
from app.config import settings


@dataclass(frozen=True)
class Ziel:
    rechner: str
    freigabe: str
    domaene: str | None
    benutzer: str
    passwort: str
    eingang: str
    ausgang: str
    archiv: str


class DateiserverFehler(RuntimeError):
    """Verbindung oder Zugriff ist gescheitert — mit lesbarer Meldung."""


class ZielNichtErlaubt(DateiserverFehler):
    """Der eingetragene Rechner steht nicht in der Allowlist (siehe `app.netz`)."""


def pruefe_ziel(rechner: str) -> None:
    """Lässt nur durch, was der Betreiber in `ATR_SMB_ERLAUBT` freigegeben hat."""
    try:
        netz.pruefe_ziel(
            rechner,
            netz.erlaubte(settings.ATR_SMB_ERLAUBT),
            port=445,
            name="ATR_SMB_ERLAUBT",
        )
    except netz.ZielNichtErlaubt as fehler:
        raise ZielNichtErlaubt(str(fehler)) from fehler


def unc(rechner: str, freigabe: str, *teile: str) -> str:
    """Setzt einen UNC-Pfad zusammen und fällt dabei nicht aus der Freigabe."""
    abschnitte: list[str] = []
    for teil in teile:
        for stueck in teil.replace("/", "\\").split("\\"):
            if not stueck or stueck == ".":
                continue
            if stueck == "..":
                raise DateiserverFehler(f"Unzulässiger Pfadbestandteil: {teil!r}")
            abschnitte.append(stueck)
    rest = "\\".join(abschnitte)
    return rf"\\{rechner}\{freigabe}" + (("\\" + rest) if rest else "")


def _anmelden(ziel: Ziel) -> None:
    pruefe_ziel(ziel.rechner)
    benutzer = f"{ziel.domaene}\\{ziel.benutzer}" if ziel.domaene else ziel.benutzer
    smbclient.register_session(
        ziel.rechner, username=benutzer, password=ziel.passwort
    )


def liste_eingang(ziel: Ziel) -> list[str]:
    """Die PDF-Dateien im Eingangsordner, alphabetisch."""
    try:
        _anmelden(ziel)
        ordner = unc(ziel.rechner, ziel.freigabe, ziel.eingang)
        return sorted(n for n in smbclient.listdir(ordner) if n.lower().endswith(".pdf"))
    except ZielNichtErlaubt:
        raise
    except Exception as fehler:  # noqa: BLE001
        raise DateiserverFehler(f'Eingangsordner nicht lesbar: {fehler}') from fehler


def lies(ziel: Ziel, name: str) -> bytes:
    try:
        _anmelden(ziel)
        with smbclient.open_file(
            unc(ziel.rechner, ziel.freigabe, ziel.eingang, name), mode="rb"
        ) as datei:
            return datei.read()
    except ZielNichtErlaubt:
        raise
    except Exception as fehler:  # noqa: BLE001
        raise DateiserverFehler(f'„{name}“ nicht lesbar: {fehler}') from fehler


def _freier_name(ziel: Ziel, pfad: str, name: str) -> str:
    """`name`, oder `name (n).ext`, wenn er dort schon liegt.

    Überschreiben wäre hier falsch: was einmal ausgeliefert wurde, bleibt.
    """
    vorhanden = set(smbclient.listdir(unc(ziel.rechner, ziel.freigabe, pfad)))
    if name not in vorhanden:
        return name
    stamm, punkt, endung = name.rpartition(".")
    basis, anhang = (stamm, f".{endung}") if punkt else (name, "")
    nummer = 1
    while f"{basis} ({nummer}){anhang}" in vorhanden:
        nummer += 1
    return f"{basis} ({nummer}){anhang}"


def schreibe(ziel: Ziel, pfad: str, name: str, daten: bytes) -> str:
    """Legt eine Datei unter `pfad` ab und gibt den benutzten Namen zurück.

    Fehlende Ordner entstehen dabei — die Ablage läuft in Jahres- und
    Kalenderwochenordner, und die gibt es beim ersten ATR einer Woche noch
    nicht. `makedirs` legt die ganze Kette an, nicht nur die letzte Stufe.

    `pfad` kommt aus `app.atr.ziele` oder aus den Einstellungen; `unc` weist
    `..` darin ab, bevor eine Verbindung entsteht (Befund 17).
    """
    try:
        _anmelden(ziel)
        smbclient.makedirs(unc(ziel.rechner, ziel.freigabe, pfad), exist_ok=True)
        endgueltig = _freier_name(ziel, pfad, name)
        with smbclient.open_file(
            unc(ziel.rechner, ziel.freigabe, pfad, endgueltig), mode="wb"
        ) as datei:
            datei.write(daten)
        return endgueltig
    except ZielNichtErlaubt:
        raise
    except Exception as fehler:  # noqa: BLE001
        raise DateiserverFehler(f'„{name}“ nicht schreibbar: {fehler}') from fehler


def schreibe_ausgang(ziel: Ziel, name: str, daten: bytes) -> str:
    """Legt eine Datei im Ausgangsordner ab und gibt den benutzten Namen zurück."""
    return schreibe(ziel, ziel.ausgang, name, daten)


def ins_archiv(ziel: Ziel, name: str) -> str:
    """Verschiebt eine gelesene Datei aus dem Eingang ins Archiv.

    Erst danach gilt sie als erledigt: bricht der Lauf vorher ab, liegt sie
    noch im Eingang und wird beim nächsten Mal erneut gelesen.
    """
    try:
        _anmelden(ziel)
        archiv = unc(ziel.rechner, ziel.freigabe, ziel.archiv)
        smbclient.makedirs(archiv, exist_ok=True)
        endgueltig = _freier_name(ziel, ziel.archiv, name)
        smbclient.rename(
            unc(ziel.rechner, ziel.freigabe, ziel.eingang, name),
            unc(ziel.rechner, ziel.freigabe, ziel.archiv, endgueltig),
        )
        return endgueltig
    except ZielNichtErlaubt:
        raise
    except Exception as fehler:  # noqa: BLE001
        raise DateiserverFehler(f'„{name}“ nicht archivierbar: {fehler}') from fehler


def probe(ziel: Ziel) -> tuple[bool, str | None]:
    """Verbindung prüfen, ohne etwas zu verändern."""
    try:
        _anmelden(ziel)
        smbclient.listdir(unc(ziel.rechner, ziel.freigabe, ziel.eingang))
        return True, None
    except Exception as fehler:  # noqa: BLE001
        return False, str(fehler)
