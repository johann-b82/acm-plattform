"""Schulungen: die Matrix — alle Personen gegen alle Schulungen.

Die Liste „was offen ist" deckt das Handeln ab: sie sagt, wer als Nächstes
dran ist. Die Matrix beantwortet die andere Frage, die im Audit gestellt wird:
**steht für jede Person und jede Pflichtschulung ein Datum?** Dafür muss auch
die leere Zeile sichtbar sein — jemand, der noch gar keine Teilnahme hat, ist
genau der Fall, den man sehen will.

Zwei Sichten, kein Pivot in SQL:

  `schulung_belegschaft`  wer in der Matrix eine Zeile bekommt
  `schulung_stand`        was in den Zellen steht (um den Personenschlüssel ergänzt)

Die Kreuztabelle selbst baut die Oberfläche. Ein Pivot in SQL bräuchte
dynamische Spalten (`crosstab`), also eine Spaltenliste, die sich bei jeder
neuen Schulung ändert — dafür ist die Menge viel zu klein.

**Drei Arten von Zeile, ein Schlüssel.** Personio-Personen (`e:<id>`), extern
gepflegte (`x:<uuid>`) und die Reste der Excel-Historie, die sich keiner
Person zuordnen ließen (`p:<personalnummer>`). Die dritte Art ist kein
Schönheitsfehler, sondern der Grund, warum beim Import nichts verworfen wird:
sonst verschwände Historie, weil eine Personalnummer nicht gepflegt ist.
"""
from alembic import op

revision = "0034_schulungsmatrix"
down_revision = "0033_zeugnisse"
branch_labels = None
depends_on = None

UPGRADE = """
-- `schulung_stand` bekommt den Personenschlüssel dazu, damit sich Zeile und
-- Zelle ohne zweite Abfrage zusammenfinden. Sichten kennen kein
-- `add column` — also neu bauen.
drop view public.schulung_stand;

create view public.schulung_stand
with (security_invoker = true) as
select t.id                                   as teilnahme_id,
       t.schulung_id,
       t.employee_id,
       t.extern_id,
       case
           when t.employee_id is not null then 'e:' || t.employee_id
           when t.extern_id is not null   then 'x:' || t.extern_id
           else 'p:' || t.personalnummer
       end                                    as schluessel,
       t.mitarbeiter_name,
       t.abteilung_kuerzel,
       k.bereich,
       k.name                                 as schulung,
       k.turnus_monate,
       t.aktuell_datum,
       case
           when t.aktuell_datum is not null and k.turnus_monate is not null
           then (t.aktuell_datum + make_interval(months => k.turnus_monate))::date
       end                                    as faellig_am,
       case
           when t.aktuell_datum is not null and k.turnus_monate is not null
           then (t.aktuell_datum + make_interval(months => k.turnus_monate))::date
                < current_date
           else false
       end                                    as ueberfaellig,
       t.aktuell_datum is null                as nie_absolviert
from public.schulung_teilnahmen t
join public.schulung_katalog k on k.id = t.schulung_id;

-- Wer eine Zeile bekommt. Ausgetretene nicht: ihre Historie bleibt in den
-- Teilnahmen stehen, aber in der Übersicht „wer ist geschult" haben sie
-- nichts verloren.
create view public.schulung_belegschaft
with (security_invoker = true) as
select 'e:' || e.id                                    as schluessel,
       e.id                                            as employee_id,
       null::uuid                                      as extern_id,
       null::text                                      as personalnummer,
       nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '')
           as name,
       e.department::text                              as abteilung,
       e.hire_date                                     as eintritt,
       'personio'::text                                as herkunft
from public.personio_employees e
where e.status in ('active', 'onboarding')

union all

select 'x:' || x.id,
       null::integer,
       x.id,
       null::text,
       x.name,
       x.abteilung::text,
       x.eintritt,
       'extern'::text
from public.externe_personen x

union all

-- Die Reste der Excel-Historie. `distinct on` nimmt je Personalnummer die
-- zuletzt geänderte Zeile: Name und Kürzel sind dort am ehesten gepflegt.
select *
from (
    select distinct on (t.personalnummer)
           'p:' || t.personalnummer                    as schluessel,
           null::integer                               as employee_id,
           null::uuid                                  as extern_id,
           t.personalnummer::text                      as personalnummer,
           coalesce(t.mitarbeiter_name, t.personalnummer)::text as name,
           t.abteilung_kuerzel::text                   as abteilung,
           null::date                                  as eintritt,
           'ohne_zuordnung'::text                      as herkunft
    from public.schulung_teilnahmen t
    where t.employee_id is null
      and t.extern_id is null
      and t.personalnummer is not null
    order by t.personalnummer, t.geaendert_am desc
) as reste;

grant select on public.schulung_stand, public.schulung_belegschaft to authenticated;
"""

DOWNGRADE = """
drop view public.schulung_belegschaft;
drop view public.schulung_stand;

create view public.schulung_stand
with (security_invoker = true) as
select t.id                                   as teilnahme_id,
       t.schulung_id,
       t.employee_id,
       t.extern_id,
       k.bereich,
       k.name                                 as schulung,
       k.turnus_monate,
       t.aktuell_datum,
       case
           when t.aktuell_datum is not null and k.turnus_monate is not null
           then (t.aktuell_datum + make_interval(months => k.turnus_monate))::date
       end                                    as faellig_am,
       case
           when t.aktuell_datum is not null and k.turnus_monate is not null
           then (t.aktuell_datum + make_interval(months => k.turnus_monate))::date
                < current_date
           else false
       end                                    as ueberfaellig,
       t.aktuell_datum is null                as nie_absolviert
from public.schulung_teilnahmen t
join public.schulung_katalog k on k.id = t.schulung_id;

grant select on public.schulung_stand to authenticated;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
