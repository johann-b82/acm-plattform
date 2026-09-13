-- AD-Gruppen → App-Rechte (freigegeben 2026-09-13).
--
-- Standortspezifisch: die AD-Gruppen entstehen erst, wenn ein Mitglied sich
-- anmeldet (source='ad'). Darum kein Alembic-Seed, sondern ein wiederholbares
-- Skript, das über den Gruppennamen zuordnet. Gruppen, die (noch) nicht
-- gespiegelt sind, werden übersprungen; erneutes Ausführen ist gefahrlos.
--
--   docker compose exec -T db psql -U postgres -d postgres < scripts/ad-rechte-mapping.sql
--
-- Levels: viewer | editor | admin. platform:admin sieht alles (auch uploads,
-- sensors, settings) — dafür gibt es bewusst keine eigene Gruppe.
-- Break-Glass: die lokale Gruppe „Plattform-Admins" bleibt unabhängig vom AD.

begin;

with mapping(gruppe, app_id, level) as (values
    ('grp_IT',                  'platform',   'admin'),
    ('grp_GL',                  'kpi',        'viewer'),
    ('grp_Management',          'kpi',        'viewer'),
    ('grp_Vertrieb',            'kpi',        'viewer'),
    ('grp_Angebote',            'kpi',        'viewer'),
    ('grp_FTM_Marketing-Sales', 'kpi',        'viewer'),
    ('grp_Einkauf',             'kpi',        'viewer'),
    ('grp_SupplierManagement',  'kpi',        'viewer'),
    ('grp_Finance',             'kpi',        'viewer'),
    ('grp_Buchhaltung',         'kpi',        'viewer'),
    ('grp_QS',                  'quality',    'editor'),
    ('grp_QS',                  'kpi',        'viewer'),
    ('grp_Produktion',          'production', 'editor'),
    ('grp_Produktion',          'kpi',        'viewer'),
    ('grp_Arbeitsvorbereitung', 'production', 'editor'),
    ('grp_Arbeitsvorbereitung', 'kpi',        'viewer'),
    ('grp_Konstruktion',        'fair',       'editor'),
    ('grp_Konstruktion',        'atr',        'editor'),
    ('grp__Engineering',        'fair',       'editor'),
    ('grp__Engineering',        'atr',        'editor'),
    ('grp_Logistik',            'atr',        'editor'),
    ('grp_Logistik',            'kpi',        'viewer'),
    ('grp_Personalabteilung',   'hr',         'admin'),
    ('grp_HR_Reisemngmt',       'hr',         'viewer'),
    ('grp_Marketing',           'newsletter', 'editor')
)
insert into public.app_grants (group_id, app_id, level)
select g.id, m.app_id, m.level
from mapping m
join public.groups g on g.name = m.gruppe and g.source = 'ad'
on conflict (group_id, app_id) do update set level = excluded.level;

-- Umstellung auf AD: Rechte an gespiegelten AD-Gruppen, die NICHT im Mapping
-- stehen, entfernen (z. B. frühere Handvergaben). Break-Glass bleibt manuell.
delete from public.app_grants ag
using public.groups g
where ag.group_id = g.id
  and g.source = 'ad'
  and (g.name, ag.app_id) not in (
      values
          ('grp_IT','platform'),('grp_GL','kpi'),('grp_Management','kpi'),
          ('grp_Vertrieb','kpi'),('grp_Angebote','kpi'),('grp_FTM_Marketing-Sales','kpi'),
          ('grp_Einkauf','kpi'),('grp_SupplierManagement','kpi'),('grp_Finance','kpi'),
          ('grp_Buchhaltung','kpi'),('grp_QS','quality'),('grp_QS','kpi'),
          ('grp_Produktion','production'),('grp_Produktion','kpi'),
          ('grp_Arbeitsvorbereitung','production'),('grp_Arbeitsvorbereitung','kpi'),
          ('grp_Konstruktion','fair'),('grp_Konstruktion','atr'),
          ('grp__Engineering','fair'),('grp__Engineering','atr'),
          ('grp_Logistik','atr'),('grp_Logistik','kpi'),
          ('grp_Personalabteilung','hr'),('grp_HR_Reisemngmt','hr'),
          ('grp_Marketing','newsletter')
  );

-- Alte manuelle Rechte entfernen (durch AD-Gruppen ersetzt); die
-- Break-Glass-Gruppe „Plattform-Admins" bleibt.
delete from public.app_grants ag
using public.groups g
where ag.group_id = g.id
  and g.source = 'manual'
  and g.name <> 'Plattform-Admins';

-- Verwaiste manuelle Gruppen ohne Mitglieder und ohne Rechte aufräumen.
delete from public.groups g
where g.source = 'manual'
  and g.name <> 'Plattform-Admins'
  and not exists (select 1 from public.user_groups ug where ug.group_id = g.id)
  and not exists (select 1 from public.app_grants ag where ag.group_id = g.id);

commit;
