"""Datenstand: wann kam die Datei, auf der diese Zahl steht.

Eine Kennzahl ohne ihr Datum ist eine Aussage über einen unbekannten Tag. Die
Dashboards rechnen auf hochgeladenen ERP-Auszügen; steht der letzte Auszug
seit drei Wochen, steht die Zahl seit drei Wochen.

**Warum eine eigene Sicht.** `upload_batches` darf nur lesen, wer ein Recht auf
*Uploads* hat — dort stehen Dateinamen, Fehlerzahlen und wer hochgeladen hat.
Das Datum selbst ist für jede Person nötig, die die Zahl liest, und für sich
genommen harmlos: es sagt „der Umsatzauszug ist vom 9. September" und sonst
nichts.

Deshalb läuft diese Sicht **mit den Rechten ihres Eigentümers**
(`security_invoker = false`, die Vorgabe) und gibt genau drei Spalten heraus.
Der übliche Weg im Haus ist `security_invoker = true`; hier ist die Ausnahme
der Zweck: die Sicht ist die Rechteprüfung, weil sie weniger zeigt als die
Tabelle darunter.

**Fehlgeschlagene Läufe zählen nicht.** Ein Upload, der an der ersten Zeile
abgebrochen ist, hat nichts eingespielt — als Datenstand gezählt würde er
Frische vortäuschen, die es nicht gibt.
"""
from alembic import op

revision = "0037_datenstand"
down_revision = "0036_organigramm"
branch_labels = None
depends_on = None

UPGRADE = """
create view public.datenstand as
select b.kind                 as art,
       max(b.uploaded_at)     as zuletzt,
       count(*)               as laeufe
from public.upload_batches b
where b.status <> 'failed'
group by b.kind;

grant select on public.datenstand to authenticated;
"""

DOWNGRADE = """
drop view if exists public.datenstand;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
