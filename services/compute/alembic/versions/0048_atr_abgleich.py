"""ATR an das Altsystem angleichen: Zustände, Scan-Takt, Dateiserver-Passwort.

Revision ID: 0048_atr_abgleich
Revises: 0040_bereich_hr
Create Date: 2026-09-12

**Die Zustände des Altsystems (ATR-09).** Dort heißt eine Lieferung `draft`,
bis ihre Dokumente erzeugt sind (`generated`), und `delivered`, wenn der
automatische Scan sie in den Ausgangsordner geschrieben hat
(`services/atr_deliver.py`). Eine Freigabe gibt es dort nicht, und nichts
sperrt die Positionen — Seriennummern werden nach der Erzeugung nachgetragen
und die Dokumente neu erzeugt. Hier hieß es bisher `entwurf`/`freigegeben`,
und die Übernahme hat `generated` bewusst auf `entwurf` gelegt, weil die
Dateien damals nicht mitkamen. Seitdem sie nachgeholt sind, stand eine
Lieferung mit Erzeugungsdatum und Dokumenten als „Entwurf“ mit der Aktion
„Freigeben“ da (Lieferung 20190364 / ATR 4943).

Neu also `entwurf` → `erzeugt` → `abgelegt`. Korrigiert wird nur aus dem, was
in der Zeile steht: ein Erzeugungsdatum heißt erzeugt. Eine freigegebene
Lieferung ohne Erzeugungsdatum wird wieder Entwurf — nichts wird pauschal
hochgestuft. Der Riegel `atr_freigegeben_ist_fest` fällt mit dem Zustand weg.

Ein Statuswechsel ist keine Änderung an den Daten: er zieht `geaendert_am`
nicht hoch. Sonst meldete die Maske jede gerade erzeugte oder abgelegte Mappe
als „danach geändert“ — und die Korrektur hier jede übernommene.

**Der Takt (SET-14).** Statt fest alle zehn Minuten werktags 5–19 Uhr ein
freies Intervall in Sekunden, 0 = aus, wie im Altsystem. pg_cron klopft alle
zehn Sekunden an; `atr_scan_faellig()` entscheidet mit einem einzigen
Schreibvorgang, ob wirklich ein Lauf dran ist — zwei Anstöße zugleich können
ihn deshalb nicht beide auslösen. `lauf_seit` hält während eines Laufs den
nächsten fern; `compute` setzt und löscht ihn und bleibt dabei zustandslos.
Ein Stempel, der älter als eine Stunde ist, gilt als verwaist.

Der bisherige Schalter `aktiv` geht im Intervall auf: an wird 600 Sekunden
(der alte Zehn-Minuten-Takt, jetzt ohne Zeitfenster), aus wird 0.

**Das Passwort (SET-13)** steht verschlüsselt in `geheimnisse` unter
`atr_smb_passwort` — die Tabelle gibt es schon (0038), hier ist nichts zu tun.
"""
from alembic import op

revision = "0048_atr_abgleich"
down_revision = "0040_bereich_hr"
branch_labels = None
depends_on = None

#: Aus vorhandenen Feldern, sonst nichts. Als eigene Anweisung, damit ein Test
#: sie gegen echte Zeilen laufen lassen kann.
KORREKTUR = """
update public.atr_lieferungen
   set status = case when erzeugt_am is not null then 'erzeugt' else 'entwurf' end
 where status = 'freigegeben'
    or (status = 'entwurf' and erzeugt_am is not null)
"""

ZUSTAENDE = """
drop trigger if exists atr_positionen_fest on public.atr_positionen;
drop function if exists public.atr_freigegeben_ist_fest();

alter table public.atr_lieferungen drop constraint atr_lieferungen_status_check;

-- Pfade, Erzeugungsdatum und Status sind keine Änderung an der Lieferung.
create or replace function public.atr_lieferung_beruehrt()
returns trigger
language plpgsql
as $$
begin
    if to_jsonb(new) - 'mappe_pfad' - 'pdf_pfad' - 'etikett_pfad'
           - 'erzeugt_am' - 'geaendert_am' - 'status'
       = to_jsonb(old) - 'mappe_pfad' - 'pdf_pfad' - 'etikett_pfad'
           - 'erzeugt_am' - 'geaendert_am' - 'status'
    then
        new.geaendert_am := old.geaendert_am;
        return new;
    end if;
    new.geaendert_am := now();
    return new;
end;
$$;
"""

ZUSTAENDE_PRUEFUNG = """
alter table public.atr_lieferungen add constraint atr_lieferungen_status_check
    check (status in ('entwurf', 'erzeugt', 'abgelegt'));
"""

TAKT = """
alter table public.atr_scan
    add column intervall_s    integer not null default 0 check (intervall_s >= 0),
    add column angestossen_am timestamptz,
    add column lauf_seit      timestamptz;

update public.atr_scan set intervall_s = case when aktiv then 600 else 0 end;

alter table public.atr_scan drop column aktiv;

-- Den Laufstempel und den letzten Anstoß schreibt nur der Dienst. Wer
-- `lauf_seit` setzen könnte, hielte den Scan für eine Stunde an.
revoke update on public.atr_scan from authenticated;
grant update (modus, rechner, freigabe, domaene, benutzer, eingang, ausgang, archiv,
              intervall_s)
    on public.atr_scan to authenticated;

create or replace function public.atr_scan_faellig()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Fünf Sekunden Spielraum, ein halber Takt: sonst würde aus 60 Sekunden
    -- durch Laufzeitschwankung des Anstoßes jedes zweite Mal 70.
    update public.atr_scan
       set angestossen_am = now()
     where id
       and intervall_s > 0
       and (angestossen_am is null
            or angestossen_am + make_interval(secs => intervall_s)
               <= now() + interval '5 seconds')
       and (lauf_seit is null or lauf_seit < now() - interval '1 hour');
    return found;
end;
$$;

revoke execute on function public.atr_scan_faellig() from public, anon, authenticated;

create or replace function public.atr_scan_anstossen()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    geheim  text := current_setting('acm.atr_scan_token', true);
    anfrage bigint;
begin
    -- Ohne Geheimnis still: alle zehn Sekunden eine Notiz wäre Lärm im Log.
    if geheim is null or geheim = '' then
        return null;
    end if;
    if not public.atr_scan_faellig() then
        return null;
    end if;
    select net.http_post(
        url     := 'http://compute:8000/api/atr/scan/geplant',
        headers := jsonb_build_object('X-ATR-Scan-Token', geheim),
        -- Ein Lauf kann Minuten dauern (LibreOffice); pg_net wartet nicht.
        timeout_milliseconds := 5000
    ) into anfrage;
    return anfrage;
end;
$$;

revoke execute on function public.atr_scan_anstossen() from public, anon, authenticated;

do $$
begin
    if exists (select 1 from pg_available_extensions where name = 'pg_net')
       and exists (select 1 from pg_available_extensions where name = 'pg_cron') then
        execute 'create extension if not exists pg_net';
        execute 'create extension if not exists pg_cron';
        -- Derselbe Name ersetzt den alten Plan.
        perform cron.schedule(
            'atr-eingangsordner', '10 seconds', 'select public.atr_scan_anstossen()'
        );
    end if;
end
$$;
"""

DOWNGRADE = """
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule(
            'atr-eingangsordner', '*/10 5-19 * * 1-5', 'select public.atr_scan_anstossen()'
        );
    end if;
end
$$;

alter table public.atr_scan add column aktiv boolean not null default false;
update public.atr_scan set aktiv = intervall_s > 0;

create or replace function public.atr_scan_anstossen()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    geheim  text := current_setting('acm.atr_scan_token', true);
    laeuft  boolean;
    anfrage bigint;
begin
    if geheim is null or geheim = '' then
        raise notice 'acm.atr_scan_token ist nicht gesetzt — Scan uebersprungen';
        return null;
    end if;
    select aktiv into laeuft from public.atr_scan where id;
    if not coalesce(laeuft, false) then
        return null;
    end if;
    select net.http_post(
        url     := 'http://compute:8000/api/atr/scan/geplant',
        headers := jsonb_build_object('X-ATR-Scan-Token', geheim),
        timeout_milliseconds := 5000
    ) into anfrage;
    return anfrage;
end;
$$;

drop function if exists public.atr_scan_faellig();

revoke update (modus, rechner, freigabe, domaene, benutzer, eingang, ausgang, archiv,
               intervall_s)
    on public.atr_scan from authenticated;
alter table public.atr_scan
    drop column lauf_seit,
    drop column angestossen_am,
    drop column intervall_s;
grant update on public.atr_scan to authenticated;

-- Erzeugt und abgelegt waren vorher Entwürfe; eine Freigabe lässt sich nicht
-- zurückerfinden.
alter table public.atr_lieferungen drop constraint atr_lieferungen_status_check;
update public.atr_lieferungen set status = 'entwurf' where status in ('erzeugt', 'abgelegt');
alter table public.atr_lieferungen add constraint atr_lieferungen_status_check
    check (status in ('entwurf', 'freigegeben'));

create or replace function public.atr_lieferung_beruehrt()
returns trigger
language plpgsql
as $$
begin
    if new.erzeugt_am is distinct from old.erzeugt_am
       and to_jsonb(new) - 'mappe_pfad' - 'pdf_pfad' - 'etikett_pfad'
           - 'erzeugt_am' - 'geaendert_am'
           = to_jsonb(old) - 'mappe_pfad' - 'pdf_pfad' - 'etikett_pfad'
           - 'erzeugt_am' - 'geaendert_am'
    then
        new.geaendert_am := old.geaendert_am;
        return new;
    end if;
    new.geaendert_am := now();
    return new;
end;
$$;

create or replace function public.atr_freigegeben_ist_fest()
returns trigger
language plpgsql
as $$
declare
    zustand text;
begin
    select l.status into zustand
      from public.atr_lieferungen l
     where l.id = coalesce(new.lieferung_id, old.lieferung_id);
    if zustand = 'freigegeben' then
        raise exception 'Die Lieferung ist freigegeben und wird nicht mehr geändert'
            using errcode = '23514';
    end if;
    return coalesce(new, old);
end;
$$;

create trigger atr_positionen_fest
    before insert or update or delete on public.atr_positionen
    for each row execute function public.atr_freigegeben_ist_fest();
"""


def upgrade() -> None:
    op.execute(ZUSTAENDE)
    op.execute(KORREKTUR)
    op.execute(ZUSTAENDE_PRUEFUNG)
    op.execute(TAKT)


def downgrade() -> None:
    op.execute(DOWNGRADE)
