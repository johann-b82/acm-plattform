"""Abgleich Audit, Wartung, Sensoren: Anlage in einem Schritt, globaler Takt und globale Grenzen.

Revision ID: 0047_audit_wartung_sensoren
Revises: 0040_bereich_hr
Create Date: 2026-09-12

Vier Dinge aus dem Systemvergleich:

**Ein Audit wird mit allem angelegt, was das Altsystem dabei fragt (AUD-03).**
Geltungsbereich, Kategorien, Lead-Auditor, geplanter Beginn und Ende. Die
Kategorien stehen in einer eigenen Tabelle; zwei Aufrufe über PostgREST könnten
ein Audit ohne Kategorie zurücklassen. `audit_anlegen` macht beides in einer
Transaktion und läuft mit den Rechten der aufrufenden Person — die Policies an
`audits` und `audit_kategorien` bleiben die Grenze.

**Takt und Grenzen gelten für alle Sensoren (SET-10, SET-11).** Eine Zeile in
`sensor_einstellungen`, wie im Altsystem vier Grenzen und ein Intervall. Die
Grenzspalten an `sensoren` bleiben stehen, werden aber nicht mehr ausgewertet —
eine Ausnahme je Gerät hat der Nutzer ausdrücklich verworfen. Die Vorgaben sind
die in der Referenz beobachteten Werte: 3600 Sekunden, 16–30 °C, 30–70 %.

**Der Takt wirkt, ohne zweiten Zeitplan.** `pg_cron` klopft jetzt jede Minute;
`sensoren_faellig()` entscheidet, ob seit dem letzten Anstoß oder Durchgang das
Intervall um ist. `compute` bleibt zustandslos. Feiner als eine Minute wird es
dadurch nicht — ein Intervall unter 60 Sekunden läuft effektiv minütlich.

**Verlauf und Kennzahlen kommen verdichtet aus der Datenbank (SEN-02, SEN-03).**
Dreißig Tage Rohwerte sind je Gerät über achttausend Zeilen; PostgREST gibt
höchstens tausend auf einmal heraus. Wie im Altsystem wird bis 24 Stunden auf
fünf Minuten, darüber auf eine Stunde gemittelt. Min/Max und die Änderung zu
vor einer und vor 24 Stunden rechnet `sensor_kennzahlen` aus echten Messungen:
Vergleichswert ist die nächstgelegene Messung innerhalb einer halben Stunde um
den Zeitpunkt — gibt es keine, bleibt die Änderung leer statt null.
"""
from alembic import op

revision = "0047_audit_wartung_sensoren"
down_revision = "0040_bereich_hr"
branch_labels = None
depends_on = None

UPGRADE = """
-- ---------------------------------------------------------------------------
-- AUD-03: Anlage in einem Schritt.
-- ---------------------------------------------------------------------------
create or replace function public.audit_anlegen(
    p_nummer            text,
    p_titel             text,
    p_art               text,
    p_kategorien        text[],
    p_bereich           text default '',
    p_leitender_auditor text default null,
    p_geplant_von       date default null,
    p_geplant_bis       date default null,
    p_vorlage_id        uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    neu uuid;
begin
    if coalesce(btrim(p_nummer), '') = '' or coalesce(btrim(p_titel), '') = '' then
        raise exception 'Nummer und Titel sind Pflicht.' using errcode = '23514';
    end if;
    if coalesce(cardinality(p_kategorien), 0) = 0 then
        raise exception 'Ein Audit braucht mindestens eine Kategorie.' using errcode = '23514';
    end if;

    insert into public.audits
        (nummer, titel, art, bereich, leitender_auditor, geplant_von, geplant_bis, vorlage_id)
    values (btrim(p_nummer), btrim(p_titel), p_art, coalesce(btrim(p_bereich), ''),
            nullif(btrim(p_leitender_auditor), ''), p_geplant_von, p_geplant_bis, p_vorlage_id)
    returning id into neu;

    insert into public.audit_kategorien (audit_id, kategorie)
    select neu, k from (select distinct unnest(p_kategorien) as k) as eindeutig;

    return neu;
end;
$$;

revoke all on function public.audit_anlegen(text, text, text, text[], text, text, date, date, uuid)
    from public;
grant execute on function public.audit_anlegen(text, text, text, text[], text, text, date, date, uuid)
    to authenticated;

-- ---------------------------------------------------------------------------
-- SET-10/SET-11: ein Takt und vier Grenzen für alle Geräte.
-- ---------------------------------------------------------------------------
create table public.sensor_einstellungen (
    id               boolean primary key default true check (id),
    abfrage_sekunden integer not null default 3600
                     constraint sensor_einstellungen_abfrage_sekunden
                     check (abfrage_sekunden between 5 and 86400),
    temperatur_min   numeric(8, 3),
    temperatur_max   numeric(8, 3),
    feuchte_min      numeric(8, 3),
    feuchte_max      numeric(8, 3),
    -- Wann `pg_cron` zuletzt angestoßen hat. Ein Durchgang schreibt seine
    -- Versuche erst, wenn alle Geräte geantwortet haben oder nicht; bis dahin
    -- hält dieser Zeitpunkt den Takt. Nur die Anstoß-Funktion schreibt ihn.
    letzter_anstoss  timestamptz,
    geaendert_am     timestamptz not null default now(),
    constraint sensor_einstellungen_temperatur_der_reihe_nach
        check (temperatur_min is null or temperatur_max is null
               or temperatur_min < temperatur_max),
    constraint sensor_einstellungen_feuchte_der_reihe_nach
        check (feuchte_min is null or feuchte_max is null or feuchte_min < feuchte_max)
);

insert into public.sensor_einstellungen
    (id, abfrage_sekunden, temperatur_min, temperatur_max, feuchte_min, feuchte_max)
values (true, 3600, 16, 30, 30, 70);

alter table public.sensor_einstellungen enable row level security;

grant select on public.sensor_einstellungen to authenticated;
grant update (abfrage_sekunden, temperatur_min, temperatur_max, feuchte_min, feuchte_max,
              geaendert_am)
    on public.sensor_einstellungen to authenticated;

create policy sensor_einstellungen_lesen on public.sensor_einstellungen
    for select to authenticated using (public.app_level('sensors') is not null);
-- Einrichten gehört der Plattform-Verwaltung, wie das Anlegen der Geräte.
create policy sensor_einstellungen_pflegen on public.sensor_einstellungen
    for update to authenticated
    using (public.app_mindestens('platform', 'admin'))
    with check (public.app_mindestens('platform', 'admin'));

-- Ist es Zeit für einen Durchgang? Maßgeblich ist das Spätere von letztem
-- Anstoß und letztem Versuch — ein Lauf von Hand zählt also mit. Eine kleine
-- Toleranz fängt ab, dass `pg_cron` zur vollen Minute klopft, der Durchgang
-- seine Versuche aber ein paar Sekunden später schreibt; ohne sie wanderte
-- ein Stundentakt jede Stunde um eine Minute weiter.
create or replace function public.sensoren_faellig()
returns boolean
language sql
stable
set search_path = public
as $$
    select coalesce(
        greatest(e.letzter_anstoss,
                 (select max(v.versucht_am) from public.sensor_versuche v))
            <= now() - make_interval(secs => e.abfrage_sekunden)
               + least(interval '30 seconds', make_interval(secs => e.abfrage_sekunden / 2.0)),
        true)
    from public.sensor_einstellungen e;
$$;

revoke all on function public.sensoren_faellig() from public;

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
    if not public.sensoren_faellig() then
        return null;
    end if;
    update public.sensor_einstellungen set letzter_anstoss = now();
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

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        -- Derselbe Job, jetzt jede Minute. Ob gemessen wird, entscheidet
        -- `sensoren_faellig()`.
        perform cron.schedule(
            'sensoren-messen',
            '* * * * *',
            'select public.sensoren_messen_anstossen()'
        );
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- SEN-03: der Verlauf, verdichtet wie im Altsystem.
-- ---------------------------------------------------------------------------
create or replace function public.sensor_verlauf(stunden integer, bis timestamptz default now())
returns table (sensor_id uuid, zeit timestamptz, temperatur numeric, feuchte numeric)
language sql
stable
security invoker
set search_path = public
as $$
    select m.sensor_id,
           date_bin(case when stunden <= 24 then interval '5 minutes' else interval '1 hour' end,
                    m.gemessen_am, timestamptz 'epoch') as zeit,
           round(avg(m.temperatur), 3),
           round(avg(m.feuchte), 3)
    from public.sensor_messungen m
    where stunden between 1 and 8760
      and m.gemessen_am > bis - make_interval(hours => stunden)
      and m.gemessen_am <= bis
    group by 1, 2
    -- Fest sortiert: die Oberfläche holt große Fenster seitenweise.
    order by 2, 1;
$$;

grant execute on function public.sensor_verlauf(integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- SEN-02: Min/Max und Änderung je Gerät.
-- ---------------------------------------------------------------------------
-- Der Wert, der einem Zeitpunkt am nächsten liegt — je Größe getrennt, weil
-- eine Messung Temperatur ohne Feuchte tragen kann. Nur innerhalb einer halben
-- Stunde; weiter weg ist es kein Vergleich mehr.
create or replace function public.sensor_wert_um(p_sensor uuid, p_zeit timestamptz)
returns table (temperatur numeric, feuchte numeric)
language sql
stable
security invoker
set search_path = public
as $$
    select
        (select m.temperatur from public.sensor_messungen m
          where m.sensor_id = p_sensor and m.temperatur is not null
            and m.gemessen_am between p_zeit - interval '30 minutes'
                                  and p_zeit + interval '30 minutes'
          order by abs(extract(epoch from m.gemessen_am - p_zeit)), m.gemessen_am
          limit 1),
        (select m.feuchte from public.sensor_messungen m
          where m.sensor_id = p_sensor and m.feuchte is not null
            and m.gemessen_am between p_zeit - interval '30 minutes'
                                  and p_zeit + interval '30 minutes'
          order by abs(extract(epoch from m.gemessen_am - p_zeit)), m.gemessen_am
          limit 1);
$$;

grant execute on function public.sensor_wert_um(uuid, timestamptz) to authenticated;

create or replace function public.sensor_kennzahlen(stunden integer, bis timestamptz default now())
returns table (
    sensor_id                uuid,
    gemessen_am              timestamptz,
    temperatur               numeric,
    feuchte                  numeric,
    temperatur_min           numeric,
    temperatur_max           numeric,
    feuchte_min              numeric,
    feuchte_max              numeric,
    temperatur_aenderung_1h  numeric,
    temperatur_aenderung_24h numeric,
    feuchte_aenderung_1h     numeric,
    feuchte_aenderung_24h    numeric
)
language sql
stable
security invoker
set search_path = public
as $$
    select s.id,
           l.gemessen_am,
           l.temperatur,
           l.feuchte,
           f.temperatur_min,
           f.temperatur_max,
           f.feuchte_min,
           f.feuchte_max,
           l.temperatur - v1.temperatur,
           l.temperatur - v24.temperatur,
           l.feuchte - v1.feuchte,
           l.feuchte - v24.feuchte
    from public.sensoren s
    left join lateral (
        select m.gemessen_am, m.temperatur, m.feuchte
        from public.sensor_messungen m
        where m.sensor_id = s.id and m.gemessen_am <= bis
        order by m.gemessen_am desc
        limit 1
    ) l on true
    left join lateral (
        select min(m.temperatur) as temperatur_min, max(m.temperatur) as temperatur_max,
               min(m.feuchte) as feuchte_min, max(m.feuchte) as feuchte_max
        from public.sensor_messungen m
        where m.sensor_id = s.id
          and m.gemessen_am > bis - make_interval(hours => stunden)
          and m.gemessen_am <= bis
    ) f on true
    -- Wie im Altsystem vom letzten Messwert aus gerechnet, nicht von „jetzt":
    -- ein Gerät, das seit gestern schweigt, zeigt die Änderung seines letzten
    -- Werts.
    left join lateral public.sensor_wert_um(s.id, l.gemessen_am - interval '1 hour') v1 on true
    left join lateral public.sensor_wert_um(s.id, l.gemessen_am - interval '24 hours') v24 on true
    order by s.name;
$$;

grant execute on function public.sensor_kennzahlen(integer, timestamptz) to authenticated;
"""

DOWNGRADE = """
drop function if exists public.sensor_kennzahlen(integer, timestamptz);
drop function if exists public.sensor_wert_um(uuid, timestamptz);
drop function if exists public.sensor_verlauf(integer, timestamptz);

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

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule(
            'sensoren-messen',
            '*/5 * * * *',
            'select public.sensoren_messen_anstossen()'
        );
    end if;
end;
$$;

drop function if exists public.sensoren_faellig();
drop table if exists public.sensor_einstellungen;
drop function if exists public.audit_anlegen(text, text, text, text[], text, text, date, date, uuid);
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
