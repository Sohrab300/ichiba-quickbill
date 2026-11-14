-- Migration: privilege hardening before launch (REQUIREMENTS.md section 11)
--
-- Found by the launch review (`supabase db advisors` + pg_catalog, 15 Nov 2026):
--
-- * public.update_updated_at_column() (trigger function from the first migrations) still had
--   Supabase's default EXECUTE for anon/authenticated. It returns `trigger`, so it cannot be
--   called through /rest/v1/rpc, but nothing in public should be executable by API roles.
-- * public.rls_auto_enable() is created by the Supabase dashboard's "automatically enable RLS"
--   option (event trigger `ensure_rls`), is SECURITY DEFINER, and had EXECUTE for
--   anon/authenticated (advisor lints 0028/0029). It returns `event_trigger`, so it cannot be
--   called directly either; revoking EXECUTE does not stop the event trigger from firing
--   (trigger functions are not privilege-checked when they fire). Not present on every
--   database (local stack, branches), hence the existence check.
-- * Supabase's default privileges grant anon/authenticated ALL on every new table, sequence and
--   function created in public. This app never lets the browser touch the database (all data
--   goes through the server's secret key), so stop that for objects created by `postgres`
--   (migrations, SQL editor). Postgres itself still gives PUBLIC EXECUTE on new functions, so
--   every migration must keep revoking explicitly, as the earlier ones do.
--
-- Finally the invariants are asserted, so this migration fails (and rolls back) if anything is off:
--   - RLS enabled on every table in public;
--   - anon/authenticated hold no privilege on any table, view or sequence in public;
--   - anon/authenticated cannot EXECUTE any function in public;
--   - every SECURITY DEFINER function in public pins its search_path.
-- The same checks, read-only and re-runnable: scripts/db-audit.sql.

revoke all on function public.update_updated_at_column() from public, anon, authenticated, service_role;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;
  end if;
end;
$$;

alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

do $$
declare
  v_problems text;
begin
  select string_agg(problem, E'\n' order by problem)
    into v_problems
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
    ) x;

  if v_problems is not null then
    raise exception 'Privilege check failed:%', E'\n' || v_problems
      using hint = 'Enable RLS / revoke the privilege in a migration, then re-run.';
  end if;
end;
$$;
