"""Der Dokumentenlauf: Blatt erzeugen, übergeben, zurückbekommen, prüfen.

Zwei Formblätter durchlaufen im Haus denselben Weg — der Einarbeitungsplan und
der Schulungsnachweis. Beide werden gedruckt, ausgehändigt, von Hand
ausgefüllt, unterschrieben zurückgegeben und abgeheftet. Im Altprojekt gibt es
dafür **zwei** Tabellen und zwei Sätze Routen mit demselben Inhalt.

Hier ist es eine Tabelle mit einer Spalte `art`. Der Weg ist derselbe, die
Prüfung ist dieselbe, der QR-Code ist derselbe; was sich unterscheidet, ist der
Inhalt des Blattes — und der steht ohnehin als Abschrift in `inhalt`.

**Warum überhaupt ein Vorgang und nicht nur ein PDF-Knopf.**
Ein heruntergeladenes Blatt ist weg. Niemand weiß, ob es übergeben wurde, ob es
zurückkam, ob es vollständig ausgefüllt ist. Genau das fragt das Audit. Der
Vorgang hält es fest, und der QR-Code auf dem Blatt ordnet einen später
eingescannten Bogen wieder zu — unabhängig von Dateiname und Schreibweise des
Namens.

**Die Abschrift ist Absicht.** Name, Funktion und Inhalt stehen als Kopie in der
Zeile. Ändert sich später der Schulungskatalog oder die Abteilung der Person,
dokumentiert der Vorgang weiter, was damals auf dem Blatt stand. Ein Verweis
täte das nicht.
"""
from alembic import op

revision = "0035_dokumentenlauf"
down_revision = "0034_schulungsmatrix"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.dokumentvorgaenge (
    id            uuid primary key default gen_random_uuid(),
    art           varchar(20) not null
                  check (art in ('einarbeitung', 'schulung')),
    -- Der Token im QR-Code auf dem Blatt.
    doc_uid       varchar(32) not null unique,

    employee_id   integer references public.personio_employees(id) on delete set null,
    extern_id     uuid references public.externe_personen(id) on delete set null,

    -- Abschrift beim Anlegen — siehe Modulkopf.
    name          text not null,
    funktion      text,
    beginn        date,
    -- Was auf dem Blatt steht: die Abteilungen (Einarbeitung) beziehungsweise
    -- die Zeilen samt Verantwortlichem (Schulung).
    inhalt        jsonb,

    -- Pfade im Eimer `dokumente`: das erzeugte Blankoformular und der Scan.
    pdf_pfad      text,
    scan_pfad     text,
    -- Die Rechtecke der Pflichtfelder, je Seite auf 0..1 normiert. Damit lässt
    -- sich im Scan nachsehen, ob dort etwas steht.
    feld_layout   jsonb,

    status        varchar(20) not null default 'erstellt'
                  check (status in ('erstellt', 'uebergeben', 'zurueck', 'geprueft')),
    erstellt_am   timestamptz not null default now(),
    uebergeben_am timestamptz,
    zurueck_am    timestamptz,
    geprueft_am   timestamptz,

    pruef_ergebnis jsonb,
    -- Das Gesamturteil. Absichtlich von Hand überstimmbar: die Messung sieht,
    -- *ob* in einem Feld etwas steht, nicht *was*.
    vollstaendig  boolean,
    kommentar     text,

    constraint dokumentvorgaenge_eine_person check (
        num_nonnulls(employee_id, extern_id) <= 1
    ),
    -- Der Laufweg ist eine Reihenfolge, keine Menge: geprüft setzt zurück
    -- voraus, zurück setzt übergeben voraus. Ohne das ließe sich ein Blatt
    -- prüfen, das nie jemand bekommen hat.
    constraint dokumentvorgaenge_reihenfolge check (
        (zurueck_am is null or uebergeben_am is not null)
        and (geprueft_am is null or zurueck_am is not null)
    ),
    -- Und der Status sagt dasselbe wie die Zeitstempel.
    constraint dokumentvorgaenge_status_passt check (
        (status = 'erstellt'   and uebergeben_am is null)
        or (status = 'uebergeben' and uebergeben_am is not null and zurueck_am is null)
        or (status = 'zurueck'    and zurueck_am is not null and geprueft_am is null)
        or (status = 'geprueft'   and geprueft_am is not null)
    )
);

create index dokumentvorgaenge_person on public.dokumentvorgaenge (employee_id);
create index dokumentvorgaenge_art_status on public.dokumentvorgaenge (art, status);

-- Nachweise und Zertifikate am Vorgang. Ein Blatt kann mehrere tragen: je
-- Schulungszeile eine Teilnahmebescheinigung.
create table public.dokument_nachweise (
    id              uuid primary key default gen_random_uuid(),
    vorgang_id      uuid not null references public.dokumentvorgaenge(id) on delete cascade,
    -- Auf welche Zeile des Blattes er sich bezieht. Leer heißt: auf den Vorgang
    -- als Ganzes.
    zeile           text,
    pfad            text not null,
    dateiname       text not null,
    hochgeladen_am  timestamptz not null default now()
);

create index dokument_nachweise_vorgang on public.dokument_nachweise (vorgang_id);

-- Unterlagen je Schulung: Präsentation, Handout, Betriebsanweisung. Hängen am
-- Katalog, nicht am Vorgang — sie gelten für jede Durchführung.
create table public.schulung_unterlagen (
    id             uuid primary key default gen_random_uuid(),
    schulung_id    uuid not null references public.schulung_katalog(id) on delete cascade,
    pfad           text not null,
    dateiname      text not null,
    hochgeladen_am timestamptz not null default now()
);

create index schulung_unterlagen_schulung on public.schulung_unterlagen (schulung_id);

alter table public.dokumentvorgaenge enable row level security;
alter table public.dokument_nachweise enable row level security;
alter table public.schulung_unterlagen enable row level security;

grant select on public.dokumentvorgaenge, public.dokument_nachweise,
                public.schulung_unterlagen to authenticated;
grant insert, update, delete on public.dokumentvorgaenge, public.dokument_nachweise,
                public.schulung_unterlagen to authenticated;

do $$
declare
    t text;
begin
    foreach t in array array['dokumentvorgaenge', 'dokument_nachweise', 'schulung_unterlagen']
    loop
        execute format(
            'create policy %I on public.%I for select to authenticated '
            'using (public.app_level(''hr'') is not null)', t || '_lesen', t);
        execute format(
            'create policy %I on public.%I for all to authenticated '
            'using (public.app_mindestens(''hr'', ''editor'')) '
            'with check (public.app_mindestens(''hr'', ''editor''))',
            t || '_pflegen', t);
    end loop;
end;
$$;

-- Der Eimer für die Blätter: erzeugtes PDF, hochgeladener Scan, Nachweise,
-- Schulungsunterlagen. Scans kommen vom Kopierer und sind größer als ein
-- erzeugtes Formblatt — 50 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dokumente', 'dokumente', false, 52428800,
        array['application/pdf', 'image/png', 'image/jpeg',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy dokumente_hoch on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'dokumente'
        and public.app_mindestens('hr', 'editor')
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy dokumente_lesen on storage.objects
    for select to authenticated
    using (bucket_id = 'dokumente' and public.app_level('hr') is not null);

create policy dokumente_weg on storage.objects
    for delete to authenticated
    using (bucket_id = 'dokumente' and public.app_mindestens('hr', 'editor'));
"""

DOWNGRADE = """
drop policy if exists dokumente_weg on storage.objects;
drop policy if exists dokumente_lesen on storage.objects;
drop policy if exists dokumente_hoch on storage.objects;
delete from storage.buckets where id = 'dokumente';

drop table if exists public.schulung_unterlagen;
drop table if exists public.dokument_nachweise;
drop table if exists public.dokumentvorgaenge;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
