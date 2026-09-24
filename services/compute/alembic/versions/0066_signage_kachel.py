"""Digital Signage als eigene App: Kachel und Rechtestufe.

Revision ID: 0066_signage_kachel
Revises: 0065_schulung_position
Create Date: 2026-09-24

Die Oberfläche unter `/signage` gibt es seit dem Signage-Port, und der
Web-Proxy verlangt dafür `apps.signage = admin`
(`apps/web/src/app/api/signage/[...path]/route.ts`). In `public.apps` stand die
App aber nie — der Seed aus 0001 kennt elf Kacheln, Signage ist keine davon.

Das hatte zwei Folgen: Auf dem Starter fehlte die Kachel, und weil
`app_grants.app_id` auf `apps.id` verweist, ließ sich die Stufe auch gar nicht
vergeben. Erreichbar war die Verwaltung nur für Plattform-Admins, denen der
Token-Hook überall `admin` gibt — für die Signage-Betreuung musste man also das
höchste Recht im ganzen System bekommen.

Sortierung 85: zwischen FAIR (80) und Uploads (90), bei den Fachmodulen.

Der Eintrag ist idempotent; die Rückrichtung nimmt ihn samt der daran
hängenden Zuweisungen wieder heraus (`on delete cascade` in `app_grants`).
"""
from alembic import op

revision = "0066_signage_kachel"
down_revision = "0065_schulung_position"
branch_labels = None
depends_on = None

UPGRADE = """
insert into public.apps (id, name, path, icon, sort)
values ('signage', 'Digital Signage', '/signage', 'monitor-play', 85)
on conflict (id) do update
    set name = excluded.name,
        path = excluded.path,
        icon = excluded.icon,
        sort = excluded.sort;
"""

DOWNGRADE = """
delete from public.apps where id = 'signage';
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
