"""Qualität: Prüfmengen je Mitarbeiter und Tag, Ausschussquote je Produkt.

Revision ID: 0009_pruefmengen
Revises: 0008_reklamationsquote
Create Date: 2026-09-10

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „Große/Kleine Produkte":

  Filter    `pruef_datum` im Fenster, `rsc = '70000'` (echte Qualitätsprüfung,
            alles andere ist eine Sonderbuchung) und `excluded = false`.
  Zähler    SUM(buchungs_menge) je Größenklasse.
  Nenner    **gemeinsam** über beide Klassen:
            COUNT(DISTINCT benutzer) × COUNT(DISTINCT pruef_datum).
            Ein gemeinsamer Nenner, weil die Kennzahl „Produkte je Tag und
            Mitarbeiter" heißt und dieselben Leute an denselben Tagen beides
            prüfen.
  Ergebnis  gerundet, und zwar zur geraden Zahl (siehe unten).
  Nenner 0  ergibt 0, nicht NULL. Die Kachel zeigt dann eine Null, keinen
            Strich — so war es im Altprojekt.

Zur Rundung: das Altprojekt rechnet in Python, und `round()` rundet dort die
Hälfte zur geraden Zahl (2,5 → 2; 3,5 → 4). Postgres rundet die Hälfte vom
Nullpunkt weg (2,5 → 3). Ohne die Nachbildung wichen einzelne Kacheln um eins
ab — wenig, aber genug für die Frage „warum steht da etwas anderes als
früher".

Die Größenklasse steckt nicht in den Daten, sondern in einer Regel über
Produktgruppe und Bezeichnung; sie wird beim Einlesen abgeleitet.

Wiederholtes Hochladen ersetzt alle Zeilen im Datumsbereich der Datei — die
Quelle hat keinen Geschäftsschlüssel, identische Buchungszeilen sind erlaubt.
Handgesetzte Ausschlüsse in diesem Bereich gehen dabei verloren; das ist im
Altprojekt so und lässt sich ohne Schlüssel nicht sauber vermeiden. Die
Oberfläche sagt es vor dem Hochladen.
"""
from alembic import op

revision = "0009_pruefmengen"
down_revision = "0008_reklamationsquote"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.inspection_records (
    id              integer generated always as identity primary key,
    pruef_datum     date not null,
    pruef_zeit      time,
    benutzer        varchar(64),
    fa              varchar(50),
    artikel         varchar(50),
    bezeichnung     text,
    buchungs_menge  numeric(15, 3),
    ausschuss_menge numeric(15, 3),
    produktgruppe   varchar(64),
    typ             varchar(10),
    -- Beim Einlesen abgeleitet aus Produktgruppe und Bezeichnung.
    size_class      varchar(10) not null check (size_class in ('large', 'small')),
    -- Kostenschlüssel. Nur '70000' ist eine echte Qualitätsprüfung.
    rsc             varchar(32),
    -- Von Hand ausgeschlossen. Die Zeile bleibt stehen, zählt aber nicht mit.
    excluded        boolean not null default false,
    upload_batch_id integer references public.upload_batches (id) on delete set null,
    imported_at     timestamptz not null default now(),
    raw             jsonb
);
create index ix_inspection_pruef_datum on public.inspection_records (pruef_datum);
create index ix_inspection_size_datum on public.inspection_records (size_class, pruef_datum);

alter table public.inspection_records enable row level security;
grant select on public.inspection_records to authenticated;
-- Nur das Ausschluss-Häkchen ist von außen änderbar; alles andere kommt aus
-- der Datei.
grant update (excluded) on public.inspection_records to authenticated;

create policy inspection_records_read on public.inspection_records
    for select to authenticated using (public.app_level('kpi') is not null);
create policy inspection_records_ausschluss on public.inspection_records
    for update to authenticated
    using (public.app_mindestens('kpi', 'editor'))
    with check (public.app_mindestens('kpi', 'editor'));

-- ---------------------------------------------------------------------------
-- Kennzahlen
-- ---------------------------------------------------------------------------

-- Runden zur geraden Zahl, wie Pythons `round()`. Postgres rundet die Hälfte
-- sonst vom Nullpunkt weg, und die Kacheln wichen um eins vom Altprojekt ab.
create or replace function public.runde_zur_geraden(p_wert numeric)
returns bigint
language sql
immutable
as $$
    select case
        when p_wert - floor(p_wert) = 0.5 then
            case when (floor(p_wert)::bigint) % 2 = 0
                 then floor(p_wert)::bigint
                 else floor(p_wert)::bigint + 1
            end
        else round(p_wert)::bigint
    end;
$$;

create or replace function public.kpi_qualitaet_pruefmengen(
    von date default null,
    bis date default null
)
returns table (
    gross        bigint,
    klein        bigint,
    pruefer      bigint,
    prueftage    bigint
)
language sql
stable
as $$
    with gefiltert as (
        select i.size_class, i.benutzer, i.pruef_datum, i.buchungs_menge
        from public.inspection_records i
        where i.rsc = '70000'
          and not i.excluded
          and (von is null or i.pruef_datum >= von)
          and (bis is null or i.pruef_datum <= bis)
    ),
    nenner as (
        select count(distinct benutzer) * count(distinct pruef_datum) as teiler
        from gefiltert
    )
    select case when nenner.teiler > 0
                then public.runde_zur_geraden(
                    coalesce(sum(g.buchungs_menge) filter (where g.size_class = 'large'), 0)
                    / nenner.teiler)
                else 0 end,
           case when nenner.teiler > 0
                then public.runde_zur_geraden(
                    coalesce(sum(g.buchungs_menge) filter (where g.size_class = 'small'), 0)
                    / nenner.teiler)
                else 0 end,
           (select count(distinct benutzer) from gefiltert),
           (select count(distinct pruef_datum) from gefiltert)
    from gefiltert g, nenner
    group by nenner.teiler;
$$;

-- Ausschussquote je Produkt. Keine Kachel, kein Zielwert — eine Prüftabelle.
create or replace function public.kpi_qualitaet_ausschuss(
    von    date default null,
    bis    date default null,
    grenze integer default 500
)
returns table (
    bezeichnung     text,
    size_class      varchar,
    buchungs_menge  numeric,
    ausschuss_menge numeric,
    quote           numeric
)
language sql
stable
as $$
    select i.bezeichnung,
           i.size_class,
           sum(i.buchungs_menge),
           sum(i.ausschuss_menge),
           case when coalesce(sum(i.buchungs_menge), 0) > 0
                then coalesce(sum(i.ausschuss_menge), 0) / sum(i.buchungs_menge)
                else null end
    from public.inspection_records i
    where i.rsc = '70000'
      and not i.excluded
      and (von is null or i.pruef_datum >= von)
      and (bis is null or i.pruef_datum <= bis)
    group by i.bezeichnung, i.size_class
    order by sum(i.buchungs_menge) desc nulls last
    limit least(greatest(coalesce(grenze, 500), 1), 500);
$$;

-- Buchungen zum Ein- und Ausschließen. Zeigt auch die ausgeschlossenen,
-- sonst liesse sich ein Haken nicht wieder entfernen.
create or replace function public.kpi_qualitaet_buchungen(
    von    date default null,
    bis    date default null,
    grenze integer default 500
)
returns table (
    id              integer,
    pruef_datum     date,
    benutzer        varchar,
    bezeichnung     text,
    size_class      varchar,
    buchungs_menge  numeric,
    ausschuss_menge numeric,
    excluded        boolean
)
language sql
stable
as $$
    select i.id, i.pruef_datum, i.benutzer, i.bezeichnung, i.size_class,
           i.buchungs_menge, i.ausschuss_menge, i.excluded
    from public.inspection_records i
    where i.rsc = '70000'
      and (von is null or i.pruef_datum >= von)
      and (bis is null or i.pruef_datum <= bis)
    order by i.buchungs_menge desc nulls last, i.pruef_datum desc
    limit least(greatest(coalesce(grenze, 500), 1), 500);
$$;

grant execute on function
    public.runde_zur_geraden(numeric),
    public.kpi_qualitaet_pruefmengen(date, date),
    public.kpi_qualitaet_ausschuss(date, date, integer),
    public.kpi_qualitaet_buchungen(date, date, integer)
to authenticated;

insert into public.zielwerte (schluessel, bereich, label, beschreibung, wert, einheit, richtung, sortierung)
values
    ('qualitaet_pruefung_gross', 'qualitaet', 'Große Produkte geprüft',
     'Mindestzahl je Prüfer und Prüftag.', 150, 'anzahl', 'min', 50),
    ('qualitaet_pruefung_klein', 'qualitaet', 'Kleine Produkte geprüft',
     'Mindestzahl je Prüfer und Prüftag.', 400, 'anzahl', 'min', 51);
"""

DOWNGRADE = """
delete from public.zielwerte where schluessel like 'qualitaet_pruefung_%';
drop function if exists public.kpi_qualitaet_buchungen(date, date, integer);
drop function if exists public.kpi_qualitaet_ausschuss(date, date, integer);
drop function if exists public.kpi_qualitaet_pruefmengen(date, date);
drop function if exists public.runde_zur_geraden(numeric);
drop table if exists public.inspection_records;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
