"""ATR: Teilekatalog und Vorlage.

Revision ID: 0022_atr_katalog
Revises: 0021_fair
Create Date: 2026-09-10

Erster Teil des ATR-Moduls. Ein ATR-Dokument entsteht aus drei Dingen: dem
Lieferschein (kommt später), dem **Teilekatalog** — was ein Teil heißt, wiegt
und zu welcher Zeichnung es gehört — und der **Vorlage**, die Kopfdaten und
das Gerüst der Ausgabedatei hält.

**Der Schlüssel ist die Teilenummer ohne Beiwerk.** Auf dem Lieferschein steht
sie mal mit Präfix, mal mit Bindestrichen; im Katalog steht sie wieder anders.
Verglichen werden deshalb nur die Ziffern (`atr_teilenummer_norm`), und dieser
Wert ist der eindeutige Schlüssel. Im Altprojekt tut eine Python-Funktion
dasselbe — als erzeugte Spalte kann sie nicht auseinanderlaufen, und niemand
kann am Katalog vorbei eine Zeile mit falsch normierter Nummer einfügen.

**Eine Vorlage je Programm.** A350 und A380 unterscheiden sich in Kopfdaten
und Gerüstdatei. Im Altprojekt sind das die festen Zeilen `id=1` und `id=2` mit
einem Kommentar dazu; hier ist das Programm der Schlüssel.
"""
from alembic import op

revision = "0022_atr_katalog"
down_revision = "0021_fair"
branch_labels = None
depends_on = None

UPGRADE = """
-- Nur die Ziffern. Was im Altprojekt `norm_partno` in Python macht, macht
-- hier die Datenbank — damit es nur einen Ort gibt, an dem es steht.
create or replace function public.atr_teilenummer_norm(p_nummer text)
returns text
language sql
immutable
as $$
    select nullif(regexp_replace(coalesce(p_nummer, ''), '[^0-9]', '', 'g'), '');
$$;

create table public.atr_teile (
    id                uuid primary key default gen_random_uuid(),
    teilenummer       varchar(60) not null check (btrim(teilenummer) <> ''),
    -- Erzeugt, nicht geschrieben: so kann sie nicht von der Teilenummer
    -- abweichen, aus der sie stammt.
    teilenummer_norm  text generated always as
                      (public.atr_teilenummer_norm(teilenummer)) stored,
    lieferantennummer varchar(40),
    bezeichnung       varchar(200),
    zeichnung         varchar(60),
    gewicht_kg        numeric(8, 3) check (gewicht_kg is null or gewicht_kg >= 0),
    menge             smallint not null default 1 check (menge >= 1),
    kategorie         varchar(40),
    bestellposition   varchar(20),
    herkunft          varchar(255),
    erstellt_am       timestamptz not null default now(),
    geaendert_am      timestamptz not null default now()
);

-- Eine Teilenummer gibt es einmal. Teilweise, weil eine Nummer ganz ohne
-- Ziffern keine ist — die faellt durch und blockiert keine andere.
create unique index atr_teile_norm_idx on public.atr_teile (teilenummer_norm)
    where teilenummer_norm is not null;
create index atr_teile_bezeichnung_idx on public.atr_teile (bezeichnung);

create table public.atr_vorlagen (
    -- Das Programm ist der Schluessel; im Altprojekt sind es die festen
    -- Zeilen id=1 (A350) und id=2 (A380).
    programm            varchar(20) primary key check (btrim(programm) <> ''),
    kunde               varchar(200),
    arbeitspaket        text,
    besteller_spez      varchar(200),
    atp                 varchar(200),
    lieferanten_spez    varchar(200),
    referenz            varchar(200),
    lieferant           varchar(200),
    kunden_spez         varchar(100),
    nscm                varchar(40),
    ata_kapitel         varchar(20),
    waage               varchar(100),
    qs_unterschrift     varchar(100),
    -- Geruestdatei im Eimer `atr`; NULL heisst noch keine hinterlegt.
    geruest_pfad        text,
    geruest_dateiname   varchar(255),
    geaendert_am        timestamptz not null default now()
);

alter table public.atr_teile enable row level security;
alter table public.atr_vorlagen enable row level security;

grant select, insert, update, delete
    on public.atr_teile, public.atr_vorlagen to authenticated;

create policy atr_teile_read on public.atr_teile
    for select to authenticated using (public.app_level('atr') is not null);
create policy atr_teile_schreiben on public.atr_teile
    for all to authenticated
    using (public.app_mindestens('atr', 'editor'))
    with check (public.app_mindestens('atr', 'editor'));

create policy atr_vorlagen_read on public.atr_vorlagen
    for select to authenticated using (public.app_level('atr') is not null);
create policy atr_vorlagen_schreiben on public.atr_vorlagen
    for all to authenticated
    using (public.app_mindestens('atr', 'editor'))
    with check (public.app_mindestens('atr', 'editor'));

create or replace function public.atr_beruehrt()
returns trigger
language plpgsql
as $$
begin
    new.geaendert_am := now();
    return new;
end;
$$;

create trigger atr_teile_beruehrt before update on public.atr_teile
    for each row execute function public.atr_beruehrt();
create trigger atr_vorlagen_beruehrt before update on public.atr_vorlagen
    for each row execute function public.atr_beruehrt();

-- ---------------------------------------------------------------------------
-- Der Eimer fuer Geruestdateien und spaeter die Ausgaben.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('atr', 'atr', false, 26214400,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy atr_datei_hoch on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'atr'
        and public.app_mindestens('atr', 'editor')
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy atr_datei_lesen on storage.objects
    for select to authenticated
    using (bucket_id = 'atr' and public.app_level('atr') is not null);

create policy atr_datei_weg on storage.objects
    for delete to authenticated
    using (bucket_id = 'atr' and public.app_mindestens('atr', 'editor'));
"""

DOWNGRADE = """
drop policy if exists atr_datei_weg on storage.objects;
drop policy if exists atr_datei_lesen on storage.objects;
drop policy if exists atr_datei_hoch on storage.objects;
-- Eimer und Dateien bleiben stehen, siehe 0019_feedback.
drop trigger if exists atr_vorlagen_beruehrt on public.atr_vorlagen;
drop trigger if exists atr_teile_beruehrt on public.atr_teile;
drop function if exists public.atr_beruehrt();
drop table if exists public.atr_vorlagen;
drop table if exists public.atr_teile;
drop function if exists public.atr_teilenummer_norm(text);
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
