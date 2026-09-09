"""Kleine Wartungsbefehle. Aufruf: `python -m app.cli <befehl>`."""
from __future__ import annotations

import asyncio
import sys

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


BEFEHLE = {"reload-postgrest": _reload_postgrest}


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in BEFEHLE:
        print(f"Aufruf: python -m app.cli {{{'|'.join(BEFEHLE)}}}", file=sys.stderr)
        return 2
    asyncio.run(BEFEHLE[sys.argv[1]]())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
