"""Der Bereich Personal heißt sichtbar „HR“ (NAV-06).

Revision ID: 0040_bereich_hr
Revises: 0039_plattform_einstellungen
Create Date: 2026-09-12

Nur der Name der App-Kachel. Kennung `hr`, Rechte und Adressen bleiben;
Fachbegriffe wie Personalkosten sind davon nicht betroffen.
"""
from alembic import op

revision = "0040_bereich_hr"
down_revision = "0039_plattform_einstellungen"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("update public.apps set name = 'HR' where id = 'hr'")


def downgrade() -> None:
    op.execute("update public.apps set name = 'Personal' where id = 'hr'")
