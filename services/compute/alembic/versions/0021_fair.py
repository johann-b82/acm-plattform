"""FAIR: Zeichnung mit nummerierten Ballons (Erstmusterprüfung).

Revision ID: 0021_fair
Revises: 0020_newsletter
Create Date: 2026-09-10

Eine Zeichnung wird hochgeladen, und zu jedem zu prüfenden Maß setzt man einen
nummerierten Ballon. Die Nummern sind das Ergebnis: sie stehen später im
Prüfbericht neben den gemessenen Werten.

**Koordinaten sind normiert.** Alles liegt als Bruchteil [0,1] der natürlichen
Seitengröße vor, dazu die Seitennummer. Damit hängt ein Ballon nicht an der
Auflösung, an der Zoomstufe oder daran, wie breit das Fenster gerade war.

**Die Nummerierung gehört der Datenbank.** Im Altprojekt zählt der Router die
höchste Nummer hoch und schreibt nach einem Löschen alle Ballons in zwei
Durchgängen um — mit einem Zwischenwert oberhalb einer Million, weil die
Eindeutigkeit sonst mitten im Umschreiben bricht. Hier ist die Bedingung
`deferrable initially deferred`: sie wird erst beim Commit geprüft, und ein
einziges `update` genügt. Der Trigger schließt die Lücke nach einem Löschen von
selbst, sodass es keinen Weg gibt, auf dem Lücken entstehen können.
"""
from alembic import op

revision = "0021_fair"
down_revision = "0020_newsletter"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.fair_zeichnungen (
    id            uuid primary key default gen_random_uuid(),
    name          varchar(255) not null check (btrim(name) <> ''),
    teilenummer   varchar(64),
    kunde         varchar(255),
    artikelnummer varchar(64),
    -- Objektname im Eimer `fair`.
    pfad          text not null,
    art           varchar(8) not null check (art in ('pdf', 'bild')),
    mime          varchar(127),
    seiten        smallint not null default 1 check (seiten >= 1),
    -- Nur fuer die Anzeige. Ballons liegen immer in kanonischen Koordinaten,
    -- sonst waere ein Drehen der Ansicht eine Datenaenderung.
    drehung       smallint not null default 0 check (drehung in (0, 90, 180, 270)),
    erstellt_am   timestamptz not null default now(),
    geaendert_am  timestamptz not null default now()
);

create table public.fair_ballons (
    id           uuid primary key default gen_random_uuid(),
    zeichnung_id uuid not null references public.fair_zeichnungen (id) on delete cascade,
    nummer       smallint not null check (nummer >= 1),
    seite        smallint not null default 1 check (seite >= 1),
    -- Markiertes Feld, normiert. Die Pfeilspitze ist dessen Mitte und wird
    -- nicht gespeichert — sie ergibt sich.
    bereich_x    numeric(9, 6) not null,
    bereich_y    numeric(9, 6) not null,
    bereich_b    numeric(9, 6) not null,
    bereich_h    numeric(9, 6) not null,
    -- Wo die Blase sitzt.
    blase_x      numeric(9, 6) not null,
    blase_y      numeric(9, 6) not null,
    wert         text not null default '',
    erstellt_am  timestamptz not null default now(),
    geaendert_am timestamptz not null default now(),
    -- Aufgeschoben: beim Umnummerieren ist die Eindeutigkeit zwischendurch
    -- verletzt. Geprueft wird am Ende der Transaktion, nicht nach jeder Zeile.
    constraint fair_ballons_nummer_eindeutig unique (zeichnung_id, nummer)
        deferrable initially deferred
);

create index fair_ballons_zeichnung_idx on public.fair_ballons (zeichnung_id, nummer);

alter table public.fair_zeichnungen enable row level security;
alter table public.fair_ballons enable row level security;

grant select, insert, update, delete
    on public.fair_zeichnungen, public.fair_ballons to authenticated;

create policy fair_zeichnungen_read on public.fair_zeichnungen
    for select to authenticated using (public.app_level('fair') is not null);
create policy fair_zeichnungen_schreiben on public.fair_zeichnungen
    for all to authenticated
    using (public.app_mindestens('fair', 'editor'))
    with check (public.app_mindestens('fair', 'editor'));

-- Ballons erben die Sichtbarkeit ihrer Zeichnung, statt die Bedingung zu
-- wiederholen.
create policy fair_ballons_read on public.fair_ballons
    for select to authenticated using (
        exists (select 1 from public.fair_zeichnungen z where z.id = zeichnung_id)
    );
create policy fair_ballons_schreiben on public.fair_ballons
    for all to authenticated
    using (public.app_mindestens('fair', 'editor'))
    with check (public.app_mindestens('fair', 'editor'));

create or replace function public.fair_beruehrt()
returns trigger
language plpgsql
as $$
begin
    new.geaendert_am := now();
    return new;
end;
$$;

create trigger fair_zeichnungen_beruehrt before update on public.fair_zeichnungen
    for each row execute function public.fair_beruehrt();
create trigger fair_ballons_beruehrt before update on public.fair_ballons
    for each row execute function public.fair_beruehrt();

-- ---------------------------------------------------------------------------
-- Nummerierung
-- ---------------------------------------------------------------------------
-- Eine neue Nummer ist die naechste freie. `for update` auf die Zeichnung
-- serialisiert zwei gleichzeitige Ballons derselben Zeichnung; ohne das
-- bekaemen beide dieselbe Nummer und der zweite Commit schluege fehl.
create or replace function public.fair_ballon_nummer()
returns trigger
language plpgsql
as $$
begin
    if new.nummer is null or new.nummer = 0 then
        perform 1 from public.fair_zeichnungen where id = new.zeichnung_id for update;
        select coalesce(max(nummer), 0) + 1 into new.nummer
          from public.fair_ballons where zeichnung_id = new.zeichnung_id;
    end if;
    return new;
end;
$$;

create trigger fair_ballon_nummer before insert on public.fair_ballons
    for each row execute function public.fair_ballon_nummer();

-- Nach dem Loeschen die Luecke schliessen. Als Trigger, damit es keinen Weg
-- gibt, auf dem Luecken entstehen — auch nicht ueber PostgREST.
create or replace function public.fair_luecke_schliessen()
returns trigger
language plpgsql
as $$
begin
    update public.fair_ballons b
       set nummer = neu.rang
      from (
        select id, row_number() over (order by nummer) as rang
          from public.fair_ballons
         where zeichnung_id = old.zeichnung_id
      ) neu
     where b.id = neu.id and b.nummer <> neu.rang;
    return null;
end;
$$;

create trigger fair_luecke_schliessen after delete on public.fair_ballons
    for each row execute function public.fair_luecke_schliessen();

-- Ausdrueckliches Umsortieren: die Reihenfolge der Kennungen wird zur
-- Nummernfolge. Ein einziges `update` reicht, weil die Bedingung aufgeschoben
-- ist.
create or replace function public.fair_reihenfolge(p_zeichnung uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
as $$
declare
    betroffen integer;
begin
    update public.fair_ballons b
       set nummer = neu.rang
      from (
        select unnest(p_ids) as id, generate_subscripts(p_ids, 1) as rang
      ) neu
     where b.id = neu.id and b.zeichnung_id = p_zeichnung;
    get diagnostics betroffen = row_count;

    -- Wer nicht in der Liste stand, haette jetzt womoeglich eine doppelte
    -- Nummer. Lieber gar nichts aendern als eine halbe Reihenfolge.
    if betroffen <> (select count(*) from public.fair_ballons
                      where zeichnung_id = p_zeichnung) then
        raise exception 'Die Liste muss alle Ballons der Zeichnung enthalten'
            using errcode = '22023';
    end if;
end;
$$;

grant execute on function public.fair_reihenfolge(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Der Eimer fuer die Zeichnungen.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fair', 'fair', false, 52428800,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy fair_datei_hoch on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'fair'
        and public.app_mindestens('fair', 'editor')
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy fair_datei_lesen on storage.objects
    for select to authenticated
    using (bucket_id = 'fair' and public.app_level('fair') is not null);

create policy fair_datei_weg on storage.objects
    for delete to authenticated
    using (bucket_id = 'fair' and public.app_mindestens('fair', 'editor'));
"""

DOWNGRADE = """
drop policy if exists fair_datei_weg on storage.objects;
drop policy if exists fair_datei_lesen on storage.objects;
drop policy if exists fair_datei_hoch on storage.objects;
-- Eimer und Dateien bleiben stehen, siehe 0019_feedback.
drop function if exists public.fair_reihenfolge(uuid, uuid[]);
drop trigger if exists fair_luecke_schliessen on public.fair_ballons;
drop function if exists public.fair_luecke_schliessen();
drop trigger if exists fair_ballon_nummer on public.fair_ballons;
drop function if exists public.fair_ballon_nummer();
drop trigger if exists fair_ballons_beruehrt on public.fair_ballons;
drop trigger if exists fair_zeichnungen_beruehrt on public.fair_zeichnungen;
drop function if exists public.fair_beruehrt();
drop table if exists public.fair_ballons;
drop table if exists public.fair_zeichnungen;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
