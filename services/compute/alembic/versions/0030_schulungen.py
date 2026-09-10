"""Schulungen: Katalog, Anforderungsmatrix und Teilnahmen.

Revision ID: 0030_schulungen
Revises: 0029_kompetenzen
Create Date: 2026-09-10

Bildet die gewachsene `Schulungsübersicht.xlsx` ab: je Bereich ein Blatt, die
Matrix transponiert (Spalten sind Mitarbeiter, Zeilen sind Schulungen mit je
drei Werten — Initial, aktuell, nächste Fälligkeit).

**Die Fälligkeit wird gerechnet, nicht gespeichert.** Im Altprojekt steht sie
als Spalte `naechste_faellig_am`, berechnet beim Import aus `aktuell_datum` +
Turnus. Ändert jemand danach den Turnus einer Schulung, bleibt die Spalte
stehen und lügt. Hier rechnet die Sicht `schulung_stand` sie beim Lesen — der
Turnus steht am Katalog, die Teilnahme kennt ihn also erst im Verbund.

**Die Quartalsangabe der Excel bleibt trotzdem.** „Q3/2025" ist keine
Datumsangabe und lässt sich nicht rechnen; sie steht als Text daneben, damit
niemand eine Genauigkeit hineinliest, die es nicht gibt.

**Zwei Identitäten je Teilnahme, und genau eine davon.** Die Excel führt eine
Personalnummer, Personio eine eigene Kennung, und wer in keinem von beidem
steht, ist eine extern gepflegte Person. Zeilen ohne Personio-Treffer bleiben
mit Personalnummer und Name erhalten, statt verworfen zu werden — sonst
verschwände Historie, weil eine Nummer nicht gepflegt ist.
"""
from alembic import op

revision = "0030_schulungen"
down_revision = "0029_kompetenzen"
branch_labels = None
depends_on = None

UPGRADE = """
-- Personen, die (noch) nicht in Personio stehen: Externe, Leiharbeit,
-- Eintritte vor dem ersten Abgleich. Gehört nicht allein den Schulungen —
-- Kompetenzen und Onboarding brauchen dieselbe Liste.
create table public.externe_personen (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    abteilung   text,
    position    text,
    eintritt    date,
    angelegt_am timestamptz not null default now()
);

create table public.schulung_katalog (
    id               uuid primary key default gen_random_uuid(),
    bereich          varchar(50) not null,
    name             text not null,
    -- Der Originaltext aus der Excel, z. B. „alle 2 Jahre (und bei Bedarf)".
    turnus           varchar(80),
    -- Daraus abgeleitete Periode. Leer, wo sich nichts ableiten lässt
    -- („bei Bedarf", „alle 3 - 5 Jahre") — geraten wird nicht.
    turnus_monate    integer check (turnus_monate is null or turnus_monate > 0),
    -- Frist nach Eintritt oder Zuweisung, getrennt vom Wiederholungsturnus.
    frist_tage       integer check (frist_tage is null or frist_tage > 0),
    verantwortlicher text,
    beschreibung     text,
    sortierung       integer not null default 0,
    aktiv            boolean not null default true,
    constraint schulung_katalog_eindeutig unique (bereich, name)
);

-- Anforderungsmatrix: diese Schulung ist für diese Abteilung Pflicht.
-- `ebene` unterscheidet die feinen Excel-Kürzel (NÄH, CUT) von den groben
-- Personio-Abteilungen. Die Abteilung ist Text, weil beide Wertelisten aus
-- Fremdsystemen kommen.
create table public.schulung_pflicht (
    id          uuid primary key default gen_random_uuid(),
    schulung_id uuid not null references public.schulung_katalog(id) on delete cascade,
    ebene       varchar(20) not null check (ebene in ('kuerzel', 'personio')),
    abteilung   varchar(80) not null,
    constraint schulung_pflicht_eindeutig unique (schulung_id, ebene, abteilung)
);

-- Brücke für Neueintritte: Personio liefert nur die grobe Abteilung, die
-- Matrix arbeitet zusätzlich auf den feinen Kürzeln. Verglichen wird über die
-- normierte Position, weil sie in Personio uneinheitlich geschrieben ist.
create table public.schulung_rollen (
    id                uuid primary key default gen_random_uuid(),
    position          text not null,
    position_norm     varchar(200) not null unique,
    abteilung_kuerzel varchar(30) not null
);

create table public.schulung_importe (
    id                uuid primary key default gen_random_uuid(),
    dateiname         text not null,
    importiert_am     timestamptz not null default now(),
    schulungen        integer not null default 0,
    teilnahmen        integer not null default 0,
    nicht_zugeordnet  integer not null default 0,
    notiz             text
);

create table public.schulung_teilnahmen (
    id                uuid primary key default gen_random_uuid(),
    schulung_id       uuid not null references public.schulung_katalog(id) on delete cascade,
    employee_id       integer references public.personio_employees(id) on delete set null,
    extern_id         uuid references public.externe_personen(id) on delete cascade,
    -- Der Schlüssel der Excel-Historie; für rein aus Personio angelegte Zeilen leer.
    personalnummer    varchar(30),
    mitarbeiter_name  text,
    -- Das Abteilungskürzel der Excel (NÄH, CUT, WVK …) — eigenes Schema,
    -- nicht Personios `department`.
    abteilung_kuerzel varchar(30),
    initial_datum     date,
    aktuell_datum     date,
    -- Die Quartalsangabe der Excel, unverändert („Q3/2025"). Kein Datum.
    naechste_faellig  varchar(30),
    import_id         uuid references public.schulung_importe(id) on delete set null,
    geaendert_am      timestamptz not null default now(),
    -- Eine Zeile hängt an einer Person, nicht an zweien.
    constraint schulung_teilnahmen_eine_identitaet check (
        num_nonnulls(employee_id, extern_id, personalnummer) >= 1
        and not (employee_id is not null and extern_id is not null)
    )
);

-- Zwei partielle Indizes statt eines zusammengesetzten: je Identitätsart einer.
-- Ein gemeinsamer Index über beide Spalten würde Zeilen mit NULL nicht fassen.
create unique index schulung_teilnahmen_je_person
    on public.schulung_teilnahmen (schulung_id, employee_id)
    where employee_id is not null;
create unique index schulung_teilnahmen_je_personalnummer
    on public.schulung_teilnahmen (schulung_id, personalnummer)
    where employee_id is null and personalnummer is not null;
create unique index schulung_teilnahmen_je_externem
    on public.schulung_teilnahmen (schulung_id, extern_id)
    where extern_id is not null;

create index schulung_teilnahmen_schulung on public.schulung_teilnahmen (schulung_id);
create index schulung_teilnahmen_person on public.schulung_teilnahmen (employee_id);

-- Der Stand je Teilnahme: wann sie fällig wird und ob sie es schon ist.
-- Gerechnet, nicht gespeichert — sonst bliebe die Zahl stehen, wenn sich der
-- Turnus der Schulung ändert.
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

alter table public.externe_personen enable row level security;
alter table public.schulung_katalog enable row level security;
alter table public.schulung_pflicht enable row level security;
alter table public.schulung_rollen enable row level security;
alter table public.schulung_importe enable row level security;
alter table public.schulung_teilnahmen enable row level security;

grant select on public.externe_personen, public.schulung_katalog,
                public.schulung_pflicht, public.schulung_rollen,
                public.schulung_importe, public.schulung_teilnahmen,
                public.schulung_stand to authenticated;
grant insert, update, delete on public.externe_personen, public.schulung_katalog,
                public.schulung_pflicht, public.schulung_rollen,
                public.schulung_teilnahmen to authenticated;

do $$
declare
    t text;
begin
    foreach t in array array['externe_personen', 'schulung_katalog', 'schulung_pflicht',
                             'schulung_rollen', 'schulung_importe', 'schulung_teilnahmen']
    loop
        execute format(
            'create policy %I on public.%I for select to authenticated '
            'using (public.app_level(''hr'') is not null)', t || '_lesen', t);
    end loop;
    foreach t in array array['externe_personen', 'schulung_katalog', 'schulung_pflicht',
                             'schulung_rollen', 'schulung_teilnahmen']
    loop
        execute format(
            'create policy %I on public.%I for all to authenticated '
            'using (public.app_mindestens(''hr'', ''editor'')) '
            'with check (public.app_mindestens(''hr'', ''editor''))',
            t || '_pflegen', t);
    end loop;
end;
$$;

create or replace function public.schulung_beruehrt()
returns trigger
language plpgsql
as $$
begin
    new.geaendert_am := now();
    return new;
end;
$$;

create trigger schulung_teilnahmen_beruehrt before update on public.schulung_teilnahmen
    for each row execute function public.schulung_beruehrt();
"""

DOWNGRADE = """
drop view if exists public.schulung_stand;
drop table if exists public.schulung_teilnahmen;
drop table if exists public.schulung_importe;
drop table if exists public.schulung_rollen;
drop table if exists public.schulung_pflicht;
drop table if exists public.schulung_katalog;
drop table if exists public.externe_personen;
drop function if exists public.schulung_beruehrt();
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
