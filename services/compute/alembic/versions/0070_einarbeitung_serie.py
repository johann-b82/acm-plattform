"""Serien-Einarbeitung: Abteilungsleiter je Bereich und allgemeine Punkte.

Revision ID: 0070_einarbeitung_serie
Revises: 0069_kompetenz_soll
Create Date: 2026-10-02

Grundlage für „Serie erzeugen": je Bereich der **Abteilungsleiter** (er ist der
Ansprechpartner der Tätigkeiten und unterschreibt das Feedbackgespräch), und die
**allgemeinen Onboarding-Punkte**, die auf jedem Produktions-Einarbeitungsbogen
oben stehen (Personalwesen, Sicherheitsunterweisung, PSA, Safety, Grundlagen
Produktion, ERP/BDE …).

`ansprechpartner` an einem allgemeinen Punkt ist fest; ist er leer, setzt die
Erzeugung den Bereichsleiter ein. Beide Tabellen sind in der Oberfläche
pflegbar.

Sehen mit `hr`, pflegen ab `hr: editor`.
"""
from alembic import op

revision = "0070_einarbeitung_serie"
down_revision = "0069_kompetenz_soll"
branch_labels = None
depends_on = None

UPGRADE = """
alter table public.kompetenz_bereiche add column leiter text;

-- Abteilungsleiter je Bereich (Stand 2026-10-02).
update public.kompetenz_bereiche set leiter = v.leiter
from (values
    ('Teppich',            'Khan Aga Rahimi'),
    ('Wandverkleidung',    'Maria Diana De Costa'),
    ('Zuschnitt Hand',     'Vera Andreeva'),
    ('Cutter',             'Omid Kohestan'),
    ('Näherei',            'Vera Andreeva'),
    ('Schäumerei',         'Antonio Trombatore'),
    ('Montage Bezieherei', 'Antonio Trombatore'),
    ('Bemusterung',        'Antonio Trombatore')
) as v(name, leiter)
where public.kompetenz_bereiche.name = v.name;

create table public.einarbeitung_allgemein (
    id             uuid primary key default gen_random_uuid(),
    thema          text not null,
    -- Fester Einweiser; leer heißt: der Bereichsleiter.
    ansprechpartner text,
    beschreibung   text,
    reihenfolge    integer not null default 0,
    aktiv          boolean not null default true
);

insert into public.einarbeitung_allgemein (thema, ansprechpartner, beschreibung, reihenfolge) values
 ('Personalwesen', 'Majda Bouhamidi',
  'Organisatorisches Onboarding: Aushändigung von Betriebsordnung, Sicherheitsrichtlinie und Stempelchip, Vorstellungsrunde sowie Begleitung an den Arbeitsplatz.', 1),
 ('Sicherheitstechnische Unterweisung', 'Majda Bouhamidi',
  'Erstunterweisung zum Arbeits- und Gesundheitsschutz: standortbezogene Gefährdungen, Verhaltensregeln im Betrieb, Flucht- und Rettungswege, Verhalten im Notfall sowie Melde- und Eskalationswege bei Unfällen und Beinaheunfällen.', 2),
 ('Arbeitsplatz- und Bereichseinweisung', 'Antonio Trombatore',
  'Einführung in Bereich und Arbeitsplatz: Vorstellung im Team, Betriebsrundgang, Sozial- und Sanitärräume, Zeiterfassung sowie Arbeits- und Pausenzeiten; Unterweisung zur Arbeitssicherheit am Arbeitsplatz und in der Arbeitsplatzumgebung.', 3),
 ('PSA – Einweisung und Übergabe', 'Antonio Trombatore',
  'Einweisung in die persönliche Schutzausrüstung: Aushändigung der für den Arbeitsplatz vorgesehenen PSA, bestimmungsgemäße Verwendung, Trage- und Prüfpflichten sowie Vorgehen bei Ersatzbeschaffung.', 4),
 ('Safety Management System', 'Neil Clyde Dias',
  'Einführung in das Safety Management System: Grundsätze und Ziele, Melde- und Berichtswege, Umgang mit Vorkommnissen und Beobachtungen sowie kontinuierliche Verbesserung.', 5),
 ('Grundlagen Produktion (Gesamtüberblick)', 'Antonio Trombatore',
  'Überblick über die Produktion: Fertigungsbereiche und ihr Zusammenspiel, Produktportfolio der ACM, grundlegende Herstellungsverfahren sowie der Weg eines Auftrags durch die Fertigung.', 6),
 ('Grundlagen ERP-System (Apollo) / BDE', 'Antonio Trombatore',
  'Einführung in das ERP-System Apollo und das BDE-System: Anmeldung, Navigation und Benutzerrechte, Umgang mit der Betriebsdatenerfassung (BDE) an den Terminals, An- und Abmelden von Aufträgen und Arbeitsgängen, Erfassung von Unterbrechungen und Stückzahlen.', 7);

alter table public.einarbeitung_allgemein enable row level security;
grant select on public.einarbeitung_allgemein to authenticated;
grant insert, update, delete on public.einarbeitung_allgemein to authenticated;
create policy einarbeitung_allgemein_lesen on public.einarbeitung_allgemein
    for select to authenticated using (public.app_level('hr') is not null);
create policy einarbeitung_allgemein_pflegen on public.einarbeitung_allgemein
    for all to authenticated
    using (public.app_mindestens('hr', 'editor'))
    with check (public.app_mindestens('hr', 'editor'));
"""

DOWNGRADE = """
drop table if exists public.einarbeitung_allgemein;
alter table public.kompetenz_bereiche drop column if exists leiter;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
