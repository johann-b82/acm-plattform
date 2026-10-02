"""Kompetenzen: einheitliche Stufe 0–3, Bereich → Aufgabenfamilie.

Revision ID: 0067_kompetenz_stufen
Revises: 0066_signage_kachel
Create Date: 2026-09-30

Das alte Modell (Anforderungslevel 0–4 plus Erfüllungsgrad in Prozent, eine
transponierte Matrix je Bereich mit frei geschriebenen Personennamen) wird durch
ein einheitliches ersetzt: eine **Stufe 0–3** trägt sowohl das Ist (was die
Person kann) als auch das Soll (das persönliche Ziel). Die Matrix ist nicht mehr
ein importiertes Blatt, sondern ein **Bereich** mit **Aufgabenfamilien**; bewertet
wird über die **Personio-ID**, nicht über einen Namen.

**Der Altbestand geht vollständig** — sechs Matrizen, 1.179 Bewertungen. Er wird
nicht umgerechnet: das Alte sagt „gefordert vs. erfüllt", das Neue „gekonnt",
das lässt sich nicht sauber ineinander überführen. Neu erfasst wird aus den
Interviews (Stufe D). Vor dem Einspielen gehört eine Sicherung gezogen.

**Der Nachweis-Trigger (Migration 0051) zieht mit um.** Er hing an
`kompetenz_bewertungen` und las die Person über `kompetenz_personen`; neu steht
`employee_id` direkt an der Bewertung. Funktion und Trigger werden hier
angepasst und neu gesetzt.

Personenbezogene Leistungsbewertung: sehen mit `hr`, pflegen ab `hr: editor`.
"""
from alembic import op

revision = "0067_kompetenz_stufen"
down_revision = "0066_signage_kachel"
branch_labels = None
depends_on = None

UPGRADE = """
drop view if exists public.kompetenz_stand;
-- Das Löschen der Bewertungen nimmt den Trigger personio_nachweis_kompetenz mit.
drop table if exists public.kompetenz_bewertungen;
drop table if exists public.kompetenz_personen;
drop table if exists public.kompetenz_qualifikationen;
drop table if exists public.kompetenz_kategorien;
drop table if exists public.kompetenz_matrizen;

create table public.kompetenz_bereiche (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    -- Die Personio-Abteilung, zu der der Bereich gehört (Production,
    -- Quality Assurance, Logistics …). Frei, weil aus Personio übernommen.
    abteilung   text,
    reihenfolge integer not null default 0,
    constraint kompetenz_bereiche_name_eindeutig unique (name)
);

create table public.kompetenz_familien (
    id           uuid primary key default gen_random_uuid(),
    bereich_id   uuid not null references public.kompetenz_bereiche(id) on delete cascade,
    name         text not null,
    beschreibung text,
    reihenfolge  integer not null default 0,
    -- Mindestbesetzung: wie viele Personen mindestens Stufe 2 (selbstständig)
    -- bzw. Stufe 3 (kann anlernen) können sollen. Gefüllt in Stufe C.
    mindest_l2   integer not null default 0 check (mindest_l2 >= 0),
    mindest_l3   integer not null default 0 check (mindest_l3 >= 0),
    constraint kompetenz_familien_eindeutig unique (bereich_id, name)
);

create index kompetenz_familien_bereich on public.kompetenz_familien (bereich_id, reihenfolge);

create table public.kompetenz_bewertungen (
    id           uuid primary key default gen_random_uuid(),
    familie_id   uuid not null references public.kompetenz_familien(id) on delete cascade,
    employee_id  integer not null references public.personio_employees(id) on delete cascade,
    -- Ist: was die Person kann. Soll: das persönliche Ziel, falls es vom Profil
    -- abweicht (Stufe C). Beide auf derselben Skala 0–3.
    ist_stufe    integer check (ist_stufe between 0 and 3),
    soll_stufe   integer check (soll_stufe between 0 and 3),
    geaendert_am timestamptz not null default now(),
    constraint kompetenz_bewertungen_eindeutig unique (familie_id, employee_id),
    -- Eine Zelle ohne beide Stufen ist keine Zelle; sie wird gelöscht statt leer
    -- gespeichert.
    constraint kompetenz_bewertungen_nicht_leer
        check (ist_stufe is not null or soll_stufe is not null)
);

create index kompetenz_bewertungen_person on public.kompetenz_bewertungen (employee_id);

create table public.kompetenz_interview (
    id               uuid primary key default gen_random_uuid(),
    employee_id      integer not null references public.personio_employees(id) on delete cascade,
    bereich_id       uuid not null references public.kompetenz_bereiche(id) on delete cascade,
    produkte         text,
    weitere_bereiche text,
    engpass          text,
    validiert_durch  text,
    validiert_am     date,
    notiz            text,
    constraint kompetenz_interview_eindeutig unique (employee_id, bereich_id)
);

alter table public.kompetenz_bereiche enable row level security;
alter table public.kompetenz_familien enable row level security;
alter table public.kompetenz_bewertungen enable row level security;
alter table public.kompetenz_interview enable row level security;

grant select on public.kompetenz_bereiche, public.kompetenz_familien,
                public.kompetenz_bewertungen, public.kompetenz_interview to authenticated;
grant insert, update, delete on public.kompetenz_bereiche, public.kompetenz_familien,
                public.kompetenz_bewertungen, public.kompetenz_interview to authenticated;

do $$
declare
    t text;
begin
    foreach t in array array['kompetenz_bereiche', 'kompetenz_familien',
                             'kompetenz_bewertungen', 'kompetenz_interview']
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

-- Neu steht employee_id direkt an der Bewertung; der Umweg über
-- kompetenz_personen entfällt. Für Schulungen bleibt es unverändert.
create or replace function public.personio_nachweis_vormerken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_zeile record;
    v_mitarbeiter integer;
    v_art text;
begin
    if not exists (select 1 from public.plattform_einstellungen
                   where id and personio_nachweis_aktiv
                     and coalesce(btrim(personio_nachweis_kategorie), '') <> '') then
        return null;
    end if;
    if tg_op = 'DELETE' then
        v_zeile := old;
    else
        v_zeile := new;
    end if;
    v_mitarbeiter := v_zeile.employee_id;
    if tg_table_name = 'schulung_teilnahmen' then
        v_art := 'schulung';
    else
        v_art := 'kompetenz';
    end if;
    if v_mitarbeiter is null then
        return null;
    end if;
    insert into public.personio_nachweise (employee_id, art)
    values (v_mitarbeiter, v_art)
    on conflict (employee_id, art) where erledigt_am is null do nothing;
    return null;
end;
$$;

create trigger personio_nachweis_kompetenz
    after insert or update or delete on public.kompetenz_bewertungen
    for each row execute function public.personio_nachweis_vormerken();
"""

# Die Rückrichtung stellt das alte Schema (Migration 0029) samt Trigger und
# Funktion (Migration 0051) wieder her — die Struktur, nicht die Daten.
DOWNGRADE = """
drop trigger if exists personio_nachweis_kompetenz on public.kompetenz_bewertungen;
drop table if exists public.kompetenz_interview;
drop table if exists public.kompetenz_bewertungen;
drop table if exists public.kompetenz_familien;
drop table if exists public.kompetenz_bereiche;

create table public.kompetenz_matrizen (
    id            uuid primary key default gen_random_uuid(),
    bereich       varchar(30) not null
                  check (bereich in ('produktion', 'verwaltung', 'safety', 'quality')),
    blatt         varchar(120) not null,
    titel         text,
    stand         date,
    dateiname     text not null default '',
    importiert_am timestamptz not null default now(),
    constraint kompetenz_matrizen_eindeutig unique (bereich, blatt)
);

create table public.kompetenz_kategorien (
    id          uuid primary key default gen_random_uuid(),
    matrix_id   uuid not null references public.kompetenz_matrizen(id) on delete cascade,
    name        text not null,
    reihenfolge integer not null default 0,
    constraint kompetenz_kategorien_eindeutig unique (matrix_id, name)
);

create table public.kompetenz_qualifikationen (
    id          uuid primary key default gen_random_uuid(),
    matrix_id   uuid not null references public.kompetenz_matrizen(id) on delete cascade,
    nr          integer,
    kategorie   text,
    bezeichnung text not null,
    reihenfolge integer not null
);

create index kompetenz_qualifikationen_matrix
    on public.kompetenz_qualifikationen (matrix_id, reihenfolge);

create table public.kompetenz_personen (
    id          uuid primary key default gen_random_uuid(),
    matrix_id   uuid not null references public.kompetenz_matrizen(id) on delete cascade,
    name        text not null,
    employee_id integer references public.personio_employees(id) on delete set null,
    reihenfolge integer not null
);

create index kompetenz_personen_matrix
    on public.kompetenz_personen (matrix_id, reihenfolge);

create table public.kompetenz_bewertungen (
    id                uuid primary key default gen_random_uuid(),
    qualifikation_id  uuid not null
                      references public.kompetenz_qualifikationen(id) on delete cascade,
    person_id         uuid not null
                      references public.kompetenz_personen(id) on delete cascade,
    anforderungslevel integer check (anforderungslevel between 0 and 4),
    erfuellungsgrad   integer check (erfuellungsgrad between 0 and 100),
    geaendert_am      timestamptz not null default now(),
    constraint kompetenz_bewertungen_eindeutig unique (qualifikation_id, person_id),
    constraint kompetenz_bewertungen_nicht_leer
        check (anforderungslevel is not null or erfuellungsgrad is not null)
);

create index kompetenz_bewertungen_person on public.kompetenz_bewertungen (person_id);

create view public.kompetenz_stand
with (security_invoker = true) as
select q.id                                        as qualifikation_id,
       q.matrix_id,
       count(b.*) filter (where b.erfuellungsgrad is not null) as bewertet,
       round(avg(b.erfuellungsgrad))                as schnitt,
       count(b.*) filter (
           where b.anforderungslevel is not null
             and coalesce(b.erfuellungsgrad, 0) < 100
       )                                            as luecken
from public.kompetenz_qualifikationen q
left join public.kompetenz_bewertungen b on b.qualifikation_id = q.id
group by q.id, q.matrix_id;

alter table public.kompetenz_matrizen enable row level security;
alter table public.kompetenz_kategorien enable row level security;
alter table public.kompetenz_qualifikationen enable row level security;
alter table public.kompetenz_personen enable row level security;
alter table public.kompetenz_bewertungen enable row level security;

grant select on public.kompetenz_matrizen, public.kompetenz_kategorien,
                public.kompetenz_qualifikationen, public.kompetenz_personen,
                public.kompetenz_bewertungen, public.kompetenz_stand to authenticated;
grant insert, update, delete on public.kompetenz_matrizen, public.kompetenz_kategorien,
                public.kompetenz_qualifikationen, public.kompetenz_personen,
                public.kompetenz_bewertungen to authenticated;

do $$
declare
    t text;
begin
    foreach t in array array['kompetenz_matrizen', 'kompetenz_kategorien',
                             'kompetenz_qualifikationen', 'kompetenz_personen',
                             'kompetenz_bewertungen']
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

-- Die alte Funktion las die Person über kompetenz_personen.
create or replace function public.personio_nachweis_vormerken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_zeile record;
    v_mitarbeiter integer;
    v_art text;
begin
    if not exists (select 1 from public.plattform_einstellungen
                   where id and personio_nachweis_aktiv
                     and coalesce(btrim(personio_nachweis_kategorie), '') <> '') then
        return null;
    end if;
    if tg_op = 'DELETE' then
        v_zeile := old;
    else
        v_zeile := new;
    end if;
    if tg_table_name = 'schulung_teilnahmen' then
        v_mitarbeiter := v_zeile.employee_id;
        v_art := 'schulung';
    else
        select p.employee_id into v_mitarbeiter
        from public.kompetenz_personen p where p.id = v_zeile.person_id;
        v_art := 'kompetenz';
    end if;
    if v_mitarbeiter is null then
        return null;
    end if;
    insert into public.personio_nachweise (employee_id, art)
    values (v_mitarbeiter, v_art)
    on conflict (employee_id, art) where erledigt_am is null do nothing;
    return null;
end;
$$;

create trigger personio_nachweis_kompetenz
    after insert or update or delete on public.kompetenz_bewertungen
    for each row execute function public.personio_nachweis_vormerken();
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
