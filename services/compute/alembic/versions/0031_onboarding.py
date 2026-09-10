"""Onboarding: Eintritte und ihr abgeleiteter Schulungsplan.

Revision ID: 0031_onboarding
Revises: 0030_schulungen
Create Date: 2026-09-10

Wer neu ist, braucht Schulungen — welche, sagt die Anforderungsmatrix. Dieses
Modul stellt Soll und Ist nebeneinander und legt die fehlenden Zeilen an.

**Die Ableitung steht in der Datenbank, nicht im Dienst.** Im Altprojekt
rechnet ein Python-Service Matrix, Rollenzuordnung und Bestand zusammen. Alle
drei sind Tabellen; das ist ein Verbund und kein Programm. Die Funktion
`public.schulungsplan(...)` gibt Soll und Ist als Zeilen zurück — damit kommt
auch die Oberfläche ohne eigene Route daran.

**Die feine Ebene meldet sich, wenn sie nicht greift.** Die Matrix kennt zwei
Ebenen: Personios grobe Abteilung und das feine Kürzel aus der Excel. Das
Kürzel hängt an der Position, und Personio schreibt Positionen uneinheitlich.
Fehlt die Zuordnung, entstünden **zu wenige** Pflichtschulungen — deshalb
liefert die Funktion eine eigene Zeile „Kürzel fehlt" statt still weniger
Ergebnisse.

**Die Abteilung lässt sich überschreiben.** Personio ist nur lesbar, und nicht
jede Person hat dort eine Abteilung. Die Übersteuerung steht hier, greift aber
nur in dieser Anwendung.
"""
from alembic import op

revision = "0031_onboarding"
down_revision = "0030_schulungen"
branch_labels = None
depends_on = None

UPGRADE = """
-- Übersteuerung der Personio-Abteilung. Personio ist lesend angebunden; wer
-- dort keine Abteilung hat, bekäme sonst keine Pflichtschulungen.
create table public.onboarding_abteilung (
    employee_id  integer primary key
                 references public.personio_employees(id) on delete cascade,
    abteilung    text not null,
    geaendert_am timestamptz not null default now()
);

-- Vermerk, dass das Onboarding-Paket übergeben wurde. Existiert die Zeile,
-- verliert die Person die Markierung „neu".
create table public.onboarding_paket (
    id                uuid primary key default gen_random_uuid(),
    employee_id       integer references public.personio_employees(id) on delete cascade,
    extern_id         uuid references public.externe_personen(id) on delete cascade,
    heruntergeladen_am timestamptz not null default now(),
    constraint onboarding_paket_eine_person check (
        num_nonnulls(employee_id, extern_id) = 1
    )
);

create unique index onboarding_paket_je_person
    on public.onboarding_paket (employee_id) where employee_id is not null;
create unique index onboarding_paket_je_externem
    on public.onboarding_paket (extern_id) where extern_id is not null;

-- Position normieren: Personio schreibt sie uneinheitlich („CNC-Fräser",
-- „CNC Fräser  "). Verglichen wird kleingeschrieben und ohne Mehrfachleerzeichen.
create or replace function public.position_norm(p_text text)
returns text
language sql
immutable
as $$
    select lower(btrim(regexp_replace(coalesce(p_text, ''), '\\s+', ' ', 'g')));
$$;

-- Die Eintritte: Personio-Personen mit Eintrittsdatum und extern gepflegte
-- Personen in einer Liste. `neu` heißt: das Paket ist noch nicht übergeben.
create view public.onboarding_eintritte
with (security_invoker = true) as
select e.id                                   as employee_id,
       null::uuid                             as extern_id,
       trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, ''))
                                              as name,
       coalesce(a.abteilung, e.department)    as abteilung,
       a.abteilung is not null                as abteilung_gesetzt,
       e.raw_json #>> '{attributes,position,value}' as position,
       e.hire_date                            as eintritt,
       e.status,
       p.heruntergeladen_am
from public.personio_employees e
left join public.onboarding_abteilung a on a.employee_id = e.id
left join public.onboarding_paket p on p.employee_id = e.id
where e.hire_date is not null
union all
select null::integer,
       x.id,
       x.name,
       x.abteilung,
       false,
       x.position,
       x.eintritt,
       'active',
       p.heruntergeladen_am
from public.externe_personen x
left join public.onboarding_paket p on p.extern_id = x.id;

-- ---------------------------------------------------------------------------
-- Der Schulungsplan: was die Matrix verlangt und was schon vorliegt.
--
-- Zwei Ebenen, zwei Wege hinein:
--   * `personio` über die (ggf. übersteuerte) Abteilung,
--   * `kuerzel`  über die Zuordnung Position → Abteilungskürzel.
--
-- Die Zeile mit `quelle = 'kuerzel_fehlt'` ist kein Ergebnis, sondern ein
-- Hinweis: für diese Position ist kein Kürzel hinterlegt, die feine Ebene
-- greift also gar nicht. Ohne diesen Hinweis entstünden unbemerkt zu wenige
-- Pflichtschulungen.
-- ---------------------------------------------------------------------------
create or replace function public.schulungsplan(p_employee_id integer)
returns table (
    schulung_id uuid,
    bereich     varchar,
    name        text,
    turnus      varchar,
    quelle      text,
    abteilung   text,
    vorhanden   boolean
)
language sql
stable
as $$
    with person as (
        select e.id,
               coalesce(a.abteilung, e.department) as abteilung,
               public.position_norm(e.raw_json #>> '{attributes,position,value}') as position_norm
        from public.personio_employees e
        left join public.onboarding_abteilung a on a.employee_id = e.id
        where e.id = p_employee_id
    ),
    kuerzel as (
        select r.abteilung_kuerzel
        from public.schulung_rollen r
        join person p on r.position_norm = p.position_norm
    ),
    soll as (
        select k.id, k.bereich, k.name, k.turnus, 'personio'::text as quelle,
               pf.abteilung::text
        from public.schulung_pflicht pf
        join public.schulung_katalog k on k.id = pf.schulung_id
        join person p on true
        where pf.ebene = 'personio' and k.aktiv and pf.abteilung = p.abteilung
        union
        select k.id, k.bereich, k.name, k.turnus, 'kuerzel'::text,
               pf.abteilung::text
        from public.schulung_pflicht pf
        join public.schulung_katalog k on k.id = pf.schulung_id
        join kuerzel ku on ku.abteilung_kuerzel = pf.abteilung
        where pf.ebene = 'kuerzel' and k.aktiv
    )
    select s.id, s.bereich, s.name, s.turnus, s.quelle, s.abteilung,
           exists (
               select 1 from public.schulung_teilnahmen t
               where t.schulung_id = s.id and t.employee_id = p_employee_id
           )
    from soll s
    union all
    -- Der Hinweis, wenn die feine Ebene mangels Zuordnung nicht greift.
    select null::uuid, null::varchar, null::text, null::varchar,
           'kuerzel_fehlt'::text,
           (select position_norm from person),
           false
    where not exists (select 1 from kuerzel)
      and exists (
          select 1 from public.schulung_pflicht where ebene = 'kuerzel'
      )
    order by 5, 2, 3;
$$;

grant execute on function public.schulungsplan(integer) to authenticated;
grant execute on function public.position_norm(text) to authenticated;

-- Die fehlenden Pflichtschulungen als offene Zeilen anlegen. „Offen" heißt:
-- ohne Datum. Damit taucht die Person in der Übersicht auf, ohne eine
-- Fälligkeit vorzutäuschen.
create or replace function public.schulungsplan_anlegen(p_employee_id integer)
returns integer
language plpgsql
security invoker
as $$
declare
    angelegt integer;
    -- Nicht `name`: der Verbund unten führt eine Spalte gleichen Namens, und
    -- Postgres kann dann nicht entscheiden, was gemeint ist.
    person_name text;
begin
    if not public.app_mindestens('hr', 'editor') then
        raise exception 'Dafür fehlt das Recht.' using errcode = '42501';
    end if;

    select trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, ''))
      into person_name
      from public.personio_employees e where e.id = p_employee_id;

    insert into public.schulung_teilnahmen (schulung_id, employee_id, mitarbeiter_name)
    select s.schulung_id, p_employee_id, person_name
      from public.schulungsplan(p_employee_id) s
     where s.schulung_id is not null and not s.vorhanden
    on conflict do nothing;

    get diagnostics angelegt = row_count;
    return angelegt;
end;
$$;

grant execute on function public.schulungsplan_anlegen(integer) to authenticated;

alter table public.onboarding_abteilung enable row level security;
alter table public.onboarding_paket enable row level security;

grant select on public.onboarding_abteilung, public.onboarding_paket,
                public.onboarding_eintritte to authenticated;
grant insert, update, delete on public.onboarding_abteilung,
                public.onboarding_paket to authenticated;

create policy onboarding_abteilung_lesen on public.onboarding_abteilung
    for select to authenticated using (public.app_level('hr') is not null);
create policy onboarding_abteilung_pflegen on public.onboarding_abteilung
    for all to authenticated
    using (public.app_mindestens('hr', 'editor'))
    with check (public.app_mindestens('hr', 'editor'));
create policy onboarding_paket_lesen on public.onboarding_paket
    for select to authenticated using (public.app_level('hr') is not null);
create policy onboarding_paket_pflegen on public.onboarding_paket
    for all to authenticated
    using (public.app_mindestens('hr', 'editor'))
    with check (public.app_mindestens('hr', 'editor'));
"""

DOWNGRADE = """
drop function if exists public.schulungsplan_anlegen(integer);
drop function if exists public.schulungsplan(integer);
drop view if exists public.onboarding_eintritte;
drop function if exists public.position_norm(text);
drop table if exists public.onboarding_paket;
drop table if exists public.onboarding_abteilung;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
