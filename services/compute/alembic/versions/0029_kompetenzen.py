"""Kompetenzen: die Qualifikationsmatrix je Bereich.

Revision ID: 0029_kompetenzen
Revises: 0028_audit
Create Date: 2026-09-10

Zeilen sind Qualifikationen, Spalten sind Personen, eine Zelle sagt: was ist
gefordert (Anforderungslevel 0–4) und wie weit ist es erfüllt (0–100 %).

**Die Matrix kommt aus Excel und bleibt danach hier.** Eingelesen wird eine
Bereichsdatei — die vier Dateien sind gleich gebaut, nur die Kopfzeile
wandert. Danach wird in der Oberfläche gepflegt, nicht in Excel; ein erneuter
Import ersetzt die Matrix vollständig.

**Zwei Zahlen der Excel kommen nicht mit.** „Anzahl Mitarbeiter" und
„Durchschnitt" sind dort Formeln. Beides ist aus den Bewertungen ableitbar,
und eine gespeicherte Ableitung geht beim ersten Schreibvorgang daneben. Die
Sicht `kompetenz_stand` rechnet sie beim Lesen.

**Kategorien stehen doppelt, und das mit Absicht.** An der Qualifikation als
Text (so kam sie aus Excel), zusätzlich als eigene Zeile — sonst ließe sich
eine Kategorie nicht anlegen, bevor die erste Qualifikation sie trägt.

Personenbezogene Leistungsbewertung: sehen mit `hr`, pflegen ab `hr: editor`.
"""
from alembic import op

revision = "0029_kompetenzen"
down_revision = "0028_audit"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.kompetenz_matrizen (
    id            uuid primary key default gen_random_uuid(),
    bereich       varchar(30) not null
                  check (bereich in ('produktion', 'verwaltung', 'safety', 'quality')),
    blatt         varchar(120) not null,
    titel         text,
    -- Das „Stand"-Datum aus der Kopfzeile der Excel.
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
    -- Der Name, wie er in der Excel stand. Bleibt stehen, auch wenn die
    -- Zuordnung zu Personio nicht gelingt — sonst verlöre die Spalte ihre
    -- Beschriftung.
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
    -- Eine Zelle ohne beides ist keine Zelle; sie wird gelöscht statt leer
    -- gespeichert.
    constraint kompetenz_bewertungen_nicht_leer
        check (anforderungslevel is not null or erfuellungsgrad is not null)
);

create index kompetenz_bewertungen_person on public.kompetenz_bewertungen (person_id);

-- Was die Excel als Formel führt: Anzahl bewerteter Personen je Qualifikation
-- und der durchschnittliche Erfüllungsgrad.
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
"""

DOWNGRADE = """
drop view if exists public.kompetenz_stand;
drop table if exists public.kompetenz_bewertungen;
drop table if exists public.kompetenz_personen;
drop table if exists public.kompetenz_qualifikationen;
drop table if exists public.kompetenz_kategorien;
drop table if exists public.kompetenz_matrizen;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
