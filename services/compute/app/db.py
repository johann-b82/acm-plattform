"""Datenbankzugriff für compute.

compute ist der einzige Schreiber der Ingestionstabellen und verbindet sich als
`postgres`. Das umgeht RLS bewusst — die Policies gelten für Leser über
PostgREST, nicht für den Importpfad. Eine eigene Rolle mit engeren Rechten ist
für die Härtung vorgesehen (docs/security-findings.md).

Die Tabellen sind hier als SQLAlchemy-Core-Objekte beschrieben, weil Alembic
SQL-first migriert (Policies und Funktionen stehen in derselben Revision).
`tests/test_schema_drift.py` vergleicht diese Definitionen gegen die echte
Datenbank, damit beide Seiten nicht auseinanderlaufen.
"""
from __future__ import annotations

import os

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings

# Nur für Tests: pytest-asyncio gibt jedem Test eine eigene Event-Loop. Eine
# gepoolte asyncpg-Verbindung, die auf einer anderen Loop geöffnet wurde,
# scheitert dann mit "attached to a different loop". In Produktion bleibt das
# Pooling an.
_engine_args: dict = {"pool_pre_ping": True}
if os.environ.get("DB_DISABLE_POOL") == "1":
    _engine_args = {"poolclass": NullPool}

engine = create_async_engine(settings.async_database_url, **_engine_args)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

metadata = sa.MetaData()

upload_batches = sa.Table(
    "upload_batches",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("filename", sa.String(255), nullable=False),
    sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("kind", sa.String(32), nullable=False),
    sa.Column("row_count", sa.Integer, nullable=False),
    sa.Column("error_count", sa.Integer, nullable=False),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("uploaded_by", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
)

# revenues und auftraege stammen aus zwei ERP-Exporten mit gleicher Form
# (18 Spalten, Tab-getrennt). Getrennte Tabellen, weil sie fachlich
# Verschiedenes sind: Rechnungen/Gutschriften gegenüber Auftragseingang.
revenues = sa.Table(
    "revenues",
    metadata,
    sa.Column("vorgang_nr", sa.String(50), primary_key=True),
    sa.Column("typ", sa.String(8), nullable=False),
    sa.Column("datum", sa.Date, nullable=False),
    sa.Column("adr_nr", sa.String(50)),
    sa.Column("customer_name", sa.String(255)),
    sa.Column("wert_eur", sa.Numeric(15, 2), nullable=False),
    sa.Column("upload_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id", ondelete="SET NULL")),
    sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("raw", JSONB),
)

auftraege = sa.Table(
    "auftraege",
    metadata,
    sa.Column("vorgang_nr", sa.String(50), primary_key=True),
    sa.Column("typ", sa.String(8), nullable=False),
    sa.Column("datum", sa.Date, nullable=False),
    sa.Column("adr_nr", sa.String(50)),
    sa.Column("customer_name", sa.String(255)),
    sa.Column("erfasser", sa.String(64)),
    sa.Column("wert_eur", sa.Numeric(15, 2), nullable=False),
    sa.Column("upload_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id", ondelete="SET NULL")),
    sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("raw", JSONB),
)

delivery_reliability = sa.Table(
    "delivery_reliability",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("auftrag", sa.String(50), nullable=False),
    sa.Column("pos", sa.Integer, nullable=False),
    sa.Column("upos", sa.Integer, nullable=False),
    sa.Column("adr_nr", sa.String(50)),
    sa.Column("supplier_name", sa.String(255)),
    sa.Column("delivered_date", sa.Date),
    sa.Column("target_date", sa.Date),
    sa.Column("verzug_tage", sa.Integer),
    sa.Column("quantity", sa.Numeric(15, 3)),
    sa.Column("unit", sa.String(20)),
    sa.Column("article_number", sa.String(50)),
    sa.Column("article_name", sa.String(255)),
    sa.Column("upload_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id", ondelete="SET NULL")),
    sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("raw", JSONB),
)

def _position_spalten() -> list[sa.Column]:
    """Die Spalten, die beide Positionstabellen gemeinsam haben.

    Als Funktion, nicht als Liste: ein `Column`-Objekt gehört genau einer
    Tabelle, und `Column.copy()` ist seit SQLAlchemy 1.4 abgekündigt.
    """
    return [
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("vorgang_nr", sa.String(50), nullable=False),
        sa.Column("pos", sa.Integer, nullable=False),
        sa.Column("upos", sa.Integer, nullable=False),
        sa.Column("typ", sa.String(10)),
        sa.Column("entry_date", sa.Date),
        sa.Column("customer_id", sa.String(50)),
        sa.Column("customer_name", sa.String(255)),
        sa.Column("customer_city", sa.String(255)),
        sa.Column("article_number", sa.String(50)),
        sa.Column("article_version", sa.String(50)),
        sa.Column("article_name", sa.String(255)),
        sa.Column("quantity", sa.Numeric(15, 3)),
        sa.Column("unit", sa.String(20)),
        sa.Column("price", sa.Numeric(15, 4)),
        sa.Column("position_value", sa.Numeric(15, 2)),
        sa.Column("upload_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id", ondelete="SET NULL")),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("raw", JSONB),
    ]


def _position_tabelle(name: str, *eigene: sa.Column) -> sa.Table:
    """Die beiden Positionstabellen unterscheiden sich nur in drei Spalten."""
    return sa.Table(name, metadata, *_position_spalten(), *eigene)


auftrag_positionen = _position_tabelle(
    "auftrag_positionen",
    sa.Column("lieferdatum", sa.Date),
    sa.Column("pos_typ_2", sa.String(20)),
)

delivery_records = _position_tabelle(
    "delivery_records",
    sa.Column("delivery_date", sa.Date),
    sa.Column("external_order_nr", sa.String(100)),
    sa.Column("order_nr", sa.String(100)),
)

TABLES = {
    "upload_batches": upload_batches,
    "revenues": revenues,
    "auftraege": auftraege,
    "delivery_reliability": delivery_reliability,
    "auftrag_positionen": auftrag_positionen,
    "delivery_records": delivery_records,
}
