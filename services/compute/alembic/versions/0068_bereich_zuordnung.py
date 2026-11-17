"""Bereich-Zuordnung: wo eine Person heute arbeitet.

Revision ID: 0068_bereich_zuordnung
Revises: 0067_kompetenz_stufen
Create Date: 2026-09-30

Ein Personio-Team gehört nicht immer zu genau einem Bereich, und QS wie Versand
sind in Personio eigene Abteilungen ohne Team. Deshalb der Schlüssel
**(Abteilung + Team)**, das Team darf leer sein — dann gilt die Zuordnung für
die ganze Abteilung. Eine **Abweichung je Person** schlägt die Standardzuordnung
(Fall „Cutting": dasselbe Team arbeitet teils am Cutter, teils im Handzuschnitt).

Die Sicht `person_bereich` rechnet je aktiver Person den wirksamen Bereich:
Personen-Abweichung vor team-genauer Zuordnung vor Abteilungs-Zuordnung. Sie
zeigt nur Personen aus Abteilungen, für die es überhaupt eine Zuordnung gibt —
sonst stünde die halbe Verwaltung als „nicht zugeordnet" darin. Bleibt der
Bereich leer, ist die Person in einer erfassten Abteilung noch offen.

Startwerte aus den Personio-Livedaten (Stand 2026-09-30). Das Team steckt in den
Rohdaten unter `attributes → team → value → attributes → name`.

Sehen mit `hr`, pflegen ab `hr: editor`.
"""
from alembic import op

revision = "0068_bereich_zuordnung"
down_revision = "0067_kompetenz_stufen"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.bereich_zuordnung (
    id          uuid primary key default gen_random_uuid(),
    abteilung   text not null,
    -- Leer heißt: gilt für die ganze Abteilung (QS, Versand).
    team        text,
    bereich_id  uuid not null references public.kompetenz_bereiche(id) on delete cascade
);

-- Je (Abteilung, Team) genau eine Zuordnung; ein leeres Team ist ein eigener
-- Schlüsselwert.
create unique index bereich_zuordnung_eindeutig
    on public.bereich_zuordnung (abteilung, coalesce(team, ''));

create table public.bereich_zuordnung_person (
    employee_id integer primary key references public.personio_employees(id) on delete cascade,
    bereich_id  uuid not null references public.kompetenz_bereiche(id) on delete cascade
);

-- Die Bereiche der Produktion samt QS und Versand. Aufgabenfamilien füllt der
-- Interview-Import (Stufe D); hier entstehen die Bereiche, damit die Zuordnung
-- ein Ziel hat.
insert into public.kompetenz_bereiche (name, abteilung, reihenfolge) values
    ('Teppich',            'Production',         1),
    ('Wandverkleidung',    'Production',         2),
    ('Zuschnitt Hand',     'Production',         3),
    ('Cutter',             'Production',         4),
    ('Näherei',            'Production',         5),
    ('Schäumerei',         'Production',         6),
    ('Montage Bezieherei', 'Production',         7),
    ('Bemusterung',        'Production',         8),
    ('QS',                 'Quality Assurance',  9),
    ('Versand',            'Logistics',         10)
on conflict (name) do nothing;

insert into public.bereich_zuordnung (abteilung, team, bereich_id)
select v.abteilung, v.team, b.id
from (values
    ('Production',        'Carpets',              'Teppich'),
    ('Production',        '2nd Lining A350',      'Wandverkleidung'),
    ('Production',        'Cutting',              'Cutter'),
    ('Production',        'Sewing',               'Näherei'),
    ('Production',        'Foam',                 'Schäumerei'),
    ('Production',        'Assembly & Upholstery','Montage Bezieherei'),
    ('Production',        'Prototyping & Sampling','Bemusterung'),
    ('Quality Assurance', null,                   'QS'),
    ('Logistics',         null,                   'Versand')
) as v(abteilung, team, bereich_name)
join public.kompetenz_bereiche b on b.name = v.bereich_name;

create view public.person_bereich with (security_invoker = true) as
with ma as (
    select e.id                                                          as employee_id,
           e.department                                                  as abteilung,
           e.raw_json->'attributes'->'team'->'value'->'attributes'->>'name' as team
    from public.personio_employees e
    where e.status = 'active'
)
select ma.employee_id,
       ma.abteilung,
       ma.team,
       coalesce(bp.bereich_id, z.bereich_id) as bereich_id
from ma
left join public.bereich_zuordnung_person bp on bp.employee_id = ma.employee_id
left join lateral (
    -- Team-genau vor Abteilungs-weit (team is null).
    select zz.bereich_id
    from public.bereich_zuordnung zz
    where zz.abteilung = ma.abteilung
      and (zz.team is null or zz.team = ma.team)
    order by (zz.team is not null) desc
    limit 1
) z on true
where bp.employee_id is not null
   or exists (select 1 from public.bereich_zuordnung z3 where z3.abteilung = ma.abteilung);

alter table public.bereich_zuordnung enable row level security;
alter table public.bereich_zuordnung_person enable row level security;

grant select on public.bereich_zuordnung, public.bereich_zuordnung_person,
                public.person_bereich to authenticated;
grant insert, update, delete on public.bereich_zuordnung,
                public.bereich_zuordnung_person to authenticated;

do $$
declare
    t text;
begin
    foreach t in array array['bereich_zuordnung', 'bereich_zuordnung_person']
    loop
        execute format(
            'create policy %I on public.%I for select to authenticated '
            'using (public.app_level(''hr'') is not null)', t || '_lesen', t);
        execute format(
            'create policy %I on public.%I for all to authenticated '
            'using (public.app_mindestens(''hr'', ''editor'')) '
            'with check (public.app_mindestens(''hr'', ''editor''))',
            t || '_pflegen', t);
    end loop;
end;
$$;
"""

DOWNGRADE = """
drop view if exists public.person_bereich;
drop table if exists public.bereich_zuordnung_person;
drop table if exists public.bereich_zuordnung;
-- Die in dieser Migration angelegten Bereiche wieder heraus (nur, solange sie
-- keine Aufgabenfamilien tragen — sonst gehören sie schon dem Fachbereich).
delete from public.kompetenz_bereiche b
where b.name in ('Teppich', 'Wandverkleidung', 'Zuschnitt Hand', 'Cutter',
                 'Näherei', 'Schäumerei', 'Montage Bezieherei', 'Bemusterung',
                 'QS', 'Versand')
  and not exists (select 1 from public.kompetenz_familien f where f.bereich_id = b.id);
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
