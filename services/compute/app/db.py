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
from sqlalchemy.dialects.postgresql import JSONB, UUID
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

# Materialpreise (Wareneingang): dieselbe Datei wie `goods_receipt_records`,
# aber ein eigener Upload — die Preisquelle der Materialkostenquote.
material_prices = sa.Table(
    "material_prices",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("upload_batch_id", sa.Integer, sa.ForeignKey("upload_batches.id", ondelete="SET NULL")),
    sa.Column("vorgang_nr", sa.String(50), nullable=False),
    sa.Column("pos", sa.Integer, nullable=False),
    sa.Column("upos", sa.Integer, nullable=False, server_default="0"),
    sa.Column("typ", sa.String(10)),
    sa.Column("datum", sa.Date),
    sa.Column("artnr", sa.String(50), nullable=False),
    sa.Column("article_name", sa.String(255)),
    sa.Column("menge", sa.Numeric(15, 3)),
    sa.Column("unit", sa.String(20)),
    sa.Column("preis", sa.Numeric(15, 4)),
    sa.Column("pos_wert", sa.Numeric(15, 2)),
    sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("raw", JSONB),
    sa.UniqueConstraint("vorgang_nr", "pos", "upos", name="uq_material_prices_vorgang_pos"),
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

atr_teile = sa.Table(
    "atr_teile",
    metadata,
    sa.Column(
        "id",
        UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    ),
    sa.Column("teilenummer", sa.String(60), nullable=False),
    # Erzeugte Spalte — wird nie geschrieben, siehe Migration 0022.
    sa.Column("teilenummer_norm", sa.Text),
    sa.Column("lieferantennummer", sa.String(40)),
    sa.Column("bezeichnung", sa.String(200)),
    sa.Column("zeichnung", sa.String(60)),
    sa.Column("gewicht_kg", sa.Numeric(8, 3)),
    sa.Column("menge", sa.SmallInteger, nullable=False),
    sa.Column("kategorie", sa.String(40)),
    sa.Column("bestellposition", sa.String(20)),
    sa.Column("herkunft", sa.String(255)),
    sa.Column("erstellt_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

atr_vorlagen = sa.Table(
    "atr_vorlagen",
    metadata,
    sa.Column("programm", sa.String(20), primary_key=True),
    sa.Column("kunde", sa.String(200)),
    sa.Column("arbeitspaket", sa.Text),
    sa.Column("besteller_spez", sa.String(200)),
    sa.Column("atp", sa.String(200)),
    sa.Column("lieferanten_spez", sa.String(200)),
    sa.Column("referenz", sa.String(200)),
    sa.Column("lieferant", sa.String(200)),
    sa.Column("kunden_spez", sa.String(100)),
    sa.Column("nscm", sa.String(40)),
    sa.Column("ata_kapitel", sa.String(20)),
    sa.Column("waage", sa.String(100)),
    sa.Column("qs_unterschrift", sa.String(100)),
    sa.Column("geruest_pfad", sa.Text),
    sa.Column("geruest_dateiname", sa.String(255)),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

atr_lieferungen = sa.Table(
    "atr_lieferungen",
    metadata,
    sa.Column(
        "id",
        UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    ),
    sa.Column("quelle_dateiname", sa.String(255), nullable=False),
    sa.Column("lieferschein_nr", sa.String(40)),
    sa.Column("datum", sa.Date),
    sa.Column("ba_auftrag", sa.String(40)),
    sa.Column("bestellnummer", sa.String(60)),
    sa.Column("programm", sa.String(20)),
    sa.Column("programm_grund", sa.String(200)),
    sa.Column("bereich", sa.String(8)),
    sa.Column("msn", sa.String(20)),
    sa.Column("bettvariante", sa.String(8)),
    sa.Column("satz_titel", sa.String(100)),
    sa.Column("atr_nummer", sa.String(80)),
    sa.Column("containernummer", sa.String(40)),
    sa.Column("wiegedatum", sa.Date),
    sa.Column("pruefdatum", sa.Date),
    sa.Column("qs_unterschrift", sa.String(100)),
    sa.Column("max_gewicht_kg", sa.Numeric(8, 3)),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("hinweise", JSONB, nullable=False),
    sa.Column("mappe_pfad", sa.Text),
    sa.Column("pdf_pfad", sa.Text),
    sa.Column("etikett_pfad", sa.Text),
    sa.Column("erzeugt_am", sa.DateTime(timezone=True)),
    sa.Column("erstellt_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

atr_positionen = sa.Table(
    "atr_positionen",
    metadata,
    sa.Column(
        "id",
        UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    ),
    sa.Column("lieferung_id", UUID(as_uuid=True), nullable=False),
    sa.Column("reihenfolge", sa.SmallInteger, nullable=False),
    sa.Column("pos", sa.SmallInteger),
    sa.Column("lieferantennummer", sa.String(40)),
    sa.Column("teilenummer", sa.String(60)),
    sa.Column("teilenummer_norm", sa.Text),
    sa.Column("teil_id", UUID(as_uuid=True)),
    sa.Column("bezeichnung", sa.String(200)),
    sa.Column("zeichnung", sa.String(60)),
    sa.Column("kategorie", sa.String(40)),
    sa.Column("menge", sa.SmallInteger, nullable=False),
    sa.Column("gewicht_kg", sa.Numeric(8, 3)),
    sa.Column("bestellposition", sa.String(20)),
    sa.Column("seriennummern", sa.ARRAY(sa.Text), nullable=False),
    sa.Column("erstellt_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

atr_scan = sa.Table(
    "atr_scan",
    metadata,
    sa.Column("id", sa.Boolean, primary_key=True),
    sa.Column("modus", sa.String(16), nullable=False),
    sa.Column("rechner", sa.String(255)),
    sa.Column("freigabe", sa.String(255)),
    sa.Column("domaene", sa.String(64)),
    sa.Column("benutzer", sa.String(128)),
    sa.Column("eingang", sa.String(500)),
    sa.Column("ausgang", sa.String(500)),
    sa.Column("archiv", sa.String(500)),
    sa.Column("zuletzt_am", sa.DateTime(timezone=True)),
    sa.Column("zuletzt_text", sa.Text),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("intervall_s", sa.Integer, nullable=False),
    sa.Column("angestossen_am", sa.DateTime(timezone=True)),
    sa.Column("lauf_seit", sa.DateTime(timezone=True)),
)

sensoren = sa.Table(
    "sensoren",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("name", sa.String(100), nullable=False, unique=True),
    sa.Column("rechner", sa.String(255), nullable=False),
    sa.Column("port", sa.Integer, nullable=False),
    sa.Column("community", sa.LargeBinary, nullable=False),
    sa.Column("temperatur_oid", sa.String(255)),
    sa.Column("feuchte_oid", sa.String(255)),
    sa.Column("temperatur_faktor", sa.Numeric(10, 4), nullable=False),
    sa.Column("feuchte_faktor", sa.Numeric(10, 4), nullable=False),
    sa.Column("temperatur_min", sa.Numeric(8, 3)),
    sa.Column("temperatur_max", sa.Numeric(8, 3)),
    sa.Column("feuchte_min", sa.Numeric(8, 3)),
    sa.Column("feuchte_max", sa.Numeric(8, 3)),
    sa.Column("aktiv", sa.Boolean, nullable=False),
    sa.Column("farbe", sa.String(7)),
    sa.Column("erstellt_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

sensor_messungen = sa.Table(
    "sensor_messungen",
    metadata,
    sa.Column("id", sa.BigInteger, primary_key=True),
    sa.Column("sensor_id", UUID(as_uuid=False), nullable=False),
    sa.Column("gemessen_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("temperatur", sa.Numeric(8, 3)),
    sa.Column("feuchte", sa.Numeric(8, 3)),
)

sensor_versuche = sa.Table(
    "sensor_versuche",
    metadata,
    sa.Column("id", sa.BigInteger, primary_key=True),
    sa.Column("sensor_id", UUID(as_uuid=False), nullable=False),
    sa.Column("versucht_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("erfolg", sa.Boolean, nullable=False),
    sa.Column("fehler", sa.String(200)),
)

maschinen = sa.Table(
    "maschinen",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("name", sa.String(255), nullable=False),
    sa.Column("inventarnummer", sa.String(64)),
    sa.Column("standort", sa.String(255)),
    sa.Column("hersteller", sa.String(255)),
    sa.Column("modell", sa.String(255)),
    sa.Column("verantwortlich", sa.String(255)),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("notizen", sa.Text, nullable=False),
    sa.Column("erstellt_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

wartungsaufgaben = sa.Table(
    "wartungsaufgaben",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("maschine_id", UUID(as_uuid=False), nullable=False),
    sa.Column("titel", sa.String(255), nullable=False),
    sa.Column("anleitung", sa.Text, nullable=False),
    sa.Column("intervall", sa.String(16), nullable=False),
    sa.Column("wochen", sa.Integer),
    sa.Column("erstellt_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

wartungsdateien = sa.Table(
    "wartungsdateien",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("maschine_id", UUID(as_uuid=False), nullable=False),
    sa.Column("art", sa.String(16), nullable=False),
    sa.Column("pfad", sa.Text, nullable=False),
    sa.Column("dateiname", sa.String(255), nullable=False),
    sa.Column("mime", sa.String(127)),
    sa.Column("hochgeladen_am", sa.DateTime(timezone=True), nullable=False),
)

kompetenz_matrizen = sa.Table(
    "kompetenz_matrizen",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("bereich", sa.String(30), nullable=False),
    sa.Column("blatt", sa.String(120), nullable=False),
    sa.Column("titel", sa.Text),
    sa.Column("stand", sa.Date),
    sa.Column("dateiname", sa.Text, nullable=False),
    sa.Column("importiert_am", sa.DateTime(timezone=True), nullable=False),
)

kompetenz_kategorien = sa.Table(
    "kompetenz_kategorien",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("matrix_id", UUID(as_uuid=False), nullable=False),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("reihenfolge", sa.Integer, nullable=False),
)

kompetenz_qualifikationen = sa.Table(
    "kompetenz_qualifikationen",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("matrix_id", UUID(as_uuid=False), nullable=False),
    sa.Column("nr", sa.Integer),
    sa.Column("kategorie", sa.Text),
    sa.Column("bezeichnung", sa.Text, nullable=False),
    sa.Column("reihenfolge", sa.Integer, nullable=False),
)

kompetenz_personen = sa.Table(
    "kompetenz_personen",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("matrix_id", UUID(as_uuid=False), nullable=False),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("employee_id", sa.Integer),
    sa.Column("reihenfolge", sa.Integer, nullable=False),
)

kompetenz_bewertungen = sa.Table(
    "kompetenz_bewertungen",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("qualifikation_id", UUID(as_uuid=False), nullable=False),
    sa.Column("person_id", UUID(as_uuid=False), nullable=False),
    sa.Column("anforderungslevel", sa.Integer),
    sa.Column("erfuellungsgrad", sa.Integer),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

externe_personen = sa.Table(
    "externe_personen",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("abteilung", sa.Text),
    sa.Column("position", sa.Text),
    sa.Column("eintritt", sa.Date),
    sa.Column("angelegt_am", sa.DateTime(timezone=True), nullable=False),
)

schulung_katalog = sa.Table(
    "schulung_katalog",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("bereich", sa.String(50), nullable=False),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("turnus", sa.String(80)),
    sa.Column("turnus_monate", sa.Integer),
    sa.Column("frist_tage", sa.Integer),
    sa.Column("verantwortlicher", sa.Text),
    sa.Column("beschreibung", sa.Text),
    sa.Column("sortierung", sa.Integer, nullable=False),
    sa.Column("aktiv", sa.Boolean, nullable=False),
)

schulung_pflicht = sa.Table(
    "schulung_pflicht",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("schulung_id", UUID(as_uuid=False), nullable=False),
    sa.Column("ebene", sa.String(20), nullable=False),
    sa.Column("abteilung", sa.String(80), nullable=False),
)

schulung_rollen = sa.Table(
    "schulung_rollen",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("position", sa.Text, nullable=False),
    sa.Column("position_norm", sa.String(200), nullable=False),
    sa.Column("abteilung_kuerzel", sa.String(30), nullable=False),
)

schulung_importe = sa.Table(
    "schulung_importe",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("dateiname", sa.Text, nullable=False),
    sa.Column("importiert_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("schulungen", sa.Integer, nullable=False),
    sa.Column("teilnahmen", sa.Integer, nullable=False),
    sa.Column("nicht_zugeordnet", sa.Integer, nullable=False),
    sa.Column("notiz", sa.Text),
)

schulung_teilnahmen = sa.Table(
    "schulung_teilnahmen",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("schulung_id", UUID(as_uuid=False), nullable=False),
    sa.Column("employee_id", sa.Integer),
    sa.Column("extern_id", UUID(as_uuid=False)),
    sa.Column("personalnummer", sa.String(30)),
    sa.Column("mitarbeiter_name", sa.Text),
    sa.Column("abteilung_kuerzel", sa.String(30)),
    sa.Column("initial_datum", sa.Date),
    sa.Column("aktuell_datum", sa.Date),
    sa.Column("naechste_faellig", sa.String(30)),
    sa.Column("import_id", UUID(as_uuid=False)),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

onboarding_abteilung = sa.Table(
    "onboarding_abteilung",
    metadata,
    sa.Column("employee_id", sa.Integer, primary_key=True),
    sa.Column("abteilung", sa.Text, nullable=False),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

# Vermerk, dass das Onboarding-Paket ausgeliefert wurde. Das entfernt die
# „neu"-Markierung in der Eintrittsliste — eine Übergabe, die stattgefunden
# hat, soll nicht weiter als offen dastehen.
onboarding_paket = sa.Table(
    "onboarding_paket",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("employee_id", sa.Integer),
    sa.Column("extern_id", UUID(as_uuid=False)),
    sa.Column("heruntergeladen_am", sa.DateTime(timezone=True), nullable=False),
)

# Der Dokumentenlauf: ein Blatt, sein Weg und das Prüfergebnis.
dokumentvorgaenge = sa.Table(
    "dokumentvorgaenge",
    metadata,
    sa.Column(
        "id",
        UUID(as_uuid=False),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    ),
    sa.Column("art", sa.String(20), nullable=False),
    sa.Column("doc_uid", sa.String(32), nullable=False),
    sa.Column("employee_id", sa.Integer),
    sa.Column("extern_id", UUID(as_uuid=False)),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("funktion", sa.Text),
    sa.Column("beginn", sa.Date),
    sa.Column("inhalt", JSONB),
    sa.Column("pdf_pfad", sa.Text),
    sa.Column("scan_pfad", sa.Text),
    sa.Column("feld_layout", JSONB),
    sa.Column("status", sa.String(20), nullable=False),
    sa.Column("erstellt_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("uebergeben_am", sa.DateTime(timezone=True)),
    sa.Column("zurueck_am", sa.DateTime(timezone=True)),
    sa.Column("geprueft_am", sa.DateTime(timezone=True)),
    sa.Column("pruef_ergebnis", JSONB),
    sa.Column("vollstaendig", sa.Boolean),
    sa.Column("kommentar", sa.Text),
)

dokument_nachweise = sa.Table(
    "dokument_nachweise",
    metadata,
    sa.Column(
        "id",
        UUID(as_uuid=False),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    ),
    sa.Column("vorgang_id", UUID(as_uuid=False), nullable=False),
    sa.Column("zeile", sa.Text),
    sa.Column("pfad", sa.Text, nullable=False),
    sa.Column("dateiname", sa.Text, nullable=False),
    sa.Column("hochgeladen_am", sa.DateTime(timezone=True), nullable=False),
)

schulung_unterlagen = sa.Table(
    "schulung_unterlagen",
    metadata,
    sa.Column(
        "id",
        UUID(as_uuid=False),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    ),
    sa.Column("schulung_id", UUID(as_uuid=False), nullable=False),
    sa.Column("pfad", sa.Text, nullable=False),
    sa.Column("dateiname", sa.Text, nullable=False),
    sa.Column("hochgeladen_am", sa.DateTime(timezone=True), nullable=False),
)

einarbeitung_katalog = sa.Table(
    "einarbeitung_katalog",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("inhalt", sa.Text, nullable=False),
    sa.Column("ansprechpartner", sa.Text),
    sa.Column("bereich", sa.Text),
    sa.Column("reihenfolge", sa.Integer, nullable=False),
    sa.Column("erstellt_am", sa.DateTime(timezone=True), nullable=False),
)

einarbeitung_pflicht = sa.Table(
    "einarbeitung_pflicht",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("einarbeitung_id", UUID(as_uuid=False), nullable=False),
    sa.Column("abteilung", sa.String(120), nullable=False),
)

plattform_logo = sa.Table(
    "plattform_logo",
    metadata,
    sa.Column("id", sa.Boolean, primary_key=True),
    sa.Column("pfad", sa.Text),
    sa.Column("dateiname", sa.Text),
    sa.Column("mime", sa.String(64)),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
    # Das PNG für die Formblätter, wenn das Logo ein SVG ist; sonst dieselbe
    # Datei wie `pfad`.
    sa.Column("raster_pfad", sa.Text),
)

plattform_einstellungen = sa.Table(
    "plattform_einstellungen",
    metadata,
    sa.Column("id", sa.Boolean, primary_key=True),
    sa.Column("tabellen_seitengroesse", sa.Integer, nullable=False),
    sa.Column("app_name", sa.String(60), nullable=False),
    sa.Column("farben", JSONB),
    sa.Column("personio_sync_intervall_h", sa.Integer, nullable=False),
    sa.Column("personio_nachweis_aktiv", sa.Boolean, nullable=False),
    sa.Column("personio_nachweis_kategorie", sa.String(64)),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

personio_nachweise = sa.Table(
    "personio_nachweise",
    metadata,
    sa.Column("id", sa.BigInteger, primary_key=True),
    sa.Column("employee_id", sa.Integer, nullable=False),
    sa.Column("art", sa.String(16), nullable=False),
    sa.Column("angelegt_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("erledigt_am", sa.DateTime(timezone=True)),
    sa.Column("versuche", sa.Integer, nullable=False),
    sa.Column("fehler", sa.Text),
    sa.Column("inhalt_hash", sa.String(64)),
)

email_einstellungen = sa.Table(
    "email_einstellungen",
    metadata,
    sa.Column("id", sa.Boolean, primary_key=True),
    sa.Column("aktiv", sa.Boolean, nullable=False),
    sa.Column("modus", sa.String(16), nullable=False),
    sa.Column("tenant_id", sa.String(64)),
    sa.Column("client_id", sa.String(64)),
    sa.Column("absender", sa.String(254)),
    sa.Column("absender_name", sa.String(120)),
    sa.Column("delegiert_konto", sa.String(254)),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("geaendert_von", UUID(as_uuid=False)),
)

zeugnis_aussteller = sa.Table(
    "zeugnis_aussteller",
    metadata,
    sa.Column("id", sa.Boolean, primary_key=True),
    sa.Column("firma", sa.Text, nullable=False),
    sa.Column("standort", sa.Text),
    sa.Column("unterzeichner1_name", sa.Text),
    sa.Column("unterzeichner1_titel", sa.Text),
    sa.Column("unterzeichner2_name", sa.Text),
    sa.Column("unterzeichner2_titel", sa.Text),
    sa.Column("hr_employee_id", sa.Integer),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

zeugnisse = sa.Table(
    "zeugnisse",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("employee_id", sa.Integer),
    sa.Column("extern_id", UUID(as_uuid=False)),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("geschlecht", sa.String(1)),
    sa.Column("geburtsdatum", sa.Date),
    sa.Column("personalnummer", sa.Text),
    sa.Column("abteilung", sa.Text),
    sa.Column("taetigkeit", sa.Text),
    sa.Column("eintritt", sa.Date),
    sa.Column("austritt", sa.Date),
    sa.Column("art", sa.String(20), nullable=False),
    sa.Column("anlass", sa.Text),
    sa.Column("fuehrungskraft", sa.Boolean, nullable=False),
    sa.Column("ausstellungsdatum", sa.Date),
    sa.Column("taetigkeit_stichpunkte", sa.Text),
    sa.Column("besondere_kompetenzen", sa.Text),
    sa.Column("besondere_erfolge", sa.Text),
    sa.Column("schlussnote", sa.Numeric(2, 1)),
    sa.Column("abschnitte", JSONB),
    sa.Column("status", sa.String(20), nullable=False),
    sa.Column("erstellt_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

zeugnis_bewertungen = sa.Table(
    "zeugnis_bewertungen",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("zeugnis_id", UUID(as_uuid=False), nullable=False),
    sa.Column("dimension", sa.String(30), nullable=False),
    sa.Column("note", sa.Integer, nullable=False),
)

zeugnis_notenvorlagen = sa.Table(
    "zeugnis_notenvorlagen",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("noten", JSONB, nullable=False),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

zeugnis_bausteine = sa.Table(
    "zeugnis_bausteine",
    metadata,
    sa.Column("id", UUID(as_uuid=False), primary_key=True),
    sa.Column("dimension", sa.String(30), nullable=False),
    sa.Column("note", sa.Integer, nullable=False),
    sa.Column("text", sa.Text, nullable=False),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
)

geheimnisse = sa.Table(
    "geheimnisse",
    metadata,
    sa.Column("schluessel", sa.String(64), primary_key=True),
    sa.Column("geheimtext", sa.LargeBinary, nullable=False),
    sa.Column("geaendert_am", sa.DateTime(timezone=True), nullable=False),
    sa.Column("geaendert_von", UUID(as_uuid=False)),
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
    "material_prices": material_prices,
    "stock_article_prices": stock_article_prices,
    "sales_contacts": sales_contacts,
    "offers": offers,
    "interessenten": interessenten,
    "personio_employees": personio_employees,
    "personio_attendance": personio_attendance,
    "personio_absences": personio_absences,
    "atr_teile": atr_teile,
    "atr_vorlagen": atr_vorlagen,
    "atr_lieferungen": atr_lieferungen,
    "atr_positionen": atr_positionen,
    "atr_scan": atr_scan,
    "sensoren": sensoren,
    "sensor_messungen": sensor_messungen,
    "sensor_versuche": sensor_versuche,
    "maschinen": maschinen,
    "wartungsaufgaben": wartungsaufgaben,
    "wartungsdateien": wartungsdateien,
    "kompetenz_matrizen": kompetenz_matrizen,
    "kompetenz_kategorien": kompetenz_kategorien,
    "kompetenz_qualifikationen": kompetenz_qualifikationen,
    "kompetenz_personen": kompetenz_personen,
    "kompetenz_bewertungen": kompetenz_bewertungen,
    "externe_personen": externe_personen,
    "schulung_katalog": schulung_katalog,
    "schulung_pflicht": schulung_pflicht,
    "schulung_rollen": schulung_rollen,
    "schulung_importe": schulung_importe,
    "schulung_teilnahmen": schulung_teilnahmen,
    "einarbeitung_katalog": einarbeitung_katalog,
    "einarbeitung_pflicht": einarbeitung_pflicht,
    "plattform_logo": plattform_logo,
    "onboarding_abteilung": onboarding_abteilung,
    "onboarding_paket": onboarding_paket,
    "dokumentvorgaenge": dokumentvorgaenge,
    "dokument_nachweise": dokument_nachweise,
    "schulung_unterlagen": schulung_unterlagen,
    "zeugnis_aussteller": zeugnis_aussteller,
    "zeugnisse": zeugnisse,
    "zeugnis_bewertungen": zeugnis_bewertungen,
    "zeugnis_notenvorlagen": zeugnis_notenvorlagen,
    "zeugnis_bausteine": zeugnis_bausteine,
    "geheimnisse": geheimnisse,
}
