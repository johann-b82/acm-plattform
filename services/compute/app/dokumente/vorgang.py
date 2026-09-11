"""Der Laufweg eines Blattes — erstellt, übergeben, zurück, geprüft.

Was hier steht, ist die Mechanik, nicht das Formular: das Blatt anlegen (samt
QR und Feldliste), den Weg weiterschalten, den Scan prüfen. Welches Formular
gebaut wird, entscheidet die `art`.

**Der Weg ist eine Reihenfolge, keine Menge.** Ein Blatt lässt sich nicht
prüfen, das nie jemand bekommen hat. Die Datenbank hält das mit einer Bedingung
fest, hier steht dieselbe Regel noch einmal, damit die Maske eine Meldung
bekommt statt eines Verstoßes gegen eine Bedingung.
"""
from __future__ import annotations

import secrets
from datetime import date, datetime, timezone

from app.dokumente import speicher
from app.dokumente.logo import Logo
from app.einarbeitung.bogen import Inhalt
from app.einarbeitung.bogen import baue_pdf as einarbeitung_pdf
from app.onboarding.uebersicht import Zeile
from app.onboarding.uebersicht import baue_pdf as uebersicht_pdf

ARTEN = ("einarbeitung", "schulung")

#: Die Stationen in ihrer Reihenfolge.
WEG = ("erstellt", "uebergeben", "zurueck", "geprueft")

#: Der Zeitstempel je Station.
STEMPEL = {
    "uebergeben": "uebergeben_am",
    "zurueck": "zurueck_am",
    "geprueft": "geprueft_am",
}

#: Alphabet ohne verwechselbare Zeichen. Der Token steht als Klartext unter dem
#: QR auf dem Blatt; wer ihn abtippen muss, soll 0 und O nicht raten.
_ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class WegFehler(ValueError):
    """Der gewünschte Schritt passt nicht zum Stand."""


def neue_kennung(laenge: int = 10) -> str:
    return "".join(secrets.choice(_ZEICHEN) for _ in range(laenge))


def naechster(stand: str) -> str:
    """Die folgende Station. Wirft, wenn es keine mehr gibt."""
    if stand not in WEG:
        raise WegFehler(f"Unbekannter Stand: {stand}")
    if stand == WEG[-1]:
        raise WegFehler("Der Vorgang ist bereits geprüft.")
    return WEG[WEG.index(stand) + 1]


def darf_weiter(stand: str, ziel: str) -> bool:
    """Nur genau einen Schritt vorwärts — nicht zwei, nicht zurück."""
    return stand in WEG and ziel in WEG and WEG.index(ziel) == WEG.index(stand) + 1


async def blatt_bauen(
    art: str,
    doc_uid: str,
    *,
    name: str,
    funktion: str | None,
    beginn: date | None,
    inhalt: list[dict],
    logo: Logo | None,
) -> tuple[bytes, dict]:
    """Das Formular mit QR bauen. Gibt PDF und Feldliste zurück."""
    layout: dict = {}
    if art == "einarbeitung":
        inhalte = [
            Inhalt(
                abteilung=e.get("abteilung", ""),
                ansprechpartner=e.get("ansprechpartner", ""),
                inhalt=e.get("inhalt", ""),
            )
            for e in inhalt
        ]
        pdf = await einarbeitung_pdf(
            name, funktion, beginn, inhalte, logo, doc_uid=doc_uid, layout_raus=layout
        )
    elif art == "schulung":
        zeilen = [Zeile(bezeichnung=e.get("bezeichnung", ""), anbieter=e.get("anbieter", ""))
                  for e in inhalt]
        pdf = await uebersicht_pdf(
            name, funktion or "", zeilen, logo=logo, doc_uid=doc_uid, layout_raus=layout
        )
    else:
        raise WegFehler(f"Unbekannte Art: {art}")
    return pdf, layout


def pfad_blatt(doc_uid: str) -> str:
    return f"vorgang/{doc_uid}/blatt.pdf"


def pfad_scan(doc_uid: str, endung: str) -> str:
    return f"vorgang/{doc_uid}/scan.{endung}"


def pfad_nachweis(doc_uid: str, dateiname: str) -> str:
    # Der Dateiname kommt vom Hochladenden; nur ein Zeitstempel davor, damit
    # zwei gleichnamige Dateien sich nicht überschreiben.
    sauber = "".join(c for c in dateiname if c.isalnum() or c in "._- ")[:80] or "datei"
    return f"vorgang/{doc_uid}/nachweise/{int(datetime.now(timezone.utc).timestamp())}_{sauber}"


async def blatt_ablegen(doc_uid: str, pdf: bytes) -> str:
    return await speicher.ablegen(pfad_blatt(doc_uid), pdf, "application/pdf")


#: Was der Eimer `dokumente` annimmt — dieselbe Liste wie in Migration 0035.
MIME = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def mime_aus(dateiname: str, typ: str | None) -> str | None:
    """Der Typ für die Ablage — aus der Endung, nicht aus dem Hochladen.

    Je nach Gerät schickt der Browser `application/octet-stream`, und der Eimer
    lässt nur eine feste Liste zu. Nachgemessen: die Ablage antwortete dann mit
    415, und der Aufrufer sah ein 502 „Ablegen fehlgeschlagen" — ein Fehler
    über die Datei, der wie ein Serverproblem aussah.

    Passt die Endung zu nichts, ist die Datei nicht erwünscht. Das sagen wir
    selbst, statt es den Speicher sagen zu lassen.
    """
    endung = dateiname.rsplit(".", 1)[-1].lower() if "." in dateiname else ""
    if endung in MIME:
        return MIME[endung]
    if typ in MIME.values():
        return typ
    return None


def endung_aus(dateiname: str, typ: str | None) -> str:
    """Die Endung für den abgelegten Scan — aus dem Namen, sonst aus dem Typ."""
    teil = dateiname.rsplit(".", 1)[-1].lower() if "." in dateiname else ""
    if teil in {"pdf", "png", "jpg", "jpeg"}:
        return "jpg" if teil == "jpeg" else teil
    if typ == "application/pdf":
        return "pdf"
    if typ == "image/png":
        return "png"
    return "jpg"
