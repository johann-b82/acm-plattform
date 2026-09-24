"""Pflicht-Zuordnung nach Geltung: alle · Abteilung · Position · Abteilung+Position.

Bisher war eine Schulung für eine **Abteilung** (Personio) oder ein **Kürzel**
(feine Excel-Gruppe) Pflicht; die Einweisungen (Einarbeitung) kannten nur die
Abteilung. Jetzt lässt sich beides zusätzlich gezielt an **Positionen** und an
**Abteilung + Position** knüpfen, und „alle Mitarbeiter" ist eine eigene
Geltung. Die Position kommt aus Personio und wird normiert verglichen
(`position_norm`), weil Personio sie uneinheitlich schreibt.

**Das Kürzel-System entfällt.** Seine Zuordnungen gehen nicht verloren: jede
Kürzel-Pflicht wird über die aktuelle Zuordnung Position→Kürzel
(`schulung_rollen`) auf die betroffenen Positionen ausgerollt. Die Tabelle
`schulung_rollen` selbst bleibt vorerst stehen (die Rollenbrücke-Oberfläche
hängt noch daran); sie fällt mit ihrer Oberfläche in einer späteren Migration.

`schulungsplan(mitarbeiter)` rechnet die vier Geltungen; der frühere
„Kürzel fehlt"-Hinweis entfällt.
"""
from alembic import op

revision = "0065_schulung_position"
down_revision = "0064_fair_logo_quarantaene"
branch_labels = None
depends_on = None

UPGRADE = """
-- Trigger-Funktion: aus dem Rohtext der Position die normierte Fassung ableiten.
create or replace function public.pflicht_position_norm()
returns trigger language plpgsql as $$
begin
    new.position_norm := case
        when new."position" is null or btrim(new."position") = '' then null
        else public.position_norm(new."position")
    end;
    return new;
end;
$$;

-- ── schulung_pflicht: Geltung statt Ebene ──────────────────────────────────
alter table public.schulung_pflicht
    add column geltung       varchar(20),
    add column "position"    text,
    add column position_norm varchar(200);

-- Die grobe Personio-Ebene wird zur Geltung „abteilung".
update public.schulung_pflicht set geltung = 'abteilung' where ebene = 'personio';

-- Kürzel-Pflichten verlustfrei in Positions-Pflichten ausrollen: je Kürzel alle
-- Positionen, die darauf zeigen. `position_norm` setzt der Trigger.
insert into public.schulung_pflicht (schulung_id, geltung, "position")
select distinct pf.schulung_id, 'position', r.position
from public.schulung_pflicht pf
join public.schulung_rollen r on r.abteilung_kuerzel = pf.abteilung
where pf.ebene = 'kuerzel';

delete from public.schulung_pflicht where ebene = 'kuerzel';

alter table public.schulung_pflicht drop constraint schulung_pflicht_eindeutig;
alter table public.schulung_pflicht
    alter column abteilung drop not null,
    drop column ebene,
    alter column geltung set not null;
alter table public.schulung_pflicht
    add constraint schulung_pflicht_geltung
        check (geltung in ('alle', 'abteilung', 'position', 'abteilung_position')),
    add constraint schulung_pflicht_felder check (
        (geltung = 'alle'               and abteilung is null     and position_norm is null)
     or (geltung = 'abteilung'          and abteilung is not null and position_norm is null)
     or (geltung = 'position'           and abteilung is null     and position_norm is not null)
     or (geltung = 'abteilung_position' and abteilung is not null and position_norm is not null)
    );
create unique index schulung_pflicht_eindeutig on public.schulung_pflicht
    (schulung_id, geltung, coalesce(abteilung, ''), coalesce(position_norm, ''));

create trigger schulung_pflicht_norm before insert or update on public.schulung_pflicht
    for each row execute function public.pflicht_position_norm();

-- ── einarbeitung_pflicht: dieselbe Geltung ─────────────────────────────────
alter table public.einarbeitung_pflicht
    add column geltung       varchar(20),
    add column "position"    text,
    add column position_norm varchar(200);
update public.einarbeitung_pflicht set geltung = 'abteilung';
alter table public.einarbeitung_pflicht drop constraint einarbeitung_pflicht_eindeutig;
alter table public.einarbeitung_pflicht
    alter column abteilung drop not null,
    alter column geltung set not null;
alter table public.einarbeitung_pflicht
    add constraint einarbeitung_pflicht_geltung
        check (geltung in ('alle', 'abteilung', 'position', 'abteilung_position')),
    add constraint einarbeitung_pflicht_felder check (
        (geltung = 'alle'               and abteilung is null     and position_norm is null)
     or (geltung = 'abteilung'          and abteilung is not null and position_norm is null)
     or (geltung = 'position'           and abteilung is null     and position_norm is not null)
     or (geltung = 'abteilung_position' and abteilung is not null and position_norm is not null)
    );
create unique index einarbeitung_pflicht_eindeutig on public.einarbeitung_pflicht
    (einarbeitung_id, geltung, coalesce(abteilung, ''), coalesce(position_norm, ''));

create trigger einarbeitung_pflicht_norm before insert or update on public.einarbeitung_pflicht
    for each row execute function public.pflicht_position_norm();

-- ── schulungsplan: die vier Geltungen, kein Kürzel mehr ────────────────────
create or replace function public.schulungsplan(p_employee_id integer)
returns table (
    schulung_id uuid,
    bereich     varchar,
    name        text,
    turnus      varchar,
    quelle      text,
    abteilung   text,
    vorhanden   boolean
)
language sql
stable
as $$
    with person as (
        select e.id,
               coalesce(a.abteilung, e.department) as abteilung,
               public.position_norm(e.raw_json #>> '{attributes,position,value}') as position_norm
        from public.personio_employees e
        left join public.onboarding_abteilung a on a.employee_id = e.id
        where e.id = p_employee_id
    ),
    soll as (
        select k.id, k.bereich, k.name, k.turnus,
               pf.geltung::text                              as quelle,
               coalesce(pf.abteilung, pf."position")::text   as abteilung
        from public.schulung_pflicht pf
        join public.schulung_katalog k on k.id = pf.schulung_id
        join person p on true
        where k.aktiv and (
            pf.geltung = 'alle'
            or (pf.geltung = 'abteilung'          and pf.abteilung = p.abteilung)
            or (pf.geltung = 'position'           and pf.position_norm = p.position_norm)
            or (pf.geltung = 'abteilung_position' and pf.abteilung = p.abteilung
                                                  and pf.position_norm = p.position_norm)
        )
    )
    select distinct s.id, s.bereich, s.name, s.turnus, s.quelle, s.abteilung,
           exists (
               select 1 from public.schulung_teilnahmen t
               where t.schulung_id = s.id and t.employee_id = p_employee_id
           )
    from soll s
    order by 5, 2, 3;
$$;

grant execute on function public.schulungsplan(integer) to authenticated;
"""

DOWNGRADE = """
-- Zurück auf Ebene/Abteilung. Positions- und „alle"-Zeilen sowie Kombinationen
-- kann die alte Struktur nicht abbilden und fallen weg (Neufunktion).
drop trigger if exists einarbeitung_pflicht_norm on public.einarbeitung_pflicht;
drop trigger if exists schulung_pflicht_norm on public.schulung_pflicht;

create or replace function public.schulungsplan(p_employee_id integer)
returns table (schulung_id uuid, bereich varchar, name text, turnus varchar,
               quelle text, abteilung text, vorhanden boolean)
language sql stable as $$
    with person as (
        select e.id, coalesce(a.abteilung, e.department) as abteilung,
               public.position_norm(e.raw_json #>> '{attributes,position,value}') as position_norm
        from public.personio_employees e
        left join public.onboarding_abteilung a on a.employee_id = e.id
        where e.id = p_employee_id
    ),
    kuerzel as (
        select r.abteilung_kuerzel from public.schulung_rollen r
        join person p on r.position_norm = p.position_norm
    ),
    soll as (
        select k.id, k.bereich, k.name, k.turnus, 'personio'::text as quelle, pf.abteilung::text
        from public.schulung_pflicht pf
        join public.schulung_katalog k on k.id = pf.schulung_id
        join person p on true
        where pf.ebene = 'personio' and k.aktiv and pf.abteilung = p.abteilung
        union
        select k.id, k.bereich, k.name, k.turnus, 'kuerzel'::text, pf.abteilung::text
        from public.schulung_pflicht pf
        join public.schulung_katalog k on k.id = pf.schulung_id
        join kuerzel ku on ku.abteilung_kuerzel = pf.abteilung
        where pf.ebene = 'kuerzel' and k.aktiv
    )
    select s.id, s.bereich, s.name, s.turnus, s.quelle, s.abteilung,
           exists (select 1 from public.schulung_teilnahmen t
                   where t.schulung_id = s.id and t.employee_id = p_employee_id)
    from soll s order by 5, 2, 3;
$$;
grant execute on function public.schulungsplan(integer) to authenticated;

drop index if exists public.einarbeitung_pflicht_eindeutig;
delete from public.einarbeitung_pflicht where geltung <> 'abteilung' or abteilung is null;
alter table public.einarbeitung_pflicht
    drop constraint einarbeitung_pflicht_felder,
    drop constraint einarbeitung_pflicht_geltung,
    drop column geltung, drop column "position", drop column position_norm,
    alter column abteilung set not null;
alter table public.einarbeitung_pflicht
    add constraint einarbeitung_pflicht_eindeutig unique (einarbeitung_id, abteilung);

drop index if exists public.schulung_pflicht_eindeutig;
delete from public.schulung_pflicht where geltung <> 'abteilung' or abteilung is null;
alter table public.schulung_pflicht
    add column ebene varchar(20);
update public.schulung_pflicht set ebene = 'personio';
alter table public.schulung_pflicht
    drop constraint schulung_pflicht_felder,
    drop constraint schulung_pflicht_geltung,
    drop column geltung, drop column "position", drop column position_norm,
    alter column abteilung set not null,
    alter column ebene set not null;
alter table public.schulung_pflicht
    add constraint schulung_pflicht_ebene check (ebene in ('kuerzel', 'personio')),
    add constraint schulung_pflicht_eindeutig unique (schulung_id, ebene, abteilung);

drop function if exists public.pflicht_position_norm();
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
