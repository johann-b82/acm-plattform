"""Personal: Mitarbeitertabelle — Ist-Stunden und Überstunden je Person.

Revision ID: 0016_mitarbeitertabelle
Revises: 0015_wochenbericht
Create Date: 2026-09-10

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „Mitarbeitertabelle".

**Eine Abweichung, und sie ist groß.** Das Altprojekt rechnet die Tabelle
anders als die Kachel darüber: je Anwesenheitszeile statt je Tag, und mit
einem pauschalen Tagessoll von `weekly_working_hours / 5` statt mit dem
Arbeitszeitmodell. Auf denselben echten Daten über 90 Tage:

    Tabelle heute (je Segment, pauschal)      89,6 Std., 6 Personen
    Kachel daneben (je Tag, Modell)          926,3 Std.

Faktor zehn zwischen zwei Zahlen auf einer Seite. Der Grund ist derselbe wie
bei der Kachel vor `f4dd26b`: Personio liefert Vor- und Nachmittag getrennt,
und je Segment abgezogen verschwindet fast jede Überstunde. Bei 82,5 % der
Tage stehen mehrere Segmente.

Hier rechnet die Tabelle mit `hr_tagessoll` und Tagessummen — also genau wie
die Kachel. Die Summe über alle Zeilen ergibt damit die Zahl, die oben steht.

Zum Recht: die Tabelle trägt Namen neben Stunden. Im Altprojekt ist sie für
jeden Dashboard-Leser sichtbar; hier hängt sie an `hr` und damit an der
Berechtigung, die auch die Personenzeilen schützt. Ohne Gesundheitsdaten
reicht `hr:viewer` — anders als beim Wochenbericht, der `hr:admin` verlangt.
"""
from alembic import op

revision = "0016_mitarbeitertabelle"
down_revision = "0015_wochenbericht"
branch_labels = None
depends_on = None

UPGRADE = """
create or replace function public.kpi_hr_mitarbeiter(
    p_von date,
    p_bis date
)
returns table (
    employee_id  integer,
    name         text,
    department   varchar,
    ist_stunden  numeric,
    ueberstunden numeric,
    quote        numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
-- Ausgabespalten sind zugleich plpgsql-Variablen; ohne diese Zeile ist jedes
-- gleichnamige Spaltenzitat mehrdeutig.
#variable_conflict use_column
begin
    -- Namen neben Stunden: dieselbe Schranke wie fuer die Personenzeilen.
    if public.app_level('hr') is null then
        return;
    end if;

    return query
    with je_tag as (
        select t.employee_id,
               t.ist_stunden,
               greatest(
                   0,
                   t.ist_stunden
                   - public.hr_tagessoll(e.raw_json, e.weekly_working_hours, t.datum)
               ) as ueber
        from public.hr_ist_stunden_tag t
        join public.personio_employees e on e.id = t.employee_id
        where t.datum between p_von and p_bis
          and t.ist_stunden > 0
    ),
    je_person as (
        select employee_id,
               sum(ist_stunden) as ist,
               sum(ueber) as ueber
        from je_tag
        group by employee_id
    )
    select p.employee_id,
           nullif(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
           e.department,
           round(p.ist, 2),
           round(p.ueber, 2),
           -- Wie im Altprojekt: ohne Ueberstunden keine Quote, nicht null.
           case when p.ist > 0 and p.ueber > 0 then round(p.ueber / p.ist, 4) else null end
    from je_person p
    join public.personio_employees e on e.id = p.employee_id
    order by p.ueber desc, p.ist desc;
end;
$$;

grant execute on function public.kpi_hr_mitarbeiter(date, date) to authenticated;
"""

DOWNGRADE = """
drop function if exists public.kpi_hr_mitarbeiter(date, date);
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
