"""KPI-Bewertung wie im Altsystem: Bubbles, Priorität, Verantwortliche (MAS-01).

Revision ID: 0050_kpi_bubbles
Revises: 0040_bereich_hr
Create Date: 2026-09-12

Das Altsystem kennt zu einer Kennzahl keine losen Kommentare mehr, sondern
**Bubbles**: nummerierte Marker, die auf einem Dashboard über einen Bereich
des Diagramms gezogen werden (`KpiBubbleOverlay.tsx`). Die Seite
„KPI-Bewertung & Maßnahmen" listet sie alle, und eine Maßnahme kann auf eine
davon verweisen.

**Ein Kommentar ist eine Bubble.** Statt einer zweiten Tabelle bekommt
`kpi_kommentare` die Felder einer Bubble: den Bereich (die Dashboard-Seite),
eine fortlaufende Nummer je Bereich, die Position als Anteil der Seite
(0..1), eine Ampel und `gesehen_am`. Vorhandene Kommentare werden damit zu
Bubbles ohne Diagrammposition — sie bleiben, bekommen ihre Nummer in der
Reihenfolge, in der sie geschrieben wurden, und gelten als gesehen: sie sind
nicht neu, nur weil es jetzt Bubbles gibt.

**Der Bereich, nicht die Kennzahl.** Im Altsystem hängt eine Bubble am
Dashboard (`kpi_key = "quality"`), eine Maßnahme an der Kennzahl
(`"quality.audit_findings"`). Die Bubble-Auswahl im Maßnahmenformular fragt
dort die Bubbles der Kennzahl ab und findet deshalb nie eine. Hier trägt die
Bubble ihren Bereich, und das Formular bietet die Bubbles des Bereichs der
gewählten Kennzahl an. `schluessel` bleibt als optionale Zuordnung.

**Priorität** niedrig/mittel/hoch, Vorgabe mittel wie im Altsystem. Die
bestehende Maßnahme „Test" steht in Produktion auf mittel und bekommt damit
denselben Wert.

**Verantwortliche** wählt das Altsystem aus Personio (aktive Personen,
„Nachname, Vorname"). Die Personaltabelle darf nur lesen, wer `hr` hat; wer
Maßnahmen pflegt, hat das nicht unbedingt. `kpi_verantwortliche()` gibt
deshalb nur die Namen heraus, und nur an die, die Maßnahmen schreiben dürfen.
Gespeichert wird weiter der Name als Text — so steht die Zuständigkeit auch
dann noch da, wenn die Person Personio verlässt.

Rechte wie bisher: lesen `kpi`, schreiben `settings: editor`.
"""
from alembic import op

revision = "0050_kpi_bubbles"
down_revision = "0042_einkauf_produktion"
branch_labels = None
depends_on = None

UPGRADE = """
alter table public.kpi_kommentare
    add column bereich         varchar(32),
    add column nummer          integer,
    -- Rechteck auf der Dashboard-Seite, als Anteil ihrer Breite und Hoehe.
    -- Ohne Position ist die Bubble nur in der Liste zu sehen.
    add column pos_x           numeric(9, 6),
    add column pos_y           numeric(9, 6),
    add column breite          numeric(9, 6),
    add column hoehe           numeric(9, 6),
    add column ampel           varchar(8) check (ampel in ('rot', 'gelb', 'gruen')),
    add column verfasser_email text,
    -- NULL: noch von niemandem angesehen, der Maßnahmen pflegt.
    add column gesehen_am      timestamptz,
    add constraint kpi_kommentare_position_check check (
        (pos_x is null and pos_y is null and breite is null and hoehe is null)
        -- `coalesce`: ein fehlendes Feld macht `between` zu NULL, und ein
        -- NULL laesst ein Check durch.
        or coalesce(pos_x between 0 and 1 and pos_y between 0 and 1
                    and breite between 0 and 1 and hoehe between 0 and 1, false)
    ),
    alter column schluessel drop not null;

-- Vorhandene Kommentare: Bereich aus der Kennzahl, Nummer nach Alter.
update public.kpi_kommentare k
   set bereich = z.bereich
  from public.zielwerte z
 where z.schluessel = k.schluessel;

update public.kpi_kommentare k
   set nummer = n.nr,
       gesehen_am = coalesce(k.gesehen_am, now())
  from (select id, row_number() over (partition by bereich order by erstellt_am, id) as nr
          from public.kpi_kommentare) n
 where n.id = k.id;

alter table public.kpi_kommentare alter column bereich set not null;

create index kpi_kommentare_bereich_idx on public.kpi_kommentare (bereich, nummer);

-- Bereich, Nummer und Verfasser setzt die Datenbank. `security definer`,
-- weil die Nummer ueber alle Bubbles des Bereichs zaehlen muss, auch ueber
-- die, die der Schreibende selbst nicht lesen duerfte.
create or replace function public.kpi_kommentare_vorbelegt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.verfasser := auth.uid();
    new.verfasser_email := auth.jwt() ->> 'email';
    if new.bereich is null and new.schluessel is not null then
        select z.bereich into new.bereich
          from public.zielwerte z where z.schluessel = new.schluessel;
    end if;
    if new.nummer is null then
        select coalesce(max(k.nummer), 0) + 1 into new.nummer
          from public.kpi_kommentare k where k.bereich = new.bereich;
    end if;
    return new;
end;
$$;

create trigger kpi_kommentare_vorbelegt
    before insert on public.kpi_kommentare
    for each row execute function public.kpi_kommentare_vorbelegt();

-- Als gesehen markieren ist eine Aenderung — dieselbe Schranke wie Schreiben.
create policy kpi_kommentare_update on public.kpi_kommentare
    for update to authenticated
    using (public.app_mindestens('settings', 'editor'))
    with check (public.app_mindestens('settings', 'editor'));

alter table public.kpi_massnahmen
    add column prioritaet   varchar(8) not null default 'mittel'
                            check (prioritaet in ('niedrig', 'mittel', 'hoch')),
    -- Die Bubble, aus der die Maßnahme entstand. Geht die Bubble, bleibt die
    -- Maßnahme — nur ohne Zuordnung.
    add column kommentar_id uuid references public.kpi_kommentare (id) on delete set null;

create or replace function public.kpi_verantwortliche()
returns table (name text)
language sql
stable
security definer
set search_path = public
as $$
    select distinct concat_ws(', ', nullif(btrim(e.last_name), ''),
                                    nullif(btrim(e.first_name), '')) as name
      from public.personio_employees e
     where e.status = 'active'
       and coalesce(nullif(btrim(e.last_name), ''), nullif(btrim(e.first_name), '')) is not null
       and public.app_mindestens('settings', 'editor')
     order by 1;
$$;

grant execute on function public.kpi_verantwortliche() to authenticated;
"""

DOWNGRADE = """
drop function if exists public.kpi_verantwortliche();
alter table public.kpi_massnahmen
    drop column if exists kommentar_id,
    drop column if exists prioritaet;
drop policy if exists kpi_kommentare_update on public.kpi_kommentare;
drop trigger if exists kpi_kommentare_vorbelegt on public.kpi_kommentare;
drop function if exists public.kpi_kommentare_vorbelegt();
drop index if exists public.kpi_kommentare_bereich_idx;
-- Scheitert, wenn es Bubbles ohne Kennzahl gibt. Das ist gewollt: loeschen
-- soll ein Rueckbau nichts.
alter table public.kpi_kommentare
    alter column schluessel set not null,
    drop constraint if exists kpi_kommentare_position_check,
    drop column if exists gesehen_am,
    drop column if exists verfasser_email,
    drop column if exists ampel,
    drop column if exists hoehe,
    drop column if exists breite,
    drop column if exists pos_y,
    drop column if exists pos_x,
    drop column if exists nummer,
    drop column if exists bereich;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
