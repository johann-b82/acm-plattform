"""Newsletter: vierteljährliche Ausgabe, online lesbar und als PDF.

Revision ID: 0020_newsletter
Revises: 0019_feedback
Create Date: 2026-09-10

Eine Ausgabe je Quartal, darin Kapitel, darin Einträge aus Markdown und
Bildern. Gelesen von allen mit `newsletter`-Recht, geschrieben ab `editor`.

**Kapitel sind Zeilen, keine Konstante.** Im Altprojekt stehen sechs Rubriken
als Tupel im Code (`NEWSLETTER_RUBRIKEN`). Weil das zu starr war, kamen zwei
JSONB-Spalten dazu, die es überschreiben: `block_reihenfolge` für die
Reihenfolge und `rubrik_titel` für die Namen — plus ein eigener Weg für
ausgabe-eigene Kapitel und zwei Schlüssel, an denen Verhalten hängt („kpi"
wird aus der Reihenfolge gefiltert und vor „intern" eingeschoben,
„menschen" bekommt Neuzugänge vorangestellt).

Hier ist ein Kapitel eine Zeile mit Titel, Sortierung und Art. Damit fallen
beide Überschreibungsspalten weg, der Sonderweg fällt weg, und aus den zwei
verhaltenstragenden Schlüsseln wird ein Feld: `art`.

**Was eine Ausgabe zeigt, friert sie ein.** Belegschaftszahlen und Neuzugänge
stammen aus `personio_employees` — einer Tabelle, die sich weiterdreht und die
ein Newsletter-Leser nicht sehen darf. Eine Ausgabe vom letzten Quartal darf
beides nicht live nachschlagen: sie soll sagen, was sie damals sagte. Beides
steht deshalb als `stand` am Kapitel.

Einfrieren darf, wer den Newsletter bearbeitet **und** die Quelle sehen dürfte.
Die beiden Quellen sind verschieden streng, also sind es die beiden Funktionen
auch: die Belegschaftszahlen sind Aggregate und hängen wie überall an
`app_level('kpi')`; die Namen der Neuzugänge sind es nicht und verlangen
`app_level('hr')`, genau wie die Tabelle, aus der sie kommen.

**Bilder liegen im Speicher.** Im Altprojekt stecken sie als `bytea` in drei
Tabellen. Siehe `docs/modules/feedback.md` für die Regeln, die dabei gelten.
"""
from alembic import op

revision = "0020_newsletter"
down_revision = "0019_feedback"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.newsletter (
    id           uuid primary key default gen_random_uuid(),
    jahr         smallint not null check (jahr between 2000 and 2100),
    quartal      smallint not null check (quartal between 1 and 4),
    titel        varchar(200),
    status       varchar(16) not null default 'entwurf'
                 check (status in ('entwurf', 'veroeffentlicht')),
    -- Objektnamen im Eimer `newsletter`; NULL heisst kein Bild.
    titelbild    text,
    rueckseite   text,
    erstellt_am  timestamptz not null default now(),
    geaendert_am timestamptz not null default now(),
    unique (jahr, quartal)
);

create table public.newsletter_kapitel (
    id            uuid primary key default gen_random_uuid(),
    newsletter_id uuid not null references public.newsletter (id) on delete cascade,
    titel         varchar(120) not null check (btrim(titel) <> ''),
    -- `eintraege` ist ein gewoehnliches Kapitel. `kpi` und `neuzugaenge`
    -- zeigen stattdessen, was in `stand` eingefroren ist.
    art           varchar(16) not null default 'eintraege'
                  check (art in ('eintraege', 'kpi', 'neuzugaenge')),
    stand         jsonb,
    sortierung    smallint not null default 0
);

create index newsletter_kapitel_idx
    on public.newsletter_kapitel (newsletter_id, sortierung);

create table public.newsletter_eintrag (
    id         uuid primary key default gen_random_uuid(),
    kapitel_id uuid not null references public.newsletter_kapitel (id) on delete cascade,
    untertitel varchar(200) not null default '',
    -- Markdown. Gerendert wird ohne rohes HTML.
    inhalt_md  text not null default '',
    sortierung smallint not null default 0
);

create index newsletter_eintrag_idx
    on public.newsletter_eintrag (kapitel_id, sortierung);

create table public.newsletter_bild (
    id         uuid primary key default gen_random_uuid(),
    eintrag_id uuid not null references public.newsletter_eintrag (id) on delete cascade,
    pfad       text not null,
    -- Zellen im vierspaltigen Raster.
    spalten    smallint not null default 1 check (spalten between 1 and 4),
    zeilen     smallint not null default 1 check (zeilen between 1 and 2),
    sortierung smallint not null default 0
);

create index newsletter_bild_idx on public.newsletter_bild (eintrag_id, sortierung);

alter table public.newsletter enable row level security;
alter table public.newsletter_kapitel enable row level security;
alter table public.newsletter_eintrag enable row level security;
alter table public.newsletter_bild enable row level security;

grant select, insert, update, delete
    on public.newsletter, public.newsletter_kapitel,
       public.newsletter_eintrag, public.newsletter_bild
    to authenticated;

-- Lesen: eine veroeffentlichte Ausgabe sieht, wer das Recht hat. Einen
-- Entwurf sieht nur die Redaktion — sonst laege die halbfertige Ausgabe
-- offen, waehrend daran geschrieben wird.
create policy newsletter_read on public.newsletter
    for select to authenticated using (
        (status = 'veroeffentlicht' and public.app_level('newsletter') is not null)
        or public.app_mindestens('newsletter', 'editor')
    );

create policy newsletter_schreiben on public.newsletter
    for all to authenticated
    using (public.app_mindestens('newsletter', 'editor'))
    with check (public.app_mindestens('newsletter', 'editor'));

-- Die Kinder erben die Sichtbarkeit ihrer Ausgabe. `exists` statt einer
-- eigenen Bedingung: sonst gaebe es zwei Orte, an denen steht, wer eine
-- Ausgabe sehen darf, und einer davon liefe irgendwann hinterher.
create policy newsletter_kapitel_read on public.newsletter_kapitel
    for select to authenticated using (
        exists (select 1 from public.newsletter n where n.id = newsletter_id)
    );
create policy newsletter_kapitel_schreiben on public.newsletter_kapitel
    for all to authenticated
    using (public.app_mindestens('newsletter', 'editor'))
    with check (public.app_mindestens('newsletter', 'editor'));

create policy newsletter_eintrag_read on public.newsletter_eintrag
    for select to authenticated using (
        exists (select 1 from public.newsletter_kapitel k where k.id = kapitel_id)
    );
create policy newsletter_eintrag_schreiben on public.newsletter_eintrag
    for all to authenticated
    using (public.app_mindestens('newsletter', 'editor'))
    with check (public.app_mindestens('newsletter', 'editor'));

create policy newsletter_bild_read on public.newsletter_bild
    for select to authenticated using (
        exists (select 1 from public.newsletter_eintrag e where e.id = eintrag_id)
    );
create policy newsletter_bild_schreiben on public.newsletter_bild
    for all to authenticated
    using (public.app_mindestens('newsletter', 'editor'))
    with check (public.app_mindestens('newsletter', 'editor'));

create or replace function public.newsletter_beruehrt()
returns trigger
language plpgsql
as $$
begin
    new.geaendert_am := now();
    return new;
end;
$$;

create trigger newsletter_beruehrt
    before update on public.newsletter
    for each row execute function public.newsletter_beruehrt();

-- ---------------------------------------------------------------------------
-- Einfrieren: was eine Ausgabe aus dem Personalbestand zeigt.
-- ---------------------------------------------------------------------------
-- Beide Funktionen sind `security definer`, weil sie an Daten kommen, die der
-- Aufrufer sonst nicht saehe — und pruefen deshalb selbst, was er mitbringen
-- muss. Ohne diese Pruefung waere jede der beiden ein Weg, Personaldaten ohne
-- das passende Recht zu bekommen.
--
-- Jahr und Quartal kommen aus der Ausgabe, nicht vom Aufrufer: eine Ausgabe
-- zeigt die Zahlen ihres eigenen Quartals, und niemand soll ein anderes
-- hineinschreiben koennen.
create or replace function public.newsletter_kpi_einfrieren(p_kapitel uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    ergebnis jsonb;
    a        record;
begin
    if not public.app_mindestens('newsletter', 'editor')
       or public.app_level('kpi') is null then
        raise exception 'Einfrieren verlangt Newsletter bearbeiten und Kennzahlen sehen'
            using errcode = '42501';
    end if;

    select n.jahr, n.quartal into a
      from public.newsletter_kapitel k
      join public.newsletter n on n.id = k.newsletter_id
     where k.id = p_kapitel and k.art = 'kpi';
    if not found then
        raise exception 'Kein KPI-Kapitel mit dieser Kennung' using errcode = 'P0002';
    end if;

    select to_jsonb(b) || jsonb_build_object(
               'verteilung',
               coalesce((select jsonb_agg(to_jsonb(v))
                           from public.kpi_hr_belegschaft_verteilung(a.jahr, a.quartal) v),
                        '[]'::jsonb))
      into ergebnis
      from public.kpi_hr_belegschaft(a.jahr, a.quartal) b;

    update public.newsletter_kapitel set stand = ergebnis where id = p_kapitel;
    return ergebnis;
end;
$$;

create or replace function public.newsletter_neuzugaenge_einfrieren(p_kapitel uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    ergebnis jsonb;
    a        record;
begin
    if not public.app_mindestens('newsletter', 'editor')
       or public.app_level('hr') is null then
        raise exception 'Einfrieren verlangt Newsletter bearbeiten und Personal sehen'
            using errcode = '42501';
    end if;

    select n.jahr, n.quartal into a
      from public.newsletter_kapitel k
      join public.newsletter n on n.id = k.newsletter_id
     where k.id = p_kapitel and k.art = 'neuzugaenge';
    if not found then
        raise exception 'Kein Neuzugangs-Kapitel mit dieser Kennung' using errcode = 'P0002';
    end if;

    -- Nur Name, Abteilung und Eintritt. Kein Geburtsdatum, kein Foto: das war
    -- Befund 4 im Altprojekt, und ein Newsletter braucht beides nicht.
    select coalesce(jsonb_agg(z order by z.hire_date, z.nachname), '[]'::jsonb)
      into ergebnis
      from (
        select e.first_name as vorname,
               e.last_name  as nachname,
               e.department as abteilung,
               e.hire_date
          from public.personio_employees e
         where e.hire_date >= make_date(a.jahr, (a.quartal - 1) * 3 + 1, 1)
           and e.hire_date < make_date(a.jahr, (a.quartal - 1) * 3 + 1, 1) + interval '3 months'
      ) z;

    update public.newsletter_kapitel set stand = ergebnis where id = p_kapitel;
    return ergebnis;
end;
$$;

grant execute on function public.newsletter_kpi_einfrieren(uuid) to authenticated;
grant execute on function public.newsletter_neuzugaenge_einfrieren(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Der Eimer fuer die Bilder.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('newsletter', 'newsletter', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Hochladen und wegraeumen darf die Redaktion, in den eigenen Ordner.
create policy newsletter_bild_hoch on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'newsletter'
        and public.app_mindestens('newsletter', 'editor')
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- Lesen: wer den Newsletter lesen darf. Anders als beim Feedback ist das
-- absichtlich weit — ein Newsletter ohne Bilder ist keiner.
create policy newsletter_bild_lesen on storage.objects
    for select to authenticated
    using (
        bucket_id = 'newsletter'
        and public.app_level('newsletter') is not null
    );

create policy newsletter_bild_weg on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'newsletter'
        and public.app_mindestens('newsletter', 'editor')
    );
"""

DOWNGRADE = """
drop policy if exists newsletter_bild_weg on storage.objects;
drop policy if exists newsletter_bild_lesen on storage.objects;
drop policy if exists newsletter_bild_hoch on storage.objects;
-- Eimer und Bilder bleiben stehen, siehe 0019_feedback.
drop function if exists public.newsletter_neuzugaenge_einfrieren(uuid);
drop function if exists public.newsletter_kpi_einfrieren(uuid);
drop trigger if exists newsletter_beruehrt on public.newsletter;
drop function if exists public.newsletter_beruehrt();
drop table if exists public.newsletter_bild;
drop table if exists public.newsletter_eintrag;
drop table if exists public.newsletter_kapitel;
drop table if exists public.newsletter;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
