"""Zwei Alembic-Heads zusammenführen (kein Schemawechsel).

Revision ID: 0071_heads_zusammenfuehren
Revises: 0068_odbc_worker_steuerung, 0070_einarbeitung_serie
Create Date: 2026-11-22

Seit dem Merge vom 17.11. zweigen von `0066_signage_kachel` zwei Ketten ab:
Kompetenzen/Einarbeitung (`0067_kompetenz_stufen` … `0070_einarbeitung_serie`) und
ODBC-Datenquelle (`0067_odbc_datenquelle`, `0068_odbc_worker_steuerung`). Mit zwei
Heads scheitert `alembic upgrade head` (Compose-Dienst `migrate`, CI). Beide Ketten
berühren getrennte Tabellen; diese Revision vereint sie nur, damit es wieder genau
einen Head gibt. Eine Datenbank auf einem der beiden Stände holt die fehlende Kette
nach und landet hier.
"""

revision = "0071_heads_zusammenfuehren"
down_revision = ("0068_odbc_worker_steuerung", "0070_einarbeitung_serie")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
