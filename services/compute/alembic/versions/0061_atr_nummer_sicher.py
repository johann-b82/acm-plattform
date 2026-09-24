"""ATR: die laufende Nummer transaktionssicher vergeben.

Revision ID: 0061_atr_nummer_sicher
Revises: 0060_sensor_intervall_null_aus
Create Date: 2026-09-20

Bis hierher las `naechste()` das Maximum in einer eigenen Sitzung ohne Sperre,
und erst viel später — nach Gerüst, Excel, PDF und Ablage — schrieb eine zweite
Sitzung die Nummer. Zwischen Lesen und Schreiben lasen zwei gleichzeitige
Erzeugungen dasselbe Maximum und trugen dieselbe Nummer (Befund: Duplikat 4943).
Eine von Hand höher gesetzte Nummer ließ die nächste automatische zudem
scheinbar rückwärts vergeben (4964 nach 4965).

Diese Migration legt die Vergabe in die Datenbank:

- `atr_familie(programm)` — unveränderliche Ableitung der Programmfamilie aus der
  Ziffernfolge (`380` → A380, sonst A350), damit derselbe Nummernkreis gilt wie
  in `app/atr/ziele.ist_a380`.
- `atr_nummer_reservieren(lieferung, ziffern)` — nimmt einen transaktionsweiten
  Riegel je Familie (`pg_advisory_xact_lock`), liest das Maximum, schreibt
  höchste + 1 **in derselben Transaktion** in die Zeile und gibt sie zurück.
  Zwei gleichzeitige Läufe serialisieren am Riegel; der zweite sieht die schon
  festgeschriebene Nummer des ersten. Eine von Hand gesetzte Nummer gewinnt und
  bleibt; ohne numerischen Vorgänger gibt es keine Nummer.

Zusätzlich ein eindeutiger Teilindex je Familie über die numerischen Nummern —
aber nur, wenn keine Altkonflikte vorliegen. Bestehende Duplikate werden **nicht
blind** durch die Migration verändert (das wären sichtbare Nummernwechsel und
damit Referenzverluste); sie werden als Hinweis gemeldet und getrennt reversibel
bereinigt. Die Migration löscht und verschiebt nichts.
"""
from alembic import op

revision = "0061_atr_nummer_sicher"
down_revision = "0060_sensor_intervall_null_aus"
branch_labels = None
depends_on = None

UPGRADE = """
create or replace function public.atr_familie(programm text)
returns text
language sql
immutable
as $$
    select case when coalesce(programm, 'A350') like '%380%' then '380' else '350' end;
$$;

create or replace function public.atr_nummer_reservieren(p_lieferung uuid, p_ziffern text)
returns text
language plpgsql
as $$
declare
    vorhandene text;
    hoechste   bigint;
    neu        text;
begin
    -- Transaktionsweiter Riegel je Programmfamilie: gleichzeitige Vergaben
    -- derselben Familie warten aufeinander, statt dasselbe Maximum zu lesen.
    perform pg_advisory_xact_lock(hashtext('atr-nummer:' || p_ziffern));

    select atr_nummer into vorhandene
      from public.atr_lieferungen where id = p_lieferung;
    -- Eine von Hand gesetzte Nummer gewinnt und bleibt unverändert.
    if coalesce(btrim(vorhandene), '') <> '' then
        return vorhandene;
    end if;

    select max((atr_nummer)::bigint) into hoechste
      from public.atr_lieferungen
     where atr_nummer ~ '^[0-9]+$'
       and coalesce(programm, 'A350') like '%' || p_ziffern || '%';

    if hoechste is null then
        return null;  -- kein numerischer Vorgänger: die erste setzt jemand von Hand
    end if;

    neu := (hoechste + 1)::text;
    update public.atr_lieferungen set atr_nummer = neu where id = p_lieferung;
    return neu;
end;
$$;

revoke all on function public.atr_nummer_reservieren(uuid, text) from public;

-- Eindeutigkeit je Familie über die numerischen Nummern — als Netz unter der
-- Vergabe. Nur anlegen, wenn sauber; sonst erst reversibel bereinigen.
do $$
declare
    dubletten int;
begin
    select count(*) into dubletten from (
        select 1 from public.atr_lieferungen
         where atr_nummer ~ '^[0-9]+$'
         group by public.atr_familie(programm), (atr_nummer)::bigint
        having count(*) > 1
    ) d;
    if dubletten = 0 then
        create unique index if not exists atr_nummer_je_familie
            on public.atr_lieferungen (public.atr_familie(programm), ((atr_nummer)::bigint))
            where atr_nummer ~ '^[0-9]+$';
    else
        raise notice
            'ATR: % doppelte Nummernvergaben vorhanden — eindeutiger Index übersprungen. '
            'Erst reversibel bereinigen, dann Index nachziehen (siehe docs/modules/atr.md).',
            dubletten;
    end if;
end;
$$;
"""

DOWNGRADE = """
drop index if exists public.atr_nummer_je_familie;
drop function if exists public.atr_nummer_reservieren(uuid, text);
drop function if exists public.atr_familie(text);
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
