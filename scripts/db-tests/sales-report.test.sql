-- Sales report aggregate (migration 20261119100000_sales_report.sql) — database checks. Run with
-- scripts/test-db-local.sh (throwaway local Postgres). Creates invoices, so it refuses to run
-- anywhere else. Uses only products from the fixtures (soap, oil, free without HSN, onion sold by
-- weight). The files run in name order, so the invoices of decimal-qty / price-edit (weighed,
-- fractional and price-edited lines) are already there and are covered by the "today" checks.

do $$
begin
  if current_setting('ichiba.throwaway', true) is distinct from 'yes' then
    raise exception 'Refusing to run: this file writes invoices. Use scripts/test-db-local.sh.';
  end if;
end;
$$;

create temp table t_fail (name text);

create function pg_temp.ok(p_name text, p_cond boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then
    raise notice 'PASS  %', p_name;
  else
    insert into t_fail values (p_name);
    raise notice 'FAIL  %  %', p_name, coalesce(p_detail, '');
  end if;
end;
$$;

create function pg_temp.pid(p_name text) returns text language sql as $$
  select case p_name
    when 'soap'  then '00000000-0000-4000-8000-00000000a001'   -- 45.00 / piece, MRP 50.00, 18%, HSN 3401
    when 'oil'   then '00000000-0000-4000-8000-00000000a002'   -- 123.45 / piece, 5%, HSN 1512
    when 'free'  then '00000000-0000-4000-8000-00000000a005'   -- 0.00, 0%, no HSN
    when 'onion' then '00000000-0000-4000-8000-00000000a006'   -- 80.00 / kg, sold by weight, 0%, HSN 0703
  end;
$$;

create function pg_temp.line(p_name text, p_qty jsonb, p_price integer default null) returns jsonb language sql as $$
  select case when p_price is null
    then jsonb_build_object('product_id', pg_temp.pid(p_name), 'qty', p_qty)
    else jsonb_build_object('product_id', pg_temp.pid(p_name), 'qty', p_qty, 'unit_price', p_price) end;
$$;

create function pg_temp.counter(p_code text) returns uuid language sql as $$
  select id from public.counters where code = p_code;
$$;

/** The report, independently: invoice_items joined to invoices, summed per group, plus the total. */
create function pg_temp.expected(p_from timestamptz, p_to timestamptz, p_counter_id uuid, p_group text)
returns table (is_total boolean, hsn text, gst_rate integer, invoice_count bigint, line_count bigint,
               qty_kg numeric, qty_pcs numeric, taxable bigint, cgst bigint, sgst bigint, line_total bigint)
language sql as $$
  with l as (
    select it.*, case when p_group = 'hsn' then nullif(btrim(it.hsn_code), '') end as grp_hsn
      from public.invoice_items it
      join public.invoices i on i.id = it.invoice_id
     where i.created_at >= p_from and i.created_at < p_to
       and (p_counter_id is null or i.counter_id = p_counter_id)
  )
  select false, grp_hsn, l.gst_rate::integer, count(distinct l.invoice_id), count(*),
         coalesce(sum(l.qty) filter (where l.sold_by_weight), 0), coalesce(sum(l.qty) filter (where not l.sold_by_weight), 0),
         sum(l.taxable_value)::bigint, sum(l.cgst)::bigint, sum(l.sgst)::bigint, sum(l.line_total)::bigint
    from l group by grp_hsn, l.gst_rate
  union all
  select true, null, null, count(distinct l.invoice_id), count(*),
         coalesce(sum(l.qty) filter (where l.sold_by_weight), 0), coalesce(sum(l.qty) filter (where not l.sold_by_weight), 0),
         coalesce(sum(l.taxable_value), 0)::bigint, coalesce(sum(l.cgst), 0)::bigint, coalesce(sum(l.sgst), 0)::bigint,
         coalesce(sum(l.line_total), 0)::bigint
    from l;
$$;

/** Rows in one result and not the other (both directions); 0 = identical. */
create function pg_temp.diff(p_from timestamptz, p_to timestamptz, p_counter_id uuid, p_group text)
returns bigint language sql as $$
  select count(*) from (
    (select * from public.sales_report(p_from, p_to, p_counter_id, p_group)
     except all
     select * from pg_temp.expected(p_from, p_to, p_counter_id, p_group))
    union all
    (select * from pg_temp.expected(p_from, p_to, p_counter_id, p_group)
     except all
     select * from public.sales_report(p_from, p_to, p_counter_id, p_group))
  ) d;
$$;

-- ---------------------------------------------------------------------------
-- Three known bills, issued in this one transaction (so they share created_at = now()):
--   A  CL1  onion 0.375 kg (weighed) + soap 2
--   B  CL1  oil 0.5 pcs (fractional) + soap 1.5 at ₹40.00 (price edit) + free 2 (no HSN)
--   C  MOB  soap 1
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.create_invoice('00000000-0000-4000-8000-00000000500a', pg_temp.counter('CL1'),
    '00000000-0000-4000-8000-0000000000c1',
    jsonb_build_array(pg_temp.line('onion', '0.375'), pg_temp.line('soap', '2')), 'cash');
  perform public.create_invoice('00000000-0000-4000-8000-00000000500b', pg_temp.counter('CL1'),
    '00000000-0000-4000-8000-0000000000c1',
    jsonb_build_array(pg_temp.line('oil', '0.5'), pg_temp.line('soap', '1.5', 4000), pg_temp.line('free', '2')), 'upi');
  perform public.create_invoice('00000000-0000-4000-8000-00000000500c', pg_temp.counter('MOB'),
    '00000000-0000-4000-8000-0000000000c2',
    jsonb_build_array(pg_temp.line('soap', '1')), 'card');
end;
$$;

create temp table t_known as
  select min(created_at) as t0, min(created_at) + interval '1 microsecond' as t1
    from public.invoices
   where idempotency_key in ('00000000-0000-4000-8000-00000000500a', '00000000-0000-4000-8000-00000000500b',
                             '00000000-0000-4000-8000-00000000500c');

do $$
declare
  v_t0 timestamptz := (select t0 from t_known);
  v_t1 timestamptz := (select t1 from t_known);
  v_rows text;
begin
  perform pg_temp.ok('setup: exactly the three known bills in the isolated range',
    (select count(*) = 3 from public.invoices where created_at >= v_t0 and created_at < v_t1));

  -- Hand-computed (REQUIREMENTS.md sections 3, 16, 17):
  --   onion 0.375 × 8000 = 3000 (0%)       soap 2 × 4500 = 9000 -> 7627 + 686 + 687
  --   oil 0.5 × 12345 = 6172.5 -> 6173 -> 5879 + 147 + 147
  --   soap 1.5 × 4000 (edited) = 6000 -> 5085 + 457 + 458     free 2 × 0 = 0
  --   soap 1 × 4500 = 4500 -> 3814 + 343 + 343
  select string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', r.is_total, coalesce(r.hsn, '-'), coalesce(r.gst_rate::text, '-'),
                           r.invoice_count, r.line_count, r.qty_kg, r.qty_pcs, r.taxable, r.cgst, r.sgst, r.line_total), ' ; ')
    into v_rows
    from public.sales_report(v_t0, v_t1, null, 'hsn') r;
  perform pg_temp.ok('hsn: known bills, per HSN + rate, missing HSN last, total row last',
    v_rows = 'f|0703|0|1|1|0.375|0|3000|0|0|3000'
      || ' ; f|1512|5|1|1|0|0.500|5879|147|147|6173'
      || ' ; f|3401|18|3|3|0|4.500|16526|1486|1488|19500'
      || ' ; f|-|0|1|1|0|2.000|0|0|0|0'
      || ' ; t|-|-|3|6|0.375|7.000|25405|1633|1635|28673', v_rows);

  select string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', r.is_total, coalesce(r.hsn, '-'), coalesce(r.gst_rate::text, '-'),
                           r.invoice_count, r.line_count, r.qty_kg, r.qty_pcs, r.taxable, r.cgst, r.sgst, r.line_total), ' ; ')
    into v_rows
    from public.sales_report(v_t0, v_t1, null, 'gst') r;
  perform pg_temp.ok('gst: known bills per rate (0% merges onion and the item without HSN), hsn always null',
    v_rows = 'f|-|0|2|2|0.375|2.000|3000|0|0|3000'
      || ' ; f|-|5|1|1|0|0.500|5879|147|147|6173'
      || ' ; f|-|18|3|3|0|4.500|16526|1486|1488|19500'
      || ' ; t|-|-|3|6|0.375|7.000|25405|1633|1635|28673', v_rows);

  perform pg_temp.ok('counter: CL1 only leaves out the MOB bill',
    (select r.invoice_count = 2 and r.line_count = 5 and r.taxable = 25405 - 3814 and r.line_total = 28673 - 4500
       from public.sales_report(v_t0, v_t1, pg_temp.counter('CL1'), 'hsn') r where r.is_total));
  perform pg_temp.ok('counter: MOB only is the one soap',
    (select string_agg(format('%s %s %s %s', coalesce(r.hsn, 'total'), r.invoice_count, r.qty_pcs, r.line_total), ';')
       from public.sales_report(v_t0, v_t1, pg_temp.counter('MOB'), 'hsn') r)
    = '3401 1 1.000 4500;total 1 1.000 4500');

  perform pg_temp.ok('total row: taxable/CGST/SGST equal the invoices'' own totals, line_total their subtotal',
    (select r.taxable = s.tx and r.cgst = s.cg and r.sgst = s.sg and r.line_total = s.sub and r.invoice_count = s.n
       from public.sales_report(v_t0, v_t1, null, 'hsn') r,
            (select sum(taxable_total) tx, sum(cgst_total) cg, sum(sgst_total) sg, sum(subtotal) sub, count(*) n
               from public.invoices where created_at >= v_t0 and created_at < v_t1) s
      where r.is_total));
end;
$$;

-- ---------------------------------------------------------------------------
-- Everything issued so far (fixtures + the other test files: weighed, fractional, price-edited
-- lines on CL1 and MOB) against the independent sum of invoice_items
-- ---------------------------------------------------------------------------
do $$
declare
  v_from timestamptz := now() - interval '1 day';
  v_to   timestamptz := now() + interval '1 day';
  g      text;
  c      text;
  v_diff bigint;
begin
  perform pg_temp.ok('setup: the range holds weighed, fractional and price-edited lines',
    (select bool_or(it.sold_by_weight) and bool_or(not it.sold_by_weight and it.qty <> trunc(it.qty)) and bool_or(it.price_edited)
       from public.invoice_items it join public.invoices i on i.id = it.invoice_id
      where i.created_at >= v_from and i.created_at < v_to));

  foreach g in array array['hsn', 'gst'] loop
    foreach c in array array['all', 'CL1', 'MOB'] loop
      v_diff := pg_temp.diff(v_from, v_to, case when c = 'all' then null else pg_temp.counter(c) end, g);
      perform pg_temp.ok(format('equals the sum of invoice_items (%s, %s)', g, c), v_diff = 0, v_diff || ' differing rows');
    end loop;

    perform pg_temp.ok(format('group rows add up to the total row (%s)', g),
      (select t.line_count = s.lines and t.qty_kg = s.kg and t.qty_pcs = s.pcs and t.taxable = s.tx
              and t.cgst = s.cg and t.sgst = s.sg and t.line_total = s.lt and t.invoice_count <= s.inv
         from public.sales_report(v_from, v_to, null, g) t,
              (select sum(line_count) lines, sum(qty_kg) kg, sum(qty_pcs) pcs, sum(taxable) tx, sum(cgst) cg,
                      sum(sgst) sg, sum(line_total) lt, sum(invoice_count) inv
                 from public.sales_report(v_from, v_to, null, g) where not is_total) s
        where t.is_total));
    perform pg_temp.ok(format('taxable + CGST + SGST = line total on every row (%s)', g),
      (select bool_and(taxable + cgst + sgst = line_total) from public.sales_report(v_from, v_to, null, g)));
  end loop;

  perform pg_temp.ok('total row matches invoice_day_totals (the Invoices page) for the same range',
    (select r.invoice_count = d.n and r.taxable = d.tx and r.cgst = d.cg and r.sgst = d.sg
            and r.line_total = d.gt - d.ro
       from public.sales_report(v_from, v_to, null, 'gst') r,
            (select sum(invoice_count) n, sum(taxable_total) tx, sum(cgst_total) cg, sum(sgst_total) sg,
                    sum(grand_total) gt, sum(round_off) ro
               from public.invoice_day_totals(v_from, v_to)) d
      where r.is_total));
end;
$$;

-- ---------------------------------------------------------------------------
-- Empty ranges, bad arguments, privileges, index
-- ---------------------------------------------------------------------------
do $$
declare
  v_state text;
  v_msg   text;
begin
  perform pg_temp.ok('empty range: only the total row, all zeros',
    (select count(*) = 1 and bool_and(is_total and hsn is null and gst_rate is null and invoice_count = 0 and line_count = 0
                                      and qty_kg = 0 and qty_pcs = 0 and taxable = 0 and cgst = 0 and sgst = 0 and line_total = 0)
       from public.sales_report(now() + interval '10 days', now() + interval '11 days', null, 'hsn')));
  perform pg_temp.ok('zero-length range (from = to): only the zero total row',
    (select count(*) = 1 and bool_and(is_total and line_total = 0) from public.sales_report(now(), now(), null, 'gst')));
  perform pg_temp.ok('unknown counter id: only the zero total row',
    (select count(*) = 1 and bool_and(is_total and invoice_count = 0)
       from public.sales_report(now() - interval '1 day', now() + interval '1 day', gen_random_uuid(), 'hsn')));
  perform pg_temp.ok('p_group defaults to hsn',
    (select count(*) filter (where hsn is not null) > 0 from public.sales_report(now() - interval '1 day', now() + interval '1 day')));

  begin
    perform * from public.sales_report(now(), now() + interval '1 day', null, 'item');
    perform pg_temp.ok('p_group ''item'' refused', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform pg_temp.ok('p_group ''item'' refused', v_state = '22023', v_msg);
  end;
  begin
    perform * from public.sales_report(now(), now() + interval '1 day', null, null);
    perform pg_temp.ok('p_group null refused', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_temp.ok('p_group null refused', v_state = '22023');
  end;
  begin
    perform * from public.sales_report(now(), now() - interval '1 day', null, 'hsn');
    perform pg_temp.ok('to before from refused', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_temp.ok('to before from refused', v_state = '22023');
  end;

  perform pg_temp.ok('privileges: only service_role can execute sales_report',
    has_function_privilege('service_role', 'public.sales_report(timestamptz, timestamptz, uuid, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.sales_report(timestamptz, timestamptz, uuid, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.sales_report(timestamptz, timestamptz, uuid, text)', 'EXECUTE')
    and not exists (select 1 from information_schema.routine_privileges
                     where routine_schema = 'public' and routine_name = 'sales_report' and grantee = 'PUBLIC'));
  perform pg_temp.ok('security definer with an empty search_path',
    (select p.prosecdef and 'search_path=""' = any(p.proconfig)
       from pg_proc p where p.oid = 'public.sales_report(timestamptz, timestamptz, uuid, text)'::regprocedure));
  perform pg_temp.ok('index: covering index on invoice_items(invoice_id)',
    exists (select 1 from pg_indexes where indexname = 'invoice_items_invoice_id_report_idx'));
end;
$$;

do $$
declare
  v_failed text := (select string_agg(name, '; ') from t_fail);
begin
  if v_failed is not null then
    raise exception 'sales-report tests failed: %', v_failed;
  end if;
  raise notice 'sales-report: all checks passed';
end;
$$;
