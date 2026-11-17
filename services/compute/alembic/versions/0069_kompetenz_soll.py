"""Das Soll: Profil, Einsatzplanung, Soll-Ist-Vergleich, Abdeckung.

Revision ID: 0069_kompetenz_soll
Revises: 0068_bereich_zuordnung
Create Date: 2026-09-30

Bisher stand nur das Ist (was eine Person kann). Jetzt kommt das Soll auf drei
Ebenen dazu:

* **Anforderungsprofil** (`kompetenz_profil`): je Aufgabenfamilie eine
  Soll-Stufe, entweder für den Bereich (Position leer) oder für eine Position.
* **Einsatzplanung** (`kompetenz_einsatz`): in welchen Bereichen wir die Person
  haben wollen (Haupt, zusätzlich, Vertretung).
* **Persönliches Ziel**: `kompetenz_bewertungen.soll_stufe` — weicht die
  Erwartung an genau diese Person ab.

Die Sicht `kompetenz_soll_ist` rechnet je Person und Aufgabenfamilie das
wirksame Soll: **persönliches Ziel** vor **Positionsprofil** vor
**Bereichsprofil**. Die Zielbereiche sind die aus der Einsatzplanung; hat die
Person keine, gilt ihr heutiger Bereich aus `person_bereich` — so hat auch ein
Neueintritt ohne Bewertung sofort ein Soll. Das Ist ist die Bewertung, ohne
Bewertung 0.

`kompetenz_abdeckung` stellt je Familie die Mindestbesetzung dem Bestand
gegenüber und trägt die Warnungen „niemand kann anlernen" (keine Stufe 3) und
„hängt an einer Person" (höchstens eine mit Stufe 2+).

Sehen mit `hr`, pflegen ab `hr: editor`.
"""
from alembic import op

revision = "0069_kompetenz_soll"
down_revision = "0068_bereich_zuordnung"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.kompetenz_profil (
    id            uuid primary key default gen_random_uuid(),
    familie_id    uuid not null references public.kompetenz_familien(id) on delete cascade,
    -- Leer: gilt für den ganzen Bereich. Gesetzt: nur für diese Position.
    position_norm varchar(200),
    soll_stufe    integer not null check (soll_stufe between 0 and 3)
);

create unique index kompetenz_profil_eindeutig
    on public.kompetenz_profil (familie_id, coalesce(position_norm, ''));

create table public.kompetenz_einsatz (
    id          uuid primary key default gen_random_uuid(),
    employee_id integer not null references public.personio_employees(id) on delete cascade,
    bereich_id  uuid not null references public.kompetenz_bereiche(id) on delete cascade,
    -- Wo wir die Person haben wollen: Haupt-, Zusatz- oder Vertretungsbereich.
    art         varchar(12) not null default 'haupt'
                check (art in ('haupt', 'zusatz', 'vertretung')),
    constraint kompetenz_einsatz_eindeutig unique (employee_id, bereich_id)
);

-- Wirksames Soll und Ist je Person und Aufgabenfamilie.
create view public.kompetenz_soll_ist with (security_invoker = true) as
with tb as (
    -- Zielbereiche: die Einsatzplanung, sonst der heutige Bereich.
    select employee_id, bereich_id from public.kompetenz_einsatz
    union
    select pb.employee_id, pb.bereich_id
    from public.person_bereich pb
    where pb.bereich_id is not null
      and not exists (
          select 1 from public.kompetenz_einsatz ke where ke.employee_id = pb.employee_id
      )
),
pos as (
    select e.id as employee_id,
           public.position_norm(e.raw_json #>> '{attributes,position,value}') as position_norm
    from public.personio_employees e
)
select tb.employee_id,
       f.id                       as familie_id,
       f.bereich_id,
       coalesce(bw.ist_stufe, 0)  as ist,
       coalesce(
           bw.soll_stufe,
           (select p.soll_stufe from public.kompetenz_profil p
             where p.familie_id = f.id and p.position_norm = pos.position_norm),
           (select p.soll_stufe from public.kompetenz_profil p
             where p.familie_id = f.id and p.position_norm is null)
       )                          as soll,
       case
           when coalesce(
                    bw.soll_stufe,
                    (select p.soll_stufe from public.kompetenz_profil p
                      where p.familie_id = f.id and p.position_norm = pos.position_norm),
                    (select p.soll_stufe from public.kompetenz_profil p
                      where p.familie_id = f.id and p.position_norm is null)
                ) > coalesce(bw.ist_stufe, 0)
           then coalesce(
                    bw.soll_stufe,
                    (select p.soll_stufe from public.kompetenz_profil p
                      where p.familie_id = f.id and p.position_norm = pos.position_norm),
                    (select p.soll_stufe from public.kompetenz_profil p
                      where p.familie_id = f.id and p.position_norm is null)
                ) - coalesce(bw.ist_stufe, 0)
           else 0
       end                        as luecke
from tb
join public.kompetenz_familien f on f.bereich_id = tb.bereich_id
join pos on pos.employee_id = tb.employee_id
left join public.kompetenz_bewertungen bw
       on bw.familie_id = f.id and bw.employee_id = tb.employee_id;

-- Mindestbesetzung gegen Bestand, mit den beiden Warnungen.
create view public.kompetenz_abdeckung with (security_invoker = true) as
select f.id                                                as familie_id,
       f.bereich_id,
       f.name,
       f.mindest_l2,
       f.mindest_l3,
       count(*) filter (where bw.ist_stufe >= 2)           as koennen_l2,
       count(*) filter (where bw.ist_stufe = 3)            as koennen_l3,
       count(*) filter (where bw.ist_stufe = 3) = 0        as kein_anlerner,
       count(*) filter (where bw.ist_stufe >= 2) <= 1      as haengt_an_einer_person
from public.kompetenz_familien f
left join public.kompetenz_bewertungen bw on bw.familie_id = f.id
group by f.id, f.bereich_id, f.name, f.mindest_l2, f.mindest_l3;

alter table public.kompetenz_profil enable row level security;
alter table public.kompetenz_einsatz enable row level security;

grant select on public.kompetenz_profil, public.kompetenz_einsatz,
                public.kompetenz_soll_ist, public.kompetenz_abdeckung to authenticated;
grant insert, update, delete on public.kompetenz_profil,
                public.kompetenz_einsatz to authenticated;

do $$
declare
    t text;
begin
    foreach t in array array['kompetenz_profil', 'kompetenz_einsatz']
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
drop view if exists public.kompetenz_abdeckung;
drop view if exists public.kompetenz_soll_ist;
drop table if exists public.kompetenz_einsatz;
drop table if exists public.kompetenz_profil;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
