"""Organigramm: wer wem berichtet.

Eine Sicht, kein Endpunkt. Personio führt die Vorgesetzten-Kette ohnehin mit,
und der Abgleich legt sie als Rohdaten ab — es fehlt nur die Stelle, die sie
lesbar macht.

**Warum eine Sicht und nicht eine Spalte.** Eine Spalte `vorgesetzter_id` am
Mitarbeiter müsste der Abgleich pflegen und bei jeder Änderung nachziehen.
Solange die Kette in den Rohdaten steht, ist die Sicht immer aktuell — und
wenn Personio das Feld umbenennt, ist eine Sicht zu ändern und keine
Migration zu schreiben.

**Die Pfade sind tief, und das ist Personio.** Ein Vorgesetzter steht unter
`attributes.supervisor.value.attributes.id.value`, der Standort unter
`attributes.office.value.attributes.name`. Aus dem Altprojekt unverändert
übernommen: dort stehen dieselben Pfade, und sie sind an echten Daten geprüft.
"""
from alembic import op

revision = "0036_organigramm"
down_revision = "0035_dokumentenlauf"
branch_labels = None
depends_on = None

UPGRADE = """
create view public.organigramm
with (security_invoker = true) as
select e.id,
       nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '')
           as name,
       e.raw_json #>> '{attributes,position,value}'              as position,
       e.department,
       e.raw_json #>> '{attributes,office,value,attributes,name}' as standort,
       -- Die Kennung kommt als Zahl aus dem JSON; ein Text daneben wäre für
       -- den Verbund im Browser unbrauchbar.
       nullif(e.raw_json #>> '{attributes,supervisor,value,attributes,id,value}', '')::integer
           as vorgesetzter_id
from public.personio_employees e
where e.status = 'active';

grant select on public.organigramm to authenticated;
"""

DOWNGRADE = """
drop view if exists public.organigramm;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
