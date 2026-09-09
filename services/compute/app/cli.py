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


def main() -> int:
    zerleger = argparse.ArgumentParser(prog="python -m app.cli")
    unter = zerleger.add_subparsers(dest="befehl", required=True)

    unter.add_parser("reload-postgrest", help="PostgREST-Schema-Cache neu anfordern")

    for name, hilfe in (
        ("uebernahme-vertrieb", "Upload-Protokolle, Rechnungen und Aufträge aus lumeapps holen"),
        ("uebernahme-nutzer", "Personen aus directus_users anlegen (neues Passwort je Person)"),
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
        "uebernahme-vertrieb": _uebernahme_vertrieb,
        "uebernahme-nutzer": _uebernahme_nutzer,
    }[args.befehl]
    asyncio.run(lauf(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
