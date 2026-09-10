"""KPI-Bewertung: Kommentare und Maßnahmen zu jeder Kennzahl.

Revision ID: 0018_kpi_bewertung
Revises: 0017_belegschaft
Create Date: 2026-09-10

Der KVP-Kreis auf den Kennzahlen: eine Zahl kommentieren, daraus eine
Maßnahme ableiten, sie einem Zuständigen geben und bis zur Erledigung
verfolgen.

**Die Registry gibt es schon.** Das Altprojekt leitet die Liste der
kommentierbaren Kennzahlen aus den registrierten Dashboards ab — eine eigene
Datenstruktur, die mit jedem neuen Diagramm gepflegt werden will. Hier ist
`zielwerte` bereits genau das: eine Zeile je Kennzahl mit Schlüssel, Bereich
und Beschriftung. Kommentare und Maßnahmen hängen deshalb per Fremdschlüssel
daran. Wer eine Kennzahl mit Zielwert anlegt, kann sie damit auch bewerten;
eine zweite Liste, die auseinanderlaufen kann, entsteht gar nicht erst.

Zum Recht: lesen darf, wer die Dashboards sieht (`kpi`) — eine Bewertung ohne
die Zahl daneben ergibt keinen Sinn. Schreiben darf, wer die Einstellungen
bearbeiten darf; das ist dieselbe Schranke wie für die Zielwerte und damit
für dieselbe Rolle, die auch entscheidet, was ein guter Wert ist.
"""
from alembic import op

revision = "0018_kpi_bewertung"
down_revision = "0017_belegschaft"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.kpi_kommentare (
    id           uuid primary key default gen_random_uuid(),
    schluessel   varchar(64) not null
                 references public.zielwerte (schluessel) on delete cascade,
    -- Fenster, auf das sich der Kommentar bezieht. Ohne Angabe gilt er
    -- allgemein; mit Angabe laesst er sich neben den richtigen Balken legen.
    zeitraum_von date,
    zeitraum_bis date,
    text         text not null check (btrim(text) <> ''),
    verfasser    uuid references auth.users (id) on delete set null,
    erstellt_am  timestamptz not null default now()
);

create index kpi_kommentare_schluessel_idx on public.kpi_kommentare (schluessel, erstellt_am desc);

create table public.kpi_massnahmen (
    id           uuid primary key default gen_random_uuid(),
    schluessel   varchar(64) not null
                 references public.zielwerte (schluessel) on delete cascade,
    titel        varchar(255) not null check (btrim(titel) <> ''),
    beschreibung text,
    -- Freitext statt Fremdschluessel auf Personen: die Zustaendigkeit fuer
    -- eine Massnahme haengt nicht daran, ob jemand ein Konto in dieser
    -- Plattform hat.
    zustaendig   varchar(128),
    faellig_am   date,
    status       varchar(16) not null default 'offen'
                 check (status in ('offen', 'laeuft', 'erledigt', 'verworfen')),
    erledigt_am  date,
    erstellt_am  timestamptz not null default now(),
    geaendert_am timestamptz not null default now(),
    angelegt_von uuid references auth.users (id) on delete set null
);

create index kpi_massnahmen_schluessel_idx on public.kpi_massnahmen (schluessel);
create index kpi_massnahmen_status_idx on public.kpi_massnahmen (status)
    where status in ('offen', 'laeuft');

alter table public.kpi_kommentare enable row level security;
alter table public.kpi_massnahmen enable row level security;

grant select on public.kpi_kommentare to authenticated;
grant select on public.kpi_massnahmen to authenticated;
grant insert, update, delete on public.kpi_kommentare to authenticated;
grant insert, update, delete on public.kpi_massnahmen to authenticated;

-- Lesen: wer die Kennzahlen sieht. Eine Bewertung ohne die Zahl daneben
-- ergibt keinen Sinn.
create policy kpi_kommentare_read on public.kpi_kommentare
    for select to authenticated using (public.app_level('kpi') is not null);
create policy kpi_massnahmen_read on public.kpi_massnahmen
    for select to authenticated using (public.app_level('kpi') is not null);

-- Schreiben: dieselbe Schranke wie fuer die Zielwerte.
create policy kpi_kommentare_insert on public.kpi_kommentare
    for insert to authenticated
    with check (public.app_mindestens('settings', 'editor'));
create policy kpi_kommentare_delete on public.kpi_kommentare
    for delete to authenticated
    using (public.app_mindestens('settings', 'editor'));

create policy kpi_massnahmen_insert on public.kpi_massnahmen
    for insert to authenticated
    with check (public.app_mindestens('settings', 'editor'));
create policy kpi_massnahmen_update on public.kpi_massnahmen
    for update to authenticated
    using (public.app_mindestens('settings', 'editor'))
    with check (public.app_mindestens('settings', 'editor'));
create policy kpi_massnahmen_delete on public.kpi_massnahmen
    for delete to authenticated
    using (public.app_mindestens('settings', 'editor'));

-- `geaendert_am` gehoert nicht in die Hand des Aufrufers.
create or replace function public.kpi_massnahmen_beruehrt()
returns trigger
language plpgsql
as $$
begin
    new.geaendert_am := now();
    -- Wer eine Massnahme auf erledigt setzt, ohne ein Datum zu nennen, meint
    -- heute. Wer sie wieder oeffnet, verliert das Datum.
    if new.status = 'erledigt' and new.erledigt_am is null then
        new.erledigt_am := current_date;
    elsif new.status <> 'erledigt' then
        new.erledigt_am := null;
    end if;
    return new;
end;
$$;

create trigger kpi_massnahmen_beruehrt
    before insert or update on public.kpi_massnahmen
    for each row execute function public.kpi_massnahmen_beruehrt();

-- Eine Zeile je Kennzahl: was steht an, was ist ueberfaellig, wann wurde
-- zuletzt etwas gesagt. Genau das, was ein Dashboard neben der Zahl braucht
-- und was als gespeicherte Spalte nicht zu haben waere.
create or replace function public.kpi_bewertung_uebersicht()
returns table (
    schluessel      varchar,
    bereich         varchar,
    label           varchar,
    kommentare      bigint,
    letzter_kommentar timestamptz,
    offen           bigint,
    ueberfaellig    bigint,
    erledigt        bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select z.schluessel,
           z.bereich,
           z.label,
           (select count(*) from public.kpi_kommentare k where k.schluessel = z.schluessel),
           (select max(k.erstellt_am) from public.kpi_kommentare k where k.schluessel = z.schluessel),
           (select count(*) from public.kpi_massnahmen m
             where m.schluessel = z.schluessel and m.status in ('offen', 'laeuft')),
           (select count(*) from public.kpi_massnahmen m
             where m.schluessel = z.schluessel
               and m.status in ('offen', 'laeuft')
               and m.faellig_am is not null
               and m.faellig_am < current_date),
           (select count(*) from public.kpi_massnahmen m
             where m.schluessel = z.schluessel and m.status = 'erledigt')
    from public.zielwerte z
    where public.app_level('kpi') is not null
    order by z.sortierung;
$$;

grant execute on function public.kpi_bewertung_uebersicht() to authenticated;
"""

DOWNGRADE = """
drop function if exists public.kpi_bewertung_uebersicht();
drop trigger if exists kpi_massnahmen_beruehrt on public.kpi_massnahmen;
drop function if exists public.kpi_massnahmen_beruehrt();
drop table if exists public.kpi_massnahmen;
drop table if exists public.kpi_kommentare;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
