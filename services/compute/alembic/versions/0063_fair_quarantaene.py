"""FAIR: Quarantäne für fehlplatzierte Nicht-Zeichnungen.

Revision ID: 0063_fair_quarantaene
Revises: 0062_datenstand_teilweise
Create Date: 2026-09-20

Eine Datei, die keine Zeichnung ist (etwa ein Logo-PDF ohne Kunde und
Teilenummer), soll nicht als FAIR-Zeichnung erscheinen — aber auch nicht
unprotokolliert gelöscht werden. Statt einer harten Löschung bekommt die Zeile
zwei Spalten: `quarantaene_am` und `quarantaene_grund`. Eine quarantänierte
Zeile bleibt samt ihren Ballons und Prüfmaßen erhalten (nichts geht verloren),
verschwindet aber aus der Zeichnungsliste. Das lässt sich jederzeit umkehren
(`quarantaene_am` zurück auf `null`).
"""
from alembic import op

revision = "0063_fair_quarantaene"
down_revision = "0062_datenstand_teilweise"
branch_labels = None
depends_on = None

UPGRADE = """
alter table public.fair_zeichnungen
    add column if not exists quarantaene_am    timestamptz,
    add column if not exists quarantaene_grund text;

comment on column public.fair_zeichnungen.quarantaene_am is
    'Gesetzt: aus FAIR ausgeblendet (Fehlablage), Zeile und Prüfmaße bleiben erhalten.';
"""

DOWNGRADE = """
alter table public.fair_zeichnungen
    drop column if exists quarantaene_grund,
    drop column if exists quarantaene_am;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
