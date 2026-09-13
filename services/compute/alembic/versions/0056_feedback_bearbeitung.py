"""App Feedback: In Bearbeitung und zugewiesen.

Revision ID: 0056_feedback_bearbeitung
Revises: 0055_ad_konfiguration
Create Date: 2026-09-13

Zwischen offen und erledigt fehlte ein Zustand: jemand hat die Meldung
aufgenommen, fertig ist sie noch nicht. Und wer sich kuemmert, stand nirgends.

**Zugewiesen wird ein Konto, kein Name.** Wer Feedback abarbeitet, braucht
ohnehin einen Login mit Plattform-Verwaltung. Die Auswahl kommt aus
`plattform_nutzer` (Migration 0003), derselben Sicht wie die Zugaenge. Geht
das Konto, bleibt die Meldung stehen — nur ohne Zuweisung.

Rechte unveraendert: zuweisen ist bearbeiten, und bearbeiten darf die
Plattform-Verwaltung (`feedback_update`).
"""
from alembic import op

revision = "0056_feedback_bearbeitung"
down_revision = "0055_ad_konfiguration"
branch_labels = None
depends_on = None

UPGRADE = """
alter table public.feedback drop constraint feedback_status_check;
alter table public.feedback add constraint feedback_status_check
    check (status in ('neu', 'in_bearbeitung', 'erledigt'));

alter table public.feedback
    add column zugewiesen uuid references auth.users (id) on delete set null;

create index feedback_zugewiesen_idx on public.feedback (zugewiesen);
"""

DOWNGRADE = """
drop index if exists public.feedback_zugewiesen_idx;
alter table public.feedback drop column if exists zugewiesen;
-- Was in Bearbeitung war, ist danach wieder offen: der alte Check kennt den
-- Zustand nicht.
update public.feedback set status = 'neu' where status = 'in_bearbeitung';
alter table public.feedback drop constraint feedback_status_check;
alter table public.feedback add constraint feedback_status_check
    check (status in ('neu', 'erledigt'));
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
