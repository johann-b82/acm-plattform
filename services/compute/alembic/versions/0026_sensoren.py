"""Sensoren: Temperatur und Luftfeuchte per SNMP.

Revision ID: 0026_sensoren
Revises: 0025_atr_scan
Create Date: 2026-09-10

Ein Messgerät im Netz wird regelmäßig abgefragt; was es liefert, landet als
Zeitreihe in der Datenbank und als Kachel im Dashboard.

**Drei Tabellen statt zwei.** Eine gescheiterte Abfrage ist keine Messung. Sie
gehört trotzdem festgehalten, sonst sieht ein stiller Ausfall aus wie ein
Gerät, das gerade nichts zu melden hat. Messwerte stehen deshalb in
`sensor_messungen`, jeder Versuch in `sensor_versuche` — und die Oberfläche
kann „seit 40 Minuten offline" sagen, ohne die Zeitreihe zu durchsuchen.

**Die Community steht verschlüsselt in der Zeile.** Anders als beim
ATR-Dateiserver, wo ein einziges Passwort in die Umgebung passt, hat hier
jedes Gerät sein eigenes Geheimnis. Der Schlüssel dazu (`SENSOR_SCHLUESSEL`)
steht in der Umgebung von `compute`; ein Abzug der Datenbank allein gibt die
Community nicht her. Und weil das Spaltenrecht sie gar nicht erst freigibt,
kann PostgREST sie auch verschlüsselt nicht ausliefern.

**Grenzwerte je Gerät, nicht je Anlage.** Im Altprojekt lagen sie als vier
Spalten im Einstellungs-Singleton und galten für alle Geräte gleich. Ein
Serverraum und ein Lager haben aber nicht dieselbe Vorstellung von „zu warm".

**Der Takt kommt aus der Datenbank.** Im Altprojekt hält ein Thread in der API
den Zeitplan und macht den Dienst auf `--workers 1` fest. Hier stößt `pg_cron`
alle fünf Minuten über `pg_net` eine Route in `compute` an.
"""
from alembic import op

revision = "0026_sensoren"
down_revision = "0025_atr_scan"
branch_labels = None
depends_on = None

UPGRADE = """
-- Die Kachel zeigt jetzt auf eine Seite, die es gibt. Beim Anlegen des
-- Rechtemodells war der Pfad geraten.
update public.apps set path = '/sensoren' where id = 'sensors';

create table public.sensoren (
    id                uuid primary key default gen_random_uuid(),
    name              varchar(100) not null unique,
    rechner           varchar(255) not null,
    port              integer not null default 161 check (port between 1 and 65535),
    -- Fernet-Geheimtext. Der Schlüssel steht in der Umgebung von `compute`,
    -- nicht hier — sonst läge beides im selben Abzug.
    community         bytea not null,
    -- Mindestens eine der beiden Kennungen muss stehen, sonst gäbe es nichts
    -- abzufragen.
    temperatur_oid    varchar(255),
    feuchte_oid       varchar(255),
    -- Manche Geräte liefern Zehntelgrad als ganze Zahl. Der Faktor rechnet
    -- das gerade, bevor es in die Zeitreihe geht.
    temperatur_faktor numeric(10, 4) not null default 1,
    feuchte_faktor    numeric(10, 4) not null default 1,
    temperatur_min    numeric(8, 3),
    temperatur_max    numeric(8, 3),
    feuchte_min       numeric(8, 3),
    feuchte_max       numeric(8, 3),
    aktiv             boolean not null default true,
    -- Farbe im Verlauf. Ohne Angabe nimmt die Oberfläche die nächste aus der
    -- Palette.
    farbe             varchar(7) check (farbe ~ '^#[0-9a-fA-F]{6}$'),
    erstellt_am       timestamptz not null default now(),
    geaendert_am      timestamptz not null default now(),
    constraint sensoren_braucht_eine_kennung
        check (temperatur_oid is not null or feuchte_oid is not null),
    constraint sensoren_grenzen_der_reihe_nach
        check (temperatur_min is null or temperatur_max is null
               or temperatur_min <= temperatur_max),
    constraint sensoren_feuchtegrenzen_der_reihe_nach
        check (feuchte_min is null or feuchte_max is null
               or feuchte_min <= feuchte_max)
);

create table public.sensor_messungen (
    id          bigint generated always as identity primary key,
    sensor_id   uuid not null references public.sensoren(id) on delete cascade,
    gemessen_am timestamptz not null,
    temperatur  numeric(8, 3),
    feuchte     numeric(8, 3),
    -- Ein Lauf von Hand und der geplante Lauf können sich auf die Sekunde
    -- treffen. Dann gewinnt der erste, statt dass die Zeitreihe doppelt
    -- zählt.
    constraint sensor_messungen_eindeutig unique (sensor_id, gemessen_am)
);

create index sensor_messungen_verlauf
    on public.sensor_messungen (sensor_id, gemessen_am desc);

create table public.sensor_versuche (
    id          bigint generated always as identity primary key,
    sensor_id   uuid not null references public.sensoren(id) on delete cascade,
    versucht_am timestamptz not null default now(),
    erfolg      boolean not null,
    fehler      varchar(200)
);

create index sensor_versuche_verlauf
    on public.sensor_versuche (sensor_id, versucht_am desc);

-- Der Stand je Gerät: letzter Messwert und letzter Versuch, in einer Abfrage.
-- Im Altprojekt holt die Oberfläche dafür je Gerät eine eigene Antwort.
create view public.sensor_stand
with (security_invoker = true) as
select s.id                as sensor_id,
       m.gemessen_am,
       m.temperatur,
       m.feuchte,
       v.versucht_am,
       v.erfolg,
       v.fehler
from public.sensoren s
left join lateral (
    select m.gemessen_am, m.temperatur, m.feuchte
    from public.sensor_messungen m
    where m.sensor_id = s.id
    order by m.gemessen_am desc
    limit 1
) m on true
left join lateral (
    select v.versucht_am, v.erfolg, v.fehler
    from public.sensor_versuche v
    where v.sensor_id = s.id
    order by v.versucht_am desc
    limit 1
) v on true;

alter table public.sensoren enable row level security;
alter table public.sensor_messungen enable row level security;
alter table public.sensor_versuche enable row level security;

-- Lesen darf, wer die Sensoren sieht. **Ohne die Community**: das Spaltenrecht
-- gibt sie gar nicht erst frei, damit kein `select *` sie mitnimmt.
grant select (id, name, rechner, port, temperatur_oid, feuchte_oid,
              temperatur_faktor, feuchte_faktor, temperatur_min, temperatur_max,
              feuchte_min, feuchte_max, aktiv, farbe, erstellt_am, geaendert_am)
    on public.sensoren to authenticated;
grant select on public.sensor_messungen to authenticated;
grant select on public.sensor_versuche to authenticated;
grant select on public.sensor_stand to authenticated;

create policy sensoren_lesen on public.sensoren
    for select to authenticated using (public.app_level('sensors') is not null);
create policy sensor_messungen_lesen on public.sensor_messungen
    for select to authenticated using (public.app_level('sensors') is not null);
create policy sensor_versuche_lesen on public.sensor_versuche
    for select to authenticated using (public.app_level('sensors') is not null);

-- Geschrieben wird nur über `compute`: jede Änderung kann die Community
-- tragen, und die zu verschlüsseln braucht den Schlüssel aus der Umgebung.
-- Deshalb hier kein `insert`/`update`/`delete` für `authenticated`.

-- ---------------------------------------------------------------------------
-- Der Takt. Wie beim ATR-Scan und beim Personio-Abgleich: die Datenbank
-- klopft an, der Dienst bleibt zustandslos. Das Geheimnis dazu einmalig
-- hinterlegen:
--
--   alter database postgres set acm.sensor_token = '<geheimnis>';
--
-- Als `supabase_admin` — `postgres` darf den Parameter nicht setzen.
--
-- Ohne gesetzten Wert wird kein Job angelegt; gemessen wird dann nur von Hand.
-- ---------------------------------------------------------------------------
create or replace function public.sensoren_messen_anstossen()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    geheim text := current_setting('acm.sensor_token', true);
begin
    if geheim is null or geheim = '' then
        raise notice 'acm.sensor_token ist nicht gesetzt — Messung uebersprungen';
        return null;
    end if;
    -- Kein aktives Gerät, kein Anruf.
    if not exists (select 1 from public.sensoren where aktiv) then
        return null;
    end if;
    return net.http_post(
        url     := 'http://compute:8000/api/sensoren/geplant',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'X-Sensor-Token', geheim
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
end;
$$;

revoke all on function public.sensoren_messen_anstossen() from public;

-- Aufräumen: die Zeitreihe bleibt drei Jahre, die Versuchsliste vierzehn Tage.
-- Sie ist Betriebsprotokoll, kein Messwert — nach zwei Wochen sagt sie nichts
-- mehr, was die Zeitreihe nicht auch sagt.
create or replace function public.sensoren_aufraeumen()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    geloescht integer;
begin
    delete from public.sensor_messungen
     where gemessen_am < now() - interval '3 years';
    get diagnostics geloescht = row_count;
    delete from public.sensor_versuche
     where versucht_am < now() - interval '14 days';
    return geloescht;
end;
$$;

revoke execute on function public.sensoren_aufraeumen() from public, anon, authenticated;

do $$
begin
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
        execute 'create extension if not exists pg_net';
        execute 'create extension if not exists pg_cron';
        perform cron.schedule(
            'sensoren-messen',
            -- Alle fünf Minuten. Das Altprojekt fragt jede Minute ab; für
            -- Raumtemperatur ist das feiner, als irgendjemand ablesen kann,
            -- und macht die Zeitreihe fünfmal so gross.
            '*/5 * * * *',
            'select public.sensoren_messen_anstossen()'
        );
        perform cron.schedule(
            'sensoren-aufraeumen',
            '20 3 * * *',
            'select public.sensoren_aufraeumen()'
        );
    end if;
end;
$$;
"""

DOWNGRADE = """
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.unschedule('sensoren-messen');
        perform cron.unschedule('sensoren-aufraeumen');
    end if;
exception when others then
    null;
end;
$$;

drop function if exists public.sensoren_aufraeumen();
drop function if exists public.sensoren_messen_anstossen();
drop view if exists public.sensor_stand;
drop table if exists public.sensor_versuche;
drop table if exists public.sensor_messungen;
drop table if exists public.sensoren;

update public.apps set path = '/sensors' where id = 'sensors';
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
