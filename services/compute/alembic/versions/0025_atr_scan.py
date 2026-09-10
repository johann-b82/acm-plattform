"""ATR: der Eingangsordner auf dem Dateiserver.

Revision ID: 0025_atr_scan
Revises: 0024_atr_ausgaben
Create Date: 2026-09-10

Vierter und letzter Teil. Ein Ordner auf dem Dateiserver wird regelmäßig
durchgesehen; jedes Lieferschein-PDF darin wird eingelesen, wird zur Lieferung
und wandert ins Archiv.

**Das Passwort steht nicht in der Datenbank.** Im Altprojekt liegt es
Fernet-verschlüsselt in `app_settings`, der Schlüssel dazu in der Umgebung —
zwei Dinge zu verwalten statt einem, und der Geheimtext landet in jedem Abzug
und jeder Sicherung. Hier steht es als `ATR_SMB_PASSWORT` in der Umgebung von
`compute`, wie das Personio-Geheimnis auch. Was hier steht, ist Konfiguration:
Rechner, Freigabe, Domäne, Benutzer und die drei Pfade.

**Das Ziel ist nicht frei wählbar.** Befund 16 im Altprojekt: ein Admin trägt
in der Maske einen Rechner ein, und der Dienst verbindet sich dorthin — ein
Weg, den Dienst gegen ein beliebiges Ziel im Netz laufen zu lassen. Der
Betreiber gibt deshalb in `ATR_SMB_ERLAUBT` vor, welche Rechner in Frage
kommen; was hier eingetragen wird, muss dazu passen. Geprüft wird in
`compute`, weil nur dort die Umgebung bekannt ist.

Eine Zeile, kein Verlauf: es gibt genau einen Eingangsordner.
"""
from alembic import op

revision = "0025_atr_scan"
down_revision = "0024_atr_ausgaben"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.atr_scan (
    -- Genau eine Zeile. Der Riegel steht in der Bedingung, nicht in der
    -- Absprache.
    id           boolean primary key default true check (id),
    aktiv        boolean not null default false,
    -- `entwurf` legt Lieferungen zur Durchsicht an; `automatisch` erzeugt die
    -- Dateien gleich mit und schreibt sie in den Ausgangsordner.
    modus        varchar(16) not null default 'entwurf'
                 check (modus in ('entwurf', 'automatisch')),
    rechner      varchar(255),
    freigabe     varchar(255),
    domaene      varchar(64),
    benutzer     varchar(128),
    eingang      varchar(500),
    ausgang      varchar(500),
    archiv       varchar(500),
    -- Was der letzte Lauf ergeben hat. Ein Scan, der stillschweigend nichts
    -- tut, sieht aus wie ein Scan, der nicht läuft.
    zuletzt_am   timestamptz,
    zuletzt_text text,
    geaendert_am timestamptz not null default now()
);

insert into public.atr_scan (id) values (true);

alter table public.atr_scan enable row level security;

grant select, update on public.atr_scan to authenticated;

-- Sehen darf, wer ATR sieht; ändern die Plattform-Verwaltung. Ein Ziel im
-- Netz und ein Anmeldename sind Betriebseinstellungen, keine Fachdaten.
create policy atr_scan_read on public.atr_scan
    for select to authenticated using (public.app_level('atr') is not null);
create policy atr_scan_schreiben on public.atr_scan
    for update to authenticated
    using (public.app_mindestens('platform', 'admin'))
    with check (public.app_mindestens('platform', 'admin'));

create trigger atr_scan_beruehrt before update on public.atr_scan
    for each row execute function public.atr_beruehrt();

-- ---------------------------------------------------------------------------
-- Der regelmaessige Anstoss. Wie beim Personio-Abgleich: pg_cron kann nur SQL,
-- den HTTP-Aufruf macht pg_net, und das Geheimnis steht in einer
-- Datenbank-Einstellung statt in dieser Datei — sonst laege es in der
-- Historie des Repos.
--
--   alter database postgres set acm.atr_scan_token = '<geheimnis>';
--
-- Als `supabase_admin` — `postgres` darf den Parameter nicht setzen.
--
-- Ohne gesetzten Wert wird kein Job angelegt; der Scan laeuft dann nur von
-- Hand ueber die Oberflaeche.
-- ---------------------------------------------------------------------------
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
    -- Ist der Scan abgeschaltet, gar nicht erst anklopfen.
    select aktiv into laeuft from public.atr_scan where id;
    if not coalesce(laeuft, false) then
        return null;
    end if;
    select net.http_post(
        url     := 'http://compute:8000/api/atr/scan/geplant',
        headers := jsonb_build_object('X-ATR-Scan-Token', geheim),
        -- Ein Lauf kann Minuten dauern (LibreOffice); pg_net wartet nicht,
        -- sondern legt die Antwort spaeter in net._http_response ab.
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
        perform cron.schedule(
            'atr-eingangsordner',
            -- Alle zehn Minuten waehrend der Arbeitszeit. Nachts liegt dort
            -- nichts, und ein Lauf ins Leere kostet eine SMB-Anmeldung.
            '*/10 5-19 * * 1-5',
            'select public.atr_scan_anstossen()'
        );
    end if;
end
$$;
"""

DOWNGRADE = """
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.unschedule('atr-eingangsordner');
    end if;
exception when others then
    null;
end
$$;

drop function if exists public.atr_scan_anstossen();
drop table if exists public.atr_scan;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
