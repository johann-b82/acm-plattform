-- KPI-Schnappschuss der Plattform als ein JSON-Dokument (nur lesend).
--
--   psql -At -v von=2025-01-01 -v bis=2026-10-31 -f kpi_snapshot.sql > vorher.json
--
-- Ruft jede Funktion public.kpi_* auf, die mit (von, bis) oder ganz ohne Pflichtargumente
-- auskommt — je Monat im Fenster, je Kalenderjahr und für das ganze Fenster. Dazu Zeilenzahlen
-- der 14 Apollo-Importtabellen und Zeilenzahl + Prüfsumme der Sichten, die auf ihnen aufsetzen.
-- Die Hilfsfunktion liegt in pg_temp (verschwindet mit der Sitzung); danach wird die Transaktion
-- auf READ ONLY gestellt, keine KPI-Funktion kann dabei etwas schreiben, und am Ende ROLLBACK.
\set ON_ERROR_STOP on
begin;

create function pg_temp.kpi_snapshot(p_von date, p_bis date) returns jsonb
language plpgsql as $f$
declare
    t text; n bigint; h text;
    tabellen jsonb := '{}'; sichten jsonb := '{}'; kpi jsonb := '{}'; uebersprungen jsonb := '[]';
    f record; fenster jsonb; ergebnis jsonb; w record; q text;
begin
    foreach t in array array['revenues', 'auftraege', 'delivery_reliability', 'auftrag_positionen',
                             'delivery_records', 'goods_receipt_records', 'quality_records',
                             'inspection_records', 'material_movements', 'material_prices',
                             'stock_article_prices', 'sales_contacts', 'offers', 'interessenten'] loop
        execute format('select count(*) from public.%I', t) into n;
        tabellen := tabellen || jsonb_build_object(t, n);
    end loop;

    foreach t in array array['auftrag_verzug', 'artikel_preise'] loop
        begin
            execute format('select count(*), md5(coalesce(string_agg(x::text, E''\n'' order by x::text), ''''))'
                           ' from public.%I x', t) into n, h;
            sichten := sichten || jsonb_build_object(t, jsonb_build_object('zeilen', n, 'md5', h));
        exception when others then
            sichten := sichten || jsonb_build_object(t, jsonb_build_object('fehler', sqlerrm));
        end;
    end loop;

    for f in
        select p.proname, p.pronargs, p.pronargdefaults, p.proretset,
               array(select format_type(a.t, null) from unnest(p.proargtypes) with ordinality a(t, i)
                     order by a.i) as typen                     -- 1-basiert (oidvector beginnt bei 0)
        from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'public' and p.proname like 'kpi\_%' and p.prokind = 'f'
          and p.prorettype <> 'trigger'::regtype
        order by p.proname
    loop
        fenster := '{}';
        if f.pronargs - f.pronargdefaults = 0 then
            q := format('public.%I()', f.proname);
            begin
                if f.proretset then
                    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %s x', q) into ergebnis;
                else
                    execute format('select to_jsonb(%s)', q) into ergebnis;
                end if;
            exception when others then ergebnis := jsonb_build_object('fehler', sqlerrm);
            end;
            fenster := jsonb_build_object('-', ergebnis);
        elsif f.pronargs >= 2 and f.typen[1] = 'date' and f.typen[2] = 'date'
              and f.pronargs - f.pronargdefaults <= 2 then
            for w in
                select to_char(m, 'YYYY-MM') as name, m::date as von,
                       least((m + interval '1 month - 1 day')::date, p_bis) as bis
                from generate_series(date_trunc('month', p_von), p_bis, interval '1 month') m
                union all
                select to_char(j, 'YYYY'), greatest(j::date, p_von),
                       least((j + interval '1 year - 1 day')::date, p_bis)
                from generate_series(date_trunc('year', p_von), p_bis, interval '1 year') j
                union all
                select 'gesamt', p_von, p_bis
            loop
                q := format('public.%I(%L::date, %L::date)', f.proname, w.von, w.bis);
                begin
                    if f.proretset then
                        execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %s x', q) into ergebnis;
                    else
                        execute format('select to_jsonb(%s)', q) into ergebnis;
                    end if;
                exception when others then ergebnis := jsonb_build_object('fehler', sqlerrm);
                end;
                fenster := fenster || jsonb_build_object(w.name, ergebnis);
            end loop;
        else
            uebersprungen := uebersprungen || to_jsonb(f.proname || '(' || array_to_string(f.typen, ', ') || ')');
            continue;
        end if;
        kpi := kpi || jsonb_build_object(f.proname, fenster);
    end loop;

    return jsonb_build_object('erstellt', now(), 'von', p_von, 'bis', p_bis, 'tabellen', tabellen,
                              'sichten', sichten, 'kpi', kpi, 'uebersprungen', uebersprungen);
end
$f$;

set transaction read only;
select pg_temp.kpi_snapshot(:'von'::date, :'bis'::date)::text;
rollback;
