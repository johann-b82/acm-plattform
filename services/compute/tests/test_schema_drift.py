"""Wächter: die Core-Definitionen in app/db.py müssen zur Datenbank passen.

Alembic migriert SQL-first (Policies und Funktionen stehen in derselben
Revision), die Tabellen sind in `app/db.py` zusätzlich als Core-Objekte
beschrieben. Ohne diesen Test würden beide Seiten irgendwann auseinanderlaufen
und der Upsert an einer fehlenden Spalte scheitern.
"""
from __future__ import annotations

import pytest
import sqlalchemy as sa

from app.db import SessionLocal, TABLES

# Postgres nennt die Typen anders als SQLAlchemy; nur die Familie zählt.
TYP_FAMILIE = {
    "integer": "int",
    "bigint": "int",
    "smallint": "int",
    "character varying": "text",
    "text": "text",
    "date": "date",
    "timestamp with time zone": "timestamptz",
    "numeric": "numeric",
    "jsonb": "jsonb",
    "uuid": "uuid",
}


def familie_aus_core(typ: sa.types.TypeEngine) -> str:
    name = typ.__class__.__name__.lower()
    if "int" in name:
        return "int"
    if "string" in name or "text" in name or "varchar" in name:
        return "text"
    if "datetime" in name:
        return "timestamptz"
    if "date" in name:
        return "date"
    if "numeric" in name:
        return "numeric"
    if "jsonb" in name:
        return "jsonb"
    if "uuid" in name:
        return "uuid"
    return name


@pytest.mark.parametrize("tabelle", sorted(TABLES))
async def test_spalten_stimmen_mit_der_datenbank_ueberein(tabelle: str, datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    core = TABLES[tabelle]
    async with SessionLocal() as session:
        rows = (
            await session.execute(
                sa.text(
                    "select column_name, data_type, is_nullable"
                    " from information_schema.columns"
                    " where table_schema = 'public' and table_name = :t"
                ),
                {"t": tabelle},
            )
        ).mappings().all()

    assert rows, f"Tabelle {tabelle} fehlt in der Datenbank"
    db_spalten = {r["column_name"]: r for r in rows}

    fehlend = set(core.columns.keys()) - set(db_spalten)
    ueberzaehlig = set(db_spalten) - set(core.columns.keys())
    assert not fehlend, f"{tabelle}: in app/db.py beschrieben, aber nicht in der Datenbank: {fehlend}"
    assert not ueberzaehlig, f"{tabelle}: in der Datenbank, aber nicht in app/db.py: {ueberzaehlig}"

    for name, spalte in core.columns.items():
        db = db_spalten[name]
        assert TYP_FAMILIE.get(db["data_type"], db["data_type"]) == familie_aus_core(spalte.type), (
            f"{tabelle}.{name}: Typ {db['data_type']} passt nicht zu {spalte.type}"
        )
        # Spalten mit Vorgabewert dürfen in der Definition nullable sein.
        if not spalte.nullable and spalte.server_default is None:
            assert db["is_nullable"] == "NO", f"{tabelle}.{name} ist in der Datenbank nullable"
