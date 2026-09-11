"""Kleine Wartungsbefehle. Aufruf: `python -m app.cli <befehl> [optionen]`."""
from __future__ import annotations

import argparse
import asyncio

import sqlalchemy as sa

from app.db import engine


async def _reload_postgrest() -> None:
    """PostgREST seinen Schema-Cache neu einlesen lassen.

    PostgREST merkt sich Tabellen und Funktionen beim Start. Nach einer
    Migration sind neue RPC-Funktionen sonst erst nach einem Neustart des
    Containers sichtbar — ein Stolperstein, der sonst bei jedem Deployment
    auffällt. Das NOTIFY ist der vorgesehene Weg.
    """
    async with engine.begin() as conn:
        await conn.execute(sa.text("notify pgrst, 'reload schema'"))
    print("PostgREST: Schema-Cache neu angefordert")


def _alte_datenbank(dsn: str) -> sa.engine.Engine:
    """Verbindung zur Datenbank des Altprojekts, nur lesend genutzt."""
    if dsn.startswith("postgresql+"):
        dsn = "postgresql://" + dsn.split("://", 1)[1]
    return sa.create_engine(dsn.replace("postgresql://", "postgresql+psycopg://", 1))


async def _uebernahme_vertrieb(args) -> None:
    from app.uebernahme import vertrieb

    bericht = await vertrieb.uebernehmen(_alte_datenbank(args.quelle), trocken=args.trocken)
    print("Übernahme Vertrieb" + (" (trocken, nichts geschrieben)" if args.trocken else ""))
    for zeile in bericht.zeilen():
        print("  " + zeile)


async def _uebernahme_nutzer(args) -> None:
    from app.uebernahme import nutzer

    bericht = await nutzer.uebernehmen(_alte_datenbank(args.quelle), trocken=args.trocken)
    print("Übernahme Nutzer" + (" (trocken, nichts geschrieben)" if args.trocken else ""))
    for zeile in bericht.zeilen():
        print("  " + zeile)
    if bericht.angelegt and not args.trocken:
        print()
        print("Zugangsdaten — nur jetzt sichtbar, bitte wegschreiben:")
        print(bericht.csv(), end="")


async def _uebernahme_atr(args) -> None:
    from app.uebernahme import atr

    bericht = await atr.uebernehmen(_alte_datenbank(args.quelle), trocken=args.trocken)
    print("Übernahme ATR" + (" (trocken, nichts geschrieben)" if args.trocken else ""))
    for zeile in bericht.zeilen():
        print("  " + zeile)


async def _personio_sprachen(args) -> None:
    """Die gepflegten Sprachen auflisten — erst aus dem Abgleich, sonst live."""
    from app.db import personio_employees
    from app.personio.sprachen import sprachen_aus

    async with engine.begin() as conn:
        rohdaten = list(
            (
                await conn.execute(
                    sa.select(personio_employees.c.raw_json).where(
                        personio_employees.c.raw_json.isnot(None)
                    )
                )
            ).scalars()
        )

    quelle = "abgeglichener Bestand"
    if not rohdaten:
        from app.personio import zugang

        client = await zugang.klient()
        if client is None:
            print("Kein Abgleich vorhanden und keine Personio-Zugangsdaten hinterlegt.")
            print("Entweder einmal abgleichen lassen oder die Zugangsdaten unter")
            print("Einstellungen → Personal eintragen.")
            return
        try:
            rohdaten = await client.mitarbeiter()
        finally:
            await client.schliessen()
        quelle = "Personio (live)"

    zeilen = sprachen_aus(rohdaten)
    print(f"Quelle: {quelle} · {len(rohdaten)} Personen")
    if not zeilen:
        print("Kein Feld gefunden, dessen Name nach Sprache aussieht.")
        return
    breite = max(len(f) for f, _, _ in zeilen)
    for feld, wert, anzahl in zeilen:
        print(f"  {feld.ljust(breite)}  {str(anzahl).rjust(4)}  {wert}")


def main() -> int:
    zerleger = argparse.ArgumentParser(prog="python -m app.cli")
    unter = zerleger.add_subparsers(dest="befehl", required=True)

    unter.add_parser("reload-postgrest", help="PostgREST-Schema-Cache neu anfordern")
    unter.add_parser(
        "personio-sprachen",
        help="gepflegte Sprachen der Belegschaft auflisten (für die Sprachwahl)",
    )

    for name, hilfe in (
        ("uebernahme-vertrieb", "Upload-Protokolle, Rechnungen und Aufträge aus lumeapps holen"),
        ("uebernahme-nutzer", "Personen aus directus_users anlegen (neues Passwort je Person)"),
        ("uebernahme-atr", "ATR-Teilekatalog und Vorlagen aus lumeapps holen"),
    ):
        p = unter.add_parser(name, help=hilfe)
        p.add_argument(
            "--quelle",
            required=True,
            metavar="DSN",
            help="Verbindung zur alten Datenbank, z. B. postgresql://kpi_user:pw@alter-host:5432/kpi_db",
        )
        p.add_argument(
            "--trocken",
            action="store_true",
            help="nur zählen, nichts schreiben",
        )

    args = zerleger.parse_args()
    lauf = {
        "reload-postgrest": lambda a: _reload_postgrest(),
        "personio-sprachen": _personio_sprachen,
        "uebernahme-vertrieb": _uebernahme_vertrieb,
        "uebernahme-nutzer": _uebernahme_nutzer,
        "uebernahme-atr": _uebernahme_atr,
    }[args.befehl]
    asyncio.run(lauf(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
