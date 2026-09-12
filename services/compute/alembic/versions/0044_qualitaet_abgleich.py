"""Qualität: Prüfleistung je Prüfer-Tag, Artikelart, Detailtabellen, Gesamtprüfziel.

Revision ID: 0044_qualitaet_abgleich
Revises: 0040_bereich_hr
Create Date: 2026-09-12

Abgleich mit dem Altsystem (QUA-02, QUA-05, QUA-06, QUA-07, QUA-08, SET-01).

Prüfleistung (QUA-02, QUA-06) nach `services/inspection_aggregation.py`:

  Filter    `pruef_datum` im Fenster, `rsc = '70000'`, `excluded = false`,
            Artikelart (siehe unten).
  Zähler    SUM(buchungs_menge) je Klasse; Gesamt über alle Buchungen.
  Nenner    je Klasse COUNT(DISTINCT (benutzer, pruef_datum)) über die
            Buchungen **dieser** Klasse — die Prüfer-Tage, an denen tatsächlich
            jemand diese Größe geprüft hat. Gesamt hat einen eigenen Nenner
            über alle Buchungen. Groß + Klein ist deshalb nicht Gesamt.
  Ergebnis  auf eine Nachkommastelle, die Hälfte zur geraden Stelle wie
            Pythons `round(x, 1)`. Nenner 0 ergibt 0.

0009 teilte beide Klassen durch COUNT(DISTINCT benutzer) × COUNT(DISTINCT
pruef_datum). Das Kreuzprodukt zählt jedes denkbare Paar, auch wenn der Prüfer
an dem Tag gar nicht da war; das Altsystem hat genau diesen Nenner verworfen,
weil er drei- bis sechsfach zu klein rechnete. Auf der lokalen Kopie für 2026:
18 Prüfer × 118 Tage = 2124 gegen 241 Prüfer-Tage bei großen Produkten.

Artikelart (QUA-05) nach `_artikel_clause`: halbfertig heißt, die
Artikelnummer beginnt mit „H“ (ohne Rücksicht auf Groß-/Kleinschreibung);
fertig ist alles andere, auch eine fehlende Nummer; alle filtert nicht. Vorgabe
ist fertig. Wirkt auf Kacheln, Verlauf und Buchungen.

Detailtabellen (QUA-07, QUA-08): die Findings aller Levels und die
Reklamationen der gewählten Art, ohne Obergrenze — die Tabelle blättert selbst.
Die Diagnoseliste „ohne Level“ liest die Oberfläche aus der Findings-Liste;
die eigene Funktion mit Grenze 500 entfällt.

Gesamtprüfziel (SET-01): eine Zeile in `zielwerte`, anfangs leer. Leer heißt
keine Ziellinie. Dafür darf `wert` leer sein — aber nur, wo die Zeile es
ausdrücklich erlaubt, damit ein versehentlich geleertes Feld keiner anderen
Kachel die Einordnung nimmt.
"""
from alembic import op

revision = "0044_qualitaet_abgleich"
down_revision = "0041_vertrieb_abgleich"
branch_labels = None
depends_on = None

UPGRADE = """
-- ---------------------------------------------------------------------------
-- Prüfleistung
-- ---------------------------------------------------------------------------

create or replace function public.pruef_artikelart_passt(p_artikel text, p_artikelart text)
returns boolean
language sql
immutable
as $$
    select case p_artikelart
        when 'halbfertig' then coalesce(p_artikel ilike 'H%', false)
        when 'alle'       then true
        else p_artikel is null or p_artikel not ilike 'H%'
    end;
$$;

-- Menge je Prüfer-Tag, eine Nachkommastelle, Hälfte zur geraden Stelle.
create or replace function public.pruefleistung(p_menge numeric, p_personentage bigint)
returns numeric
language sql
immutable
as $$
    select case when p_personentage > 0
                then (public.runde_zur_geraden(coalesce(p_menge, 0) * 10 / p_personentage) / 10.0)::numeric(15, 1)
                else 0::numeric(15, 1) end;
$$;

drop function if exists public.kpi_qualitaet_pruefmengen(date, date);

create or replace function public.kpi_qualitaet_pruefmengen(
    von        date default null,
    bis        date default null,
    artikelart text default 'fertig'
)
returns table (
    gross               numeric,
    klein               numeric,
    gesamt              numeric,
    personentage_gross  bigint,
    personentage_klein  bigint,
    personentage_gesamt bigint
)
language sql
stable
as $$
    with summen as (
        select sum(i.buchungs_menge) filter (where i.size_class = 'large') as menge_gross,
               sum(i.buchungs_menge) filter (where i.size_class = 'small') as menge_klein,
               sum(i.buchungs_menge)                                       as menge_gesamt,
               count(distinct (i.benutzer, i.pruef_datum)) filter (where i.size_class = 'large') as pt_gross,
               count(distinct (i.benutzer, i.pruef_datum)) filter (where i.size_class = 'small') as pt_klein,
               count(distinct (i.benutzer, i.pruef_datum))                                       as pt_gesamt
        from public.inspection_records i
        where i.rsc = '70000'
          and not i.excluded
          and (von is null or i.pruef_datum >= von)
          and (bis is null or i.pruef_datum <= bis)
          and public.pruef_artikelart_passt(i.artikel, artikelart)
    )
    select public.pruefleistung(menge_gross, pt_gross),
           public.pruefleistung(menge_klein, pt_klein),
           public.pruefleistung(menge_gesamt, pt_gesamt),
           pt_gross, pt_klein, pt_gesamt
    from summen;
$$;

create or replace function public.kpi_qualitaet_pruefmengen_verlauf(
    von        date default null,
    bis        date default null,
    takt       text default 'month',
    artikelart text default 'fertig'
)
returns table (
    bucket              date,
    gross               numeric,
    klein               numeric,
    gesamt              numeric,
    personentage_gross  bigint,
    personentage_klein  bigint,
    personentage_gesamt bigint
)
language sql
stable
as $$
    with summen as (
        select date_trunc(
                   case when takt in ('day', 'week', 'month', 'quarter', 'year') then takt else 'month' end,
                   i.pruef_datum
               )::date as bucket,
               sum(i.buchungs_menge) filter (where i.size_class = 'large') as menge_gross,
               sum(i.buchungs_menge) filter (where i.size_class = 'small') as menge_klein,
               sum(i.buchungs_menge)                                       as menge_gesamt,
               count(distinct (i.benutzer, i.pruef_datum)) filter (where i.size_class = 'large') as pt_gross,
               count(distinct (i.benutzer, i.pruef_datum)) filter (where i.size_class = 'small') as pt_klein,
               count(distinct (i.benutzer, i.pruef_datum))                                       as pt_gesamt
        from public.inspection_records i
        where i.rsc = '70000'
          and not i.excluded
          and (von is null or i.pruef_datum >= von)
          and (bis is null or i.pruef_datum <= bis)
          and public.pruef_artikelart_passt(i.artikel, artikelart)
        group by 1
    )
    select bucket,
           public.pruefleistung(menge_gross, pt_gross),
           public.pruefleistung(menge_klein, pt_klein),
           public.pruefleistung(menge_gesamt, pt_gesamt),
           pt_gross, pt_klein, pt_gesamt
    from summen
    order by bucket;
$$;

-- Buchungen zum Ein- und Ausschließen, ohne Obergrenze. Zeigt auch die
-- ausgeschlossenen, sonst liesse sich ein Haken nicht wieder entfernen.
drop function if exists public.kpi_qualitaet_buchungen(date, date, integer);

create or replace function public.kpi_qualitaet_buchungen(
    von        date default null,
    bis        date default null,
    artikelart text default 'fertig'
)
returns table (
    id              integer,
    pruef_datum     date,
    benutzer        varchar,
    artikel         varchar,
    bezeichnung     text,
    size_class      varchar,
    buchungs_menge  numeric,
    ausschuss_menge numeric,
    excluded        boolean
)
language sql
stable
as $$
    select i.id, i.pruef_datum, i.benutzer, i.artikel, i.bezeichnung, i.size_class,
           i.buchungs_menge, i.ausschuss_menge, i.excluded
    from public.inspection_records i
    where i.rsc = '70000'
      and (von is null or i.pruef_datum >= von)
      and (bis is null or i.pruef_datum <= bis)
      and public.pruef_artikelart_passt(i.artikel, artikelart)
    order by i.pruef_datum desc, i.id desc;
$$;

-- ---------------------------------------------------------------------------
-- Detailtabellen
-- ---------------------------------------------------------------------------

drop function if exists public.kpi_qualitaet_audits_ohne_level(date, date, integer, text[]);

-- Dieselben Filter wie `kpi_qualitaet_audits`: die Zeilen der Tabelle sind
-- genau die, die die Kacheln zählen, samt denen ohne Level.
create or replace function public.kpi_qualitaet_audits_liste(
    von   date default null,
    bis   date default null,
    arten text[] default null
)
returns table (
    report_nr     varchar,
    report_date   date,
    art           varchar,
    level         smallint,
    issuer        varchar,
    customer_name varchar,
    customer_id   varchar,
    designation   text,
    status_code   varchar
)
language sql
stable
as $$
    select q.report_nr, q.report_date, q.art, q.level, q.issuer,
           q.customer_name, q.customer_id, q.designation, q.status_code
    from public.quality_records q
    where q.art = any (coalesce(arten, public.audit_codes()))
      and q.art = any (public.audit_codes())
      and q.report_date is not null
      and (von is null or q.report_date >= von)
      and (bis is null or q.report_date <= bis)
    order by q.report_date desc, q.report_nr desc;
$$;

-- Dieselben Zeilen wie der Zähler von `kpi_qualitaet_reklamationen`.
create or replace function public.kpi_qualitaet_reklamationen_liste(
    p_art text default 'kunde',
    von   date default null,
    bis   date default null
)
returns table (
    report_nr         varchar,
    report_date       date,
    customer_name     varchar,
    customer_id       varchar,
    designation       text,
    quantity          numeric,
    accepted_quantity numeric,
    issuer            varchar,
    status_code       varchar
)
language sql
stable
as $$
    select q.report_nr, q.report_date, q.customer_name, q.customer_id, q.designation,
           q.quantity, q.accepted_quantity, q.issuer, q.status_code
    from public.quality_records q
    where q.art = any (public.reklamations_codes(p_art))
      and q.report_date is not null
      and (von is null or q.report_date >= von)
      and (bis is null or q.report_date <= bis)
    order by q.report_date desc, q.report_nr desc;
$$;

grant execute on function
    public.pruef_artikelart_passt(text, text),
    public.pruefleistung(numeric, bigint),
    public.kpi_qualitaet_pruefmengen(date, date, text),
    public.kpi_qualitaet_pruefmengen_verlauf(date, date, text, text),
    public.kpi_qualitaet_buchungen(date, date, text),
    public.kpi_qualitaet_audits_liste(date, date, text[]),
    public.kpi_qualitaet_reklamationen_liste(text, date, date)
to authenticated;

-- ---------------------------------------------------------------------------
-- Gesamtprüfziel
-- ---------------------------------------------------------------------------

alter table public.zielwerte add column leer_erlaubt boolean not null default false;
alter table public.zielwerte alter column wert drop not null;
alter table public.zielwerte
    add constraint zielwerte_leer_nur_wo_erlaubt check (wert is not null or leer_erlaubt);

insert into public.zielwerte
    (schluessel, bereich, label, beschreibung, wert, einheit, richtung, sortierung, leer_erlaubt)
values
    ('qualitaet_pruefung_gesamt', 'qualitaet', 'Gesamt geprüft',
     'Mindestzahl je Prüfer und Prüftag über alle Größen. Leer: keine Ziellinie.',
     null, 'anzahl', 'min', 52, true);
"""

DOWNGRADE = """
delete from public.zielwerte where schluessel = 'qualitaet_pruefung_gesamt';
alter table public.zielwerte drop constraint zielwerte_leer_nur_wo_erlaubt;
alter table public.zielwerte alter column wert set not null;
alter table public.zielwerte drop column leer_erlaubt;

drop function if exists public.kpi_qualitaet_reklamationen_liste(text, date, date);
drop function if exists public.kpi_qualitaet_audits_liste(date, date, text[]);
drop function if exists public.kpi_qualitaet_buchungen(date, date, text);
drop function if exists public.kpi_qualitaet_pruefmengen_verlauf(date, date, text, text);
drop function if exists public.kpi_qualitaet_pruefmengen(date, date, text);
drop function if exists public.pruefleistung(numeric, bigint);
drop function if exists public.pruef_artikelart_passt(text, text);

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

create or replace function public.kpi_qualitaet_audits_ohne_level(
    von    date default null,
    bis    date default null,
    grenze integer default 500,
    arten  text[] default null
)
returns table (
    report_nr     varchar,
    report_date   date,
    art           varchar,
    customer_name varchar,
    designation   text
)
language sql
stable
as $$
    select q.report_nr, q.report_date, q.art, q.customer_name, q.designation
    from public.quality_records q
    where q.art = any (coalesce(arten, public.audit_codes()))
      and q.art = any (public.audit_codes())
      and q.level is null
      and q.report_date is not null
      and (von is null or q.report_date >= von)
      and (bis is null or q.report_date <= bis)
    order by q.report_date desc
    limit least(greatest(coalesce(grenze, 500), 1), 500);
$$;

grant execute on function
    public.kpi_qualitaet_pruefmengen(date, date),
    public.kpi_qualitaet_buchungen(date, date, integer),
    public.kpi_qualitaet_audits_ohne_level(date, date, integer, text[])
to authenticated;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
