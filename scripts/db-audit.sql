-- Read-only database audit (REQUIREMENTS.md section 11). Returns one row per problem; no rows = pass.
--
--   npx supabase db query --remote --read-only -f scripts/db-audit.sql     # linked project
--   npx supabase db query --read-only -f scripts/db-audit.sql              # local stack
--
-- Same rules as the assertion in supabase/migrations/20261115200000_harden_privileges.sql, plus
-- a check that service_role can still call every RPC the app uses.
select problem
  from (
    select format('table %s: row level security is disabled', c.oid::regclass) as problem
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity
    union all
    select format('%s %s: %s has privileges', case c.relkind when 'S' then 'sequence' else 'table' end, c.oid::regclass, r.role)
      from pg_class c
      cross join (values ('anon'), ('authenticated')) r(role)
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
       and case c.relkind
             when 'S' then has_sequence_privilege(r.role, c.oid, 'USAGE, SELECT, UPDATE')
             else has_table_privilege(r.role, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           end
    union all
    select format('function %s: %s can execute it', p.oid::regprocedure, r.role)
      from pg_proc p
      cross join (values ('anon'), ('authenticated')) r(role)
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege(r.role, p.oid, 'EXECUTE')
    union all
    select format('function %s: SECURITY DEFINER without a fixed search_path', p.oid::regprocedure)
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosecdef
       and not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
    union all
    select format('function %s: missing, or service_role cannot execute it (the app calls it)', f.sig)
      from (values
              ('public.lookup_product(text)'),
              ('public.create_invoice(uuid,uuid,uuid,jsonb,text)'),
              ('public.get_invoice(uuid)'),
              ('public.invoice_day_totals(timestamptz,timestamptz,uuid)'),
              ('public.invoice_export_summary(timestamptz,timestamptz,uuid,timestamptz,text,integer)'),
              ('public.invoice_export_lines(timestamptz,timestamptz,uuid,timestamptz,text,integer,integer)')
           ) f(sig)
     where to_regprocedure(f.sig) is null
        or not has_function_privilege('service_role', to_regprocedure(f.sig), 'EXECUTE')
  ) x
 order by problem;
