"""Abgleich mit Personio.

Aus lumeapps übernommen (`services/hr_sync.py`). Die Reihenfolge ist Absicht,
und die Eigenheiten der Personio-Antworten sind teuer erarbeitet — sie stehen
hier so, wie sie dort stehen:

* **Nacheinander, nicht nebenläufig.** Personio drosselt schnell, und die
  Mitarbeiter müssen vor Anwesenheiten und Abwesenheiten in der Datenbank
  sein.
* **Mitarbeiter sind Pflicht, der Rest ist Kür.** Scheitert der
  Anwesenheitsabruf, gelten die Stammdaten trotzdem als abgeglichen —
  Abteilungen, Ein- und Austritte sind dann wenigstens aktuell. Der Teilfehler
  steht im Protokoll.
* **Zwei Quellen für Abwesenheiten.** `/company/absence-periods` gibt für
  unsere Zugangsdaten nur Freizeitausgleich her (stundenbasiert),
  `/company/time-offs` Urlaub und Krankheit (tagesbasiert). Erst zusammen sind
  sie vollständig, und nur wenn beide geantwortet haben, dürfen verwaiste
  Zeilen gelöscht werden.
* **`effective_duration` ist bei stundenbasierten Abwesenheiten in Minuten.**
  300 heißt fünf Stunden. Ohne die Division landete der Wert sechzigfach zu
  groß in der Datenbank.

Die Zugangsdaten kommen aus der Umgebung, nicht aus der Datenbank. Das
Altprojekt verschlüsselt sie mit Fernet in `app_settings` und braucht dafür
einen weiteren Schlüssel, der auch verloren gehen kann; hier stehen sie in
derselben `.env` wie alles andere.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import settings
from app.db import SessionLocal, personio_absences, personio_attendance, personio_employees
from app.personio.client import PersonioClient, PersonioFehler

log = logging.getLogger(__name__)

# Wie weit die Anwesenheiten zurückgeholt werden. Die volle Historie ginge
# über V2 auch, kostet aber viele Seiten und bringt für die Kennzahlen nichts.
FENSTER_TAGE = 400


@dataclass
class Ergebnis:
    status: str = "ok"
    mitarbeiter: int = 0
    anwesenheiten: int = 0
    abwesenheiten: int = 0
    entfernt: int = 0
    fehler: str | None = None
    dauer_sekunden: float = 0.0
    teilfehler: list[str] = field(default_factory=list)


class NichtEingerichtet(RuntimeError):
    """Ohne Zugangsdaten gibt es nichts abzugleichen."""


# --- Personios Verpackung ----------------------------------------------------


def _wert(attrs: dict, schluessel: str) -> Any:
    """Personio verpackt Felder mal als `{label, value, …}`, mal flach."""
    feld = attrs.get(schluessel)
    if isinstance(feld, dict) and "value" in feld:
        return feld["value"]
    return feld


def _datum(roh: Any) -> date | None:
    if not roh:
        return None
    if isinstance(roh, date):
        return roh
    text = str(roh)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None


def _zeit(roh: Any) -> time | None:
    """`08:50`, `08:50:00` oder ein V2-Zeitstempel `2026-01-26T08:50:00`."""
    if not roh:
        return None
    text = str(roh)
    if "T" in text:
        text = text.split("T", 1)[1]
    text = text[:8] if len(text) >= 8 else text
    try:
        return time.fromisoformat(text)
    except ValueError:
        return None


def _tief_id(ref: Any) -> int | None:
    """Personio schachtelt Verweise unterschiedlich tief."""
    if isinstance(ref, int):
        return ref
    if isinstance(ref, dict):
        innen = ref.get("attributes", ref)
        feld = innen.get("id")
        if isinstance(feld, dict):
            feld = feld.get("value")
        if isinstance(feld, int):
            return feld
        if isinstance(feld, str) and feld.isdigit():
            return int(feld)
    return None


def _mitarbeiter_zeile(roh: dict, jetzt: datetime) -> dict:
    attrs = roh.get("attributes", {})
    abteilung = _wert(attrs, "department")
    if isinstance(abteilung, dict):
        abteilung = abteilung.get("attributes", {}).get("name")
    elif not isinstance(abteilung, str):
        abteilung = None
    return {
        "id": _wert(attrs, "id") or roh.get("id"),
        "first_name": _wert(attrs, "first_name"),
        "last_name": _wert(attrs, "last_name"),
        "email": _wert(attrs, "email"),
        "department": abteilung,
        "status": _wert(attrs, "status"),
        "hire_date": _datum(_wert(attrs, "hire_date")),
        "termination_date": _datum(_wert(attrs, "termination_date")),
        "weekly_working_hours": _wert(attrs, "weekly_working_hours"),
        "raw_json": roh,
        "synced_at": jetzt,
    }


def _anwesenheit_zeile(roh: dict, jetzt: datetime) -> dict:
    """Ein V2-Segment. Pausen sind eigene `BREAK`-Segmente und fallen vorher
    heraus — deshalb ist `break_minutes` immer null."""
    person = (roh.get("person") or {}).get("id")
    return {
        "id": str(roh.get("id")),
        "employee_id": int(person) if person else None,
        "datum": _datum(roh.get("attribution_date")),
        "start_time": _zeit((roh.get("start") or {}).get("date_time")),
        "end_time": _zeit((roh.get("end") or {}).get("date_time")),
        "break_minutes": 0,
        "synced_at": jetzt,
    }


def _abwesenheit_stunden(attrs: dict) -> float | None:
    """`effective_duration` ist bei `measurement_unit == "hour"` in **Minuten**."""
    dauer = attrs.get("effective_duration")
    if dauer is None:
        dauer = _wert(attrs, "hours")
    if dauer is None:
        return None
    einheit = (attrs.get("measurement_unit") or _wert(attrs, "time_unit") or "").lower()
    return round(dauer / 60.0, 2) if einheit == "hour" else float(dauer)


def _abwesenheit_zeile(roh: dict, jetzt: datetime) -> dict:
    """Aus `/company/absence-periods` — stundenbasiert."""
    attrs = roh.get("attributes", {})
    typ_ref = attrs.get("absence_type") or attrs.get("time_off_type") or attrs.get("type")
    typ_id = None
    if isinstance(typ_ref, dict):
        typ_attrs = typ_ref.get("attributes", {})
        kandidat = typ_attrs.get("time_off_type_id") or typ_attrs.get("id")
        typ_id = kandidat if isinstance(kandidat, int) else None
    beginn = _datum(attrs.get("start") or _wert(attrs, "start_date"))
    return {
        "id": str(attrs.get("id") or roh.get("id")),
        "employee_id": _tief_id(attrs.get("employee")) or _wert(attrs, "employee_id"),
        "absence_type_id": typ_id,
        "start_date": beginn,
        "end_date": _datum(attrs.get("end") or _wert(attrs, "end_date")) or beginn,
        "time_unit": attrs.get("measurement_unit") or _wert(attrs, "time_unit") or "days",
        "hours": _abwesenheit_stunden(attrs),
        "raw_json": roh,
        "synced_at": jetzt,
    }


def _freistellung_zeile(roh: dict, tagesstunden: dict[int, float], jetzt: datetime) -> dict:
    """Aus `/company/time-offs` — tagesbasiert.

    `days_count` zählt bereits Arbeitstage, halbe Tage als 0,5. Eine laufende
    Abwesenheit hat kein Ende; dann gilt der Beginn, damit die Spalte gefüllt
    ist.
    """
    attrs = roh.get("attributes", roh)
    person = _tief_id(attrs.get("employee"))
    typ = _tief_id(attrs.get("time_off_type"))
    tage = float(attrs.get("days_count") or 0)
    beginn = _datum(attrs.get("start_date"))
    return {
        "id": str(attrs.get("id") or roh.get("id")),
        "employee_id": person,
        "absence_type_id": typ,
        "start_date": beginn,
        "end_date": _datum(attrs.get("end_date")) or beginn,
        "time_unit": "day",
        "hours": round(tage * tagesstunden.get(person, 8.0), 2),
        "raw_json": roh,
        "synced_at": jetzt,
    }


# --- Schreiben ---------------------------------------------------------------


async def _upsert(session, tabelle: sa.Table, zeilen: list[dict]) -> int:
    """Blockweise einfügen oder aktualisieren; leere Schlüssel fallen heraus."""
    brauchbar = [z for z in zeilen if z.get("id") is not None and z.get("employee_id", 0) is not None]
    if not brauchbar:
        return 0
    spalten = [c.name for c in tabelle.columns if c.name != "id" and c.name in brauchbar[0]]
    block = max(1, 32767 // max(1, len(brauchbar[0])))
    geschrieben = 0
    for start in range(0, len(brauchbar), block):
        teil = brauchbar[start : start + block]
        stmt = pg_insert(tabelle).values(teil)
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=["id"], set_={c: stmt.excluded[c] for c in spalten}
            )
        )
        geschrieben += len(teil)
    return geschrieben


async def _verwaiste_entfernen(session, behalten: set[str]) -> int:
    """In Personio gelöschte Abwesenheiten hier auch löschen.

    Nur aufrufen, wenn **beide** Quellen geantwortet haben — sonst hält man
    eine unvollständige Menge für die ganze Wahrheit und löscht Gültiges.
    """
    if not behalten:
        return 0
    ergebnis = await session.execute(
        sa.delete(personio_absences).where(personio_absences.c.id.notin_(list(behalten)))
    )
    return ergebnis.rowcount or 0


async def _protokollieren(session, e: Ergebnis) -> None:
    await session.execute(
        sa.text(
            "insert into public.personio_sync_meta"
            " (status, fehler, mitarbeiter, anwesenheiten, abwesenheiten, dauer_sekunden)"
            " values (:s, :f, :m, :an, :ab, :d)"
        ),
        {
            "s": e.status,
            "f": e.fehler,
            "m": e.mitarbeiter,
            "an": e.anwesenheiten,
            "ab": e.abwesenheiten,
            "d": round(e.dauer_sekunden, 2),
        },
    )


# --- Ablauf ------------------------------------------------------------------


async def abgleichen() -> Ergebnis:
    """Einmal alles holen und schreiben. Wirft nur, wenn die Stammdaten
    scheitern — alles andere landet als Teilfehler im Protokoll."""
    if not settings.PERSONIO_CLIENT_ID or not settings.PERSONIO_CLIENT_SECRET:
        raise NichtEingerichtet(
            "PERSONIO_CLIENT_ID und PERSONIO_CLIENT_SECRET sind nicht gesetzt"
        )

    begonnen = datetime.now(timezone.utc)
    jetzt = begonnen
    e = Ergebnis()
    client = PersonioClient(settings.PERSONIO_CLIENT_ID, settings.PERSONIO_CLIENT_SECRET)

    try:
        # 1) Stammdaten — Pflicht, und zuerst: die anderen Tabellen verweisen darauf.
        mitarbeiter = [_mitarbeiter_zeile(r, jetzt) for r in await client.mitarbeiter()]
        async with SessionLocal() as session:
            async with session.begin():
                e.mitarbeiter = await _upsert(session, personio_employees, mitarbeiter)

        tagesstunden = {
            m["id"]: (float(m["weekly_working_hours"]) / 5.0 if m.get("weekly_working_hours") else 8.0)
            for m in mitarbeiter
            if m.get("id")
        }

        # 2) Anwesenheiten — nur WORK-Segmente.
        try:
            roh = await client.anwesenheiten(seit=date.today() - timedelta(days=FENSTER_TAGE))
            zeilen = [_anwesenheit_zeile(r, jetzt) for r in roh if r.get("type") == "WORK"]
            async with SessionLocal() as session:
                async with session.begin():
                    e.anwesenheiten = await _upsert(session, personio_attendance, zeilen)
        except PersonioFehler as exc:
            e.teilfehler.append(f"Anwesenheiten: {exc}")
            log.warning("Anwesenheitsabgleich fehlgeschlagen (nicht fatal): %s", exc)

        # 3) Abwesenheiten aus beiden Quellen.
        abwesend: list[dict] = []
        beide_ok = True
        try:
            abwesend += [_abwesenheit_zeile(r, jetzt) for r in await client.abwesenheiten()]
        except PersonioFehler as exc:
            beide_ok = False
            e.teilfehler.append(f"Abwesenheiten: {exc}")
        try:
            abwesend += [
                _freistellung_zeile(r, tagesstunden, jetzt) for r in await client.freistellungen()
            ]
        except PersonioFehler as exc:
            beide_ok = False
            e.teilfehler.append(f"Freistellungen: {exc}")

        if abwesend:
            async with SessionLocal() as session:
                async with session.begin():
                    e.abwesenheiten = await _upsert(session, personio_absences, abwesend)
                    if beide_ok:
                        e.entfernt = await _verwaiste_entfernen(
                            session, {a["id"] for a in abwesend}
                        )
    except PersonioFehler as exc:
        e.status = "fehler"
        e.fehler = str(exc)
        e.dauer_sekunden = (datetime.now(timezone.utc) - begonnen).total_seconds()
        async with SessionLocal() as session:
            async with session.begin():
                await _protokollieren(session, e)
        raise
    finally:
        await client.schliessen()

    if e.teilfehler:
        e.status = "teilweise"
        e.fehler = "; ".join(e.teilfehler)
    e.dauer_sekunden = (datetime.now(timezone.utc) - begonnen).total_seconds()
    async with SessionLocal() as session:
        async with session.begin():
            await _protokollieren(session, e)
    return e
