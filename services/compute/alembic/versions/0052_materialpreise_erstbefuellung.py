"""Materialpreise einmalig aus den vorhandenen Wareneingängen vorbelegen.

Revision ID: 0052_materialpreise_erstbefuellung
Revises: 0043_materialpreise
Create Date: 2026-09-13

`material_prices` ist nach 0043 leer, bis jemand die Datei „Materialpreise
(Wareneingang)" hochlädt oder die Übernahme läuft. Bis dahin stünde die
Materialkostenquote auf 0 % und jeder Artikel als „ohne Preis" — für die
Abnahme sieht das nach Defekt aus, obwohl die Zahl nur mangels Preisdaten fehlt.

Die Materialpreise stammen aus **derselben** Quelldatei wie die Wareneingänge
(AswKpf_WE): dieselben Schlüssel Vorgang/Pos/UPos, dasselbe Wareneingangsdatum
(`entry_date` = Spalte „Datum"), derselbe Positionswert und dieselbe Menge. Der
lokale Bestand hat die Wareneingänge bereits, nur nie als Materialpreise
abgelegt. Diese Migration füllt die fehlenden Zeilen daraus.

**Kollisionssicher:** `on conflict (vorgang_nr, pos, upos) do nothing`. Ein
späterer echter Upload oder die Übernahme (beide über denselben natürlichen
Schlüssel) füllt nur, was noch fehlt, und diese Vorbelegung überschreibt
nichts. Weil Wareneingang und Materialpreis für denselben Schlüssel denselben
Wert tragen, sind vorbelegte und später übernommene Zeilen inhaltsgleich; der
`do-nothing`-Riegel der Übernahme lässt also keine abweichende Zahl stehen.

`upload_batch_id` bleibt leer (kein Upload-Protokoll erfunden). Die
Materialkostenquote rechnet über den jeweils jüngsten Preis je Artikel nach
`datum`; mit den Wareneingängen bis zum aktuellen Stand ergibt sich der
fachlich korrekte, aktuelle Wert (nicht der veraltete Referenzstand, dessen
Preistabelle beim letzten Vergleich älter war).
"""
from alembic import op

revision = "0052_materialpreise_erstbefuellung"
down_revision = "0043_materialpreise"
branch_labels = None
depends_on = None

UPGRADE = """
insert into public.material_prices
    (vorgang_nr, pos, upos, typ, datum, artnr, article_name, menge, unit, preis, pos_wert)
select g.vorgang_nr, g.pos, coalesce(g.upos, 0), g.typ, g.entry_date,
       g.article_number, g.article_name, g.quantity, g.unit, g.price, g.position_value
from public.goods_receipt_records g
where g.vorgang_nr is not null and g.article_number is not null
on conflict (vorgang_nr, pos, upos) do nothing;
"""

# Kein Downgrade-Löschen: die Zeilen sind ab jetzt nicht mehr von echten
# Upload-/Übernahmezeilen zu unterscheiden. Ein pauschales Löschen risse auch
# die weg. Bewusst leer.
DOWNGRADE = ""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    pass
