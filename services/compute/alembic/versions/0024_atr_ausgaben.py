"""ATR: die erzeugten Dateien an der Lieferung.

Revision ID: 0024_atr_ausgaben
Revises: 0023_atr_lieferungen
Create Date: 2026-09-10

Drei Ausgaben je Lieferung: die ATR-Mappe, das PDF daraus und das
Container-Etikett. Im Altprojekt stecken alle drei als `bytea` in der Zeile;
hier liegen sie im Eimer `atr`, und die Zeile hält nur die Pfade.

`erzeugt_am` sagt, wann sie entstanden. Steht dort ein Zeitpunkt vor
`geaendert_am`, ist die Lieferung seither angefasst worden und die Dateien
sind älter als ihre Daten — das zeigt die Oberfläche an, statt es zu
verschweigen.
"""
from alembic import op

revision = "0024_atr_ausgaben"
down_revision = "0023_atr_lieferungen"
branch_labels = None
depends_on = None

UPGRADE = """
alter table public.atr_lieferungen
    add column mappe_pfad   text,
    add column pdf_pfad     text,
    add column etikett_pfad text,
    add column erzeugt_am   timestamptz;

-- Das Ablegen der erzeugten Dateien ist keine Änderung an der Lieferung.
-- Ohne diese Unterscheidung zöge derselbe Schreibvorgang, der `erzeugt_am`
-- setzt, auch `geaendert_am` hoch — und die Oberfläche meldete jede frisch
-- erzeugte Mappe sofort als veraltet.
--
-- Eine eigene Funktion, nicht die gemeinsame `atr_beruehrt()`: die hängt auch
-- an `atr_positionen`, und plpgsql löst die Feldverweise einer Bedingung
-- vorab auf — ein `new.erzeugt_am` darin bräche dort, wo es die Spalte nicht
-- gibt.
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

drop trigger if exists atr_lieferungen_beruehrt on public.atr_lieferungen;
create trigger atr_lieferungen_beruehrt before update on public.atr_lieferungen
    for each row execute function public.atr_lieferung_beruehrt();
"""

DOWNGRADE = """
drop trigger if exists atr_lieferungen_beruehrt on public.atr_lieferungen;
create trigger atr_lieferungen_beruehrt before update on public.atr_lieferungen
    for each row execute function public.atr_beruehrt();
drop function if exists public.atr_lieferung_beruehrt();

alter table public.atr_lieferungen
    drop column if exists erzeugt_am,
    drop column if exists etikett_pfad,
    drop column if exists pdf_pfad,
    drop column if exists mappe_pfad;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
