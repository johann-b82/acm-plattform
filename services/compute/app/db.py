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

def _position_spalten(praefix: str = "customer") -> list[sa.Column]:
    """Die Spalten, die alle Positionstabellen gemeinsam haben.

    Als Funktion, nicht als Liste: ein `Column`-Objekt gehört genau einer
    Tabelle, und `Column.copy()` ist seit SQLAlchemy 1.4 abgekündigt.

    `praefix` benennt die Gegenseite: `customer` bei Aufträgen und
    Lieferscheinen, `supplier` bei Wareneingängen. Die Quellspalten der
    Exportdatei sind dieselben, nur die Bedeutung dreht sich um.
    """
    return [
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("vorgang_nr", sa.String(50), nullable=False),
        sa.Column("pos", sa.Integer, nullable=False),
        sa.Column("upos", sa.Integer, nullable=False),
        sa.Column("typ", sa.String(10)),
        sa.Column("entry_date", sa.Date),
        sa.Column(f"{praefix}_id", sa.String(50)),
        sa.Column(f"{praefix}_name", sa.String(255)),
        sa.Column(f"{praefix}_city", sa.String(255)),
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


def _position_tabelle(name: str, *eigene: sa.Column, praefix: str = "customer") -> sa.Table:
    """Die Positionstabellen unterscheiden sich nur in wenigen Spalten."""
    return sa.Table(name, metadata, *_position_spalten(praefix), *eigene)


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

goods_receipt_records = _position_tabelle(
    "goods_receipt_records",
    sa.Column("receipt_date", sa.Date),
    sa.Column("order_nr", sa.String(100)),
    sa.Column("material_group", sa.String(50)),
    sa.Column("purchase_account", sa.String(50)),
    praefix="supplier",
)

quality_records = sa.Table(
    "quality_records",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("report_nr", sa.String(50), nullable=False),
    sa.Column("report_date", sa.Date),
    sa.Column("art", sa.String(20)),
    sa.Column("level", sa.SmallInteger),
    sa.Column("issuer", sa.String(255)),
    sa.Column("customer_name", sa.String(255)),
    sa.Column("customer_id", sa.String(50)),
    sa.Column("designation", sa.Text),
    sa.Column("status_code", sa.String(50)),
    sa.Column("problem_description", sa.Text),
    sa.Column("root_cause", sa.Text),
    sa.Column("quantity", sa.Numeric(15, 3)),
    sa.Column("accepted_quantity", sa.Numeric(15, 3)),
    sa.Column("upload_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id", ondelete="SET NULL")),
    sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("raw", JSONB),
)

inspection_records = sa.Table(
    "inspection_records",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("pruef_datum", sa.Date, nullable=False),
    sa.Column("pruef_zeit", sa.Time),
    sa.Column("benutzer", sa.String(64)),
    sa.Column("fa", sa.String(50)),
    sa.Column("artikel", sa.String(50)),
    sa.Column("bezeichnung", sa.Text),
    sa.Column("buchungs_menge", sa.Numeric(15, 3)),
    sa.Column("ausschuss_menge", sa.Numeric(15, 3)),
    sa.Column("produktgruppe", sa.String(64)),
    sa.Column("typ", sa.String(10)),
    sa.Column("size_class", sa.String(10), nullable=False),
    sa.Column("rsc", sa.String(32)),
    sa.Column("excluded", sa.Boolean, nullable=False),
    sa.Column("upload_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id", ondelete="SET NULL")),
    sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("raw", JSONB),
)

material_movements = sa.Table(
    "material_movements",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("artikelnr", sa.String(50), nullable=False),
    sa.Column("article_name", sa.String(255)),
    sa.Column("buch_datum", sa.Date),
    sa.Column("bewegungsmenge", sa.Numeric(15, 3)),
    sa.Column("buchtyp", sa.String(10)),
    sa.Column("kommentar", sa.Text),
    sa.Column("upload_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id", ondelete="SET NULL")),
    sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("raw", JSONB),
)

stock_article_prices = sa.Table(
    "stock_article_prices",
    metadata,
    sa.Column("artnr", sa.String(50), primary_key=True),
    sa.Column("unit_price", sa.Numeric(15, 5), nullable=False),
    sa.Column("price_unit", sa.String(20)),
    sa.Column("article_name", sa.String(255)),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
)

# Die drei Quellen der Vertriebsaktivität. Getrennte Tabellen, weil die
# Exporte aus verschiedenen Ecken des ERP kommen und verschieden oft
# geliefert werden. Siehe Migration 0012.
sales_contacts = sa.Table(
    "sales_contacts",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("contact_date", sa.Date, nullable=False),
    sa.Column("employee_token", sa.String(64), nullable=False),
    sa.Column("contact_type", sa.String(16)),
    sa.Column("customer_group", sa.String(64)),
    sa.Column("status", sa.SmallInteger, nullable=False, server_default="0"),
    sa.Column("customer_name", sa.String(255)),
    sa.Column("comment", sa.Text),
    sa.Column("external_id", sa.String(50)),
    sa.Column("upload_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id", ondelete="SET NULL")),
    sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("raw", JSONB),
)

offers = sa.Table(
    "offers",
    metadata,
    sa.Column("vorgang_nr", sa.String(50), primary_key=True),
    sa.Column("datum", sa.Date, nullable=False),
    sa.Column("adr_nr", sa.String(50)),
    sa.Column("customer_name", sa.String(255)),
    sa.Column("ort", sa.String(128)),
    sa.Column("erfasser", sa.String(64)),
    sa.Column("wert_eur", sa.Numeric(15, 2), nullable=False),
    sa.Column("upload_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id", ondelete="SET NULL")),
    sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("raw", JSONB),
)

interessenten = sa.Table(
    "interessenten",
    metadata,
    sa.Column("adress_nr", sa.String(50), primary_key=True),
    sa.Column("customer_name", sa.String(255)),
    sa.Column("datum_save", sa.Date),
    sa.Column("upload_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id", ondelete="SET NULL")),
    sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("raw", JSONB),
)

# Personio-Stammdaten. Personenbezogen — die Zugriffsregeln in Migration 0013
# binden sie an das Recht `hr`, die Kennzahlenfunktionen geben nur Aggregate
# heraus und laufen deshalb mit `security definer`.
personio_employees = sa.Table(
    "personio_employees",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
    sa.Column("first_name", sa.String(128)),
    sa.Column("last_name", sa.String(128)),
    sa.Column("email", sa.String(255)),
    sa.Column("department", sa.String(128)),
    sa.Column("status", sa.String(32)),
    sa.Column("hire_date", sa.Date),
    sa.Column("termination_date", sa.Date),
    sa.Column("weekly_working_hours", sa.Numeric(6, 2)),
    sa.Column("raw_json", JSONB),
    sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
)

personio_attendance = sa.Table(
    "personio_attendance",
    metadata,
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("employee_id", sa.Integer, nullable=False),
    sa.Column("datum", sa.Date, nullable=False),
    sa.Column("start_time", sa.Time),
    sa.Column("end_time", sa.Time),
    sa.Column("break_minutes", sa.Integer, nullable=False, server_default="0"),
    sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
)

personio_absences = sa.Table(
    "personio_absences",
    metadata,
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("employee_id", sa.Integer, nullable=False),
    sa.Column("absence_type_id", sa.Integer),
    sa.Column("start_date", sa.Date, nullable=False),
    sa.Column("end_date", sa.Date, nullable=False),
    sa.Column("time_unit", sa.String(16)),
    sa.Column("hours", sa.Numeric(8, 2)),
    sa.Column("raw_json", JSONB),
    sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
)

TABLES = {
    "upload_batches": upload_batches,
    "revenues": revenues,
    "auftraege": auftraege,
    "delivery_reliability": delivery_reliability,
    "auftrag_positionen": auftrag_positionen,
    "delivery_records": delivery_records,
    "quality_records": quality_records,
    "goods_receipt_records": goods_receipt_records,
    "inspection_records": inspection_records,
    "material_movements": material_movements,
    "stock_article_prices": stock_article_prices,
    "sales_contacts": sales_contacts,
    "offers": offers,
    "interessenten": interessenten,
    "personio_employees": personio_employees,
    "personio_attendance": personio_attendance,
    "personio_absences": personio_absences,
}
