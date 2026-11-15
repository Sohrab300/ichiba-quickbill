-- Decimal quantities on every product (REQUIREMENTS.md section 17, migration
-- 20261115500000_decimal_qty_all_products.sql) — database checks. Run with
-- scripts/test-db-local.sh (throwaway local Postgres). Creates invoices, so it refuses to run
-- anywhere else. Uses only products from the fixtures (soap, oil, odd, onion sold by weight).

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
    when 'soap'  then '00000000-0000-4000-8000-00000000a001'   -- 45.00 / piece, MRP 50.00, 18%
    when 'oil'   then '00000000-0000-4000-8000-00000000a002'   -- 123.45 / piece, MRP 150.00, 5%
    when 'odd'   then '00000000-0000-4000-8000-00000000a004'   -- 1.01 / piece, MRP 1.99, 28%
    when 'onion' then '00000000-0000-4000-8000-00000000a006'   -- 80.00 / kg, sold by weight, 0%
  end;
$$;

create function pg_temp.key(n integer) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid;
$$;

create function pg_temp.line(p_name text, p_qty jsonb, p_price integer default null) returns jsonb language sql as $$
  select case when p_price is null
    then jsonb_build_object('product_id', pg_temp.pid(p_name), 'qty', p_qty)
    else jsonb_build_object('product_id', pg_temp.pid(p_name), 'qty', p_qty, 'unit_price', p_price) end;
$$;

create function pg_temp.sale(p_key uuid, p_items jsonb, p_method text default 'cash')
returns jsonb language sql as $$
  select public.create_invoice(
    p_key, (select id from public.counters where code = 'CL1'),
    '00000000-0000-4000-8000-0000000000c1', p_items, p_method);
$$;

create function pg_temp.sale_error(p_key uuid, p_items jsonb)
returns text language plpgsql as $$
declare
  v_state text;
  v_msg   text;
begin
  perform pg_temp.sale(p_key, p_items);
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return v_state || ' ' || v_msg;
end;
$$;

create function pg_temp.cl1_last_number() returns integer language sql as $$
  select coalesce(max(s.last_number), 0)
    from public.invoice_sequences s join public.counters c on c.id = s.counter_id
   where c.code = 'CL1';
$$;

-- ---------------------------------------------------------------------------
-- Migration: schema, existing rows, immutability
-- ---------------------------------------------------------------------------
do $$
declare
  v_msg text;
begin
  perform pg_temp.ok('schema: invoices.total_qty is numeric(12,3)',
    (select format_type(atttypid, atttypmod) = 'numeric(12,3)'
       from pg_attribute where attrelid = 'public.invoices'::regclass and attname = 'total_qty'));
  perform pg_temp.ok('schema: invoices.has_fractional_qty boolean not null default false',
    (select format_type(a.atttypid, a.atttypmod) = 'boolean' and a.attnotnull and pg_get_expr(d.adbin, d.adrelid) = 'false'
       from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.invoices'::regclass and a.attname = 'has_fractional_qty'));
  perform pg_temp.ok('schema: invoice_items_qty_whole replaced by invoice_items_qty_pieces',
    not exists (select 1 from pg_constraint where conname = 'invoice_items_qty_whole')
    and exists (select 1 from pg_constraint where conname = 'invoice_items_qty_pieces')
    and exists (select 1 from pg_constraint where conname = 'invoice_items_qty_weighed'));

  -- Invoices from before the migration (fixtures.sql + fixtures-before-decimal-qty.sql).
  perform pg_temp.ok('existing invoices: has_fractional_qty false, total_qty unchanged pieces',
    (select count(*) = 3
            and not bool_or(i.has_fractional_qty)
            and bool_and(i.total_qty = (select coalesce(sum(it.qty) filter (where not it.sold_by_weight), 0)
                                          from public.invoice_items it where it.invoice_id = i.id))
       from public.invoices i
      where i.idempotency_key in ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-0000000b0002',
                                  '00000000-0000-4000-8000-0000000b0003')));
  perform pg_temp.ok('existing weighed + edited invoice still reads the same (0.375 kg onion, 3 soap at ₹42)',
    (select (j ->> 'total_qty')::numeric = 3 and (j -> 'total_qty')::text = '3.000'
            and (j -> 'items' -> 0 -> 'qty')::text = '0.375' and (j -> 'items' -> 0 ->> 'line_total')::int = 3000
            and (j ->> 'has_price_edit')::boolean and not (j ->> 'has_fractional_qty')::boolean
       from (select public.invoice_json(id) as j from public.invoices
              where idempotency_key = '00000000-0000-4000-8000-0000000b0003') x));
  perform pg_temp.ok('immutability: all four invoice triggers enabled',
    (select count(*) = 4
       from pg_trigger
      where tgname in ('invoices_immutable_row', 'invoices_immutable_truncate',
                       'invoice_items_immutable_row', 'invoice_items_immutable_truncate')
        and tgenabled = 'O'));
  begin
    update public.invoices set has_fractional_qty = true;
    perform pg_temp.ok('immutability: UPDATE invoices refused', false);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.ok('immutability: UPDATE invoices refused', v_msg like 'Issued invoices are immutable%', v_msg);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refused quantities on normal items: nothing is created, no number is used
-- ---------------------------------------------------------------------------
do $$
declare
  v_before_n integer := pg_temp.cl1_last_number();
  v_before_i bigint  := (select count(*) from public.invoices);
  v_err      text;
  r          record;
begin
  for r in
    select * from (values
      ('qty 0',                          jsonb_build_array(pg_temp.line('soap', '0')),          'more than 0'),
      ('qty 0.000',                      jsonb_build_array(pg_temp.line('soap', '0.000')),      'more than 0'),
      ('qty -0.5',                       jsonb_build_array(pg_temp.line('soap', '-0.5')),       'more than 0'),
      ('qty 1.2345 (4 decimals)',        jsonb_build_array(pg_temp.line('soap', '1.2345')),     'at most 3 decimals'),
      ('qty 0.0005',                     jsonb_build_array(pg_temp.line('soap', '0.0005')),     'at most 3 decimals'),
      ('qty 10000',                      jsonb_build_array(pg_temp.line('soap', '10000')),      'cannot exceed 9999'),
      ('qty 9999.001',                   jsonb_build_array(pg_temp.line('soap', '9999.001')),   'cannot exceed 9999'),
      ('qty 9999 + 0.5 merged',          jsonb_build_array(pg_temp.line('soap', '9999'), pg_temp.line('soap', '0.5')),
                                                                                                 'must not exceed 9999'),
      ('qty as a string "0.5"',          jsonb_build_array(pg_temp.line('soap', '"0.5"')),      'numeric qty'),
      ('qty "NaN"',                      jsonb_build_array(pg_temp.line('soap', '"NaN"')),      'numeric qty'),
      ('qty "Infinity"',                 jsonb_build_array(pg_temp.line('soap', '"Infinity"')), 'numeric qty'),
      ('qty null',                       jsonb_build_array(pg_temp.line('soap', 'null')),       'numeric qty'),
      ('qty missing',                    jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('soap'))),
                                                                                                 'numeric qty'),
      ('weighed line still max 999.999', jsonb_build_array(pg_temp.line('soap', '0.5'), pg_temp.line('onion', '1000')),
                                                                                                 'cannot exceed 999.999 kg'),
      ('one bad line refuses the bill',  jsonb_build_array(pg_temp.line('soap', '0.5'), pg_temp.line('oil', '2.0001')),
                                                                                                 'at most 3 decimals')
    ) as t(name, items, expect)
  loop
    v_err := pg_temp.sale_error(gen_random_uuid(), r.items);
    perform pg_temp.ok('refused: ' || r.name, v_err like '22023 %' and v_err like '%' || r.expect || '%', v_err);
  end loop;

  perform pg_temp.ok('refused quantities created no invoice', (select count(*) from public.invoices) = v_before_i);
  perform pg_temp.ok('refused quantities used no invoice number', pg_temp.cl1_last_number() = v_before_n,
    format('before %s after %s', v_before_n, pg_temp.cl1_last_number()));
end;
$$;

-- ---------------------------------------------------------------------------
-- Accepted decimals on normal items
-- ---------------------------------------------------------------------------
do $$
declare
  v_inv    jsonb;
  v_again  jsonb;
  v_line   jsonb;
  v_before integer;
begin
  -- 0.5 shampoo-like soap: half of ₹45.00 = ₹22.50 (the README check).
  v_inv := pg_temp.sale(pg_temp.key(3001), jsonb_build_array(pg_temp.line('soap', '0.5')));
  v_line := v_inv -> 'items' -> 0;
  perform pg_temp.ok('0.5 pcs × ₹45.00 = ₹22.50, 18% GST on the line total (1907 + 171 + 172)',
    (v_line ->> 'line_total')::int = 2250 and (v_line ->> 'taxable_value')::int = 1907
      and (v_line ->> 'cgst')::int = 171 and (v_line ->> 'sgst')::int = 172, v_line::text);
  perform pg_temp.ok('0.5 pcs: qty 0.500, not weighed; invoice 0.5 pieces and has_fractional_qty',
    (v_line -> 'qty')::text = '0.500' and not (v_line ->> 'sold_by_weight')::boolean
      and (v_inv -> 'total_qty')::text = '0.500' and (v_inv ->> 'has_fractional_qty')::boolean
      and (v_inv ->> 'grand_total')::int = 2300 and (v_inv ->> 'round_off')::int = 50, v_inv::text);

  v_inv := pg_temp.sale(pg_temp.key(3002), jsonb_build_array(pg_temp.line('oil', '2.75')));
  perform pg_temp.ok('2.75 pcs × ₹123.45 = 339.4875 -> ₹339.49',
    (v_inv -> 'items' -> 0 ->> 'line_total')::int = 33949 and (v_inv ->> 'has_fractional_qty')::boolean, v_inv::text);

  v_inv := pg_temp.sale(pg_temp.key(3003), jsonb_build_array(pg_temp.line('odd', '0.001')));
  perform pg_temp.ok('0.001 pcs × ₹1.01 = 0.101 paise -> 0, still a valid bill',
    (v_inv -> 'items' -> 0 ->> 'line_total')::int = 0 and (v_inv -> 'items' -> 0 -> 'qty')::text = '0.001'
      and (v_inv ->> 'has_fractional_qty')::boolean, v_inv::text);

  v_inv := pg_temp.sale(pg_temp.key(3004), jsonb_build_array(pg_temp.line('odd', '9999')));
  perform pg_temp.ok('9999 pcs (the maximum) accepted, whole -> no fraction flag',
    (v_inv -> 'items' -> 0 ->> 'line_total')::int = 1009899 and (v_inv ->> 'total_qty')::numeric = 9999
      and not (v_inv ->> 'has_fractional_qty')::boolean, v_inv::text);

  v_inv := pg_temp.sale(pg_temp.key(3005), jsonb_build_array(pg_temp.line('odd', '9999.000')));
  perform pg_temp.ok('9999.000 is the whole number 9999', not (v_inv ->> 'has_fractional_qty')::boolean, v_inv::text);

  -- The flag is about lines NOT sold by weight: weighed decimals never set it.
  v_inv := pg_temp.sale(pg_temp.key(3006), jsonb_build_array(pg_temp.line('onion', '0.250'), pg_temp.line('soap', '2')));
  perform pg_temp.ok('weighed 0.250 kg + 2 whole pcs: has_fractional_qty false, 2 pieces',
    not (v_inv ->> 'has_fractional_qty')::boolean and (v_inv ->> 'total_qty')::numeric = 2, v_inv::text);

  -- Mixed: pieces sum only the non-weighed lines, exactly.
  v_inv := pg_temp.sale(pg_temp.key(3007), jsonb_build_array(
    pg_temp.line('soap', '0.1'), pg_temp.line('onion', '1.5'), pg_temp.line('oil', '0.2')));
  perform pg_temp.ok('mixed: 0.1 + 0.2 pcs = 0.300 pieces (kg left out), fraction flagged',
    (v_inv -> 'total_qty')::text = '0.300' and (v_inv ->> 'item_count')::int = 3
      and (v_inv ->> 'has_fractional_qty')::boolean, v_inv::text);

  -- Repeated product ids are merged first; the flag follows the stored (merged) line.
  v_inv := pg_temp.sale(pg_temp.key(3008), jsonb_build_array(pg_temp.line('soap', '0.5'), pg_temp.line('soap', '0.5')));
  perform pg_temp.ok('0.5 + 0.5 of one product: one line of 1.000, no fraction flag',
    jsonb_array_length(v_inv -> 'items') = 1 and (v_inv -> 'items' -> 0 -> 'qty')::text = '1.000'
      and (v_inv -> 'items' -> 0 ->> 'line_total')::int = 4500 and not (v_inv ->> 'has_fractional_qty')::boolean,
    v_inv::text);
  v_inv := pg_temp.sale(pg_temp.key(3009), jsonb_build_array(pg_temp.line('odd', '0.5'), pg_temp.line('odd', '0.25')));
  perform pg_temp.ok('0.5 + 0.25 merged to 0.750 and rounded once (101 × 0.75 = 75.75 -> 76)',
    (v_inv -> 'items' -> 0 -> 'qty')::text = '0.750' and (v_inv -> 'items' -> 0 ->> 'line_total')::int = 76
      and (v_inv ->> 'has_fractional_qty')::boolean, v_inv::text);

  -- Price edit on a fractional piece qty: the edited price applies to the whole line.
  v_inv := pg_temp.sale(pg_temp.key(3010), jsonb_build_array(pg_temp.line('soap', '1.5', 4000)));
  v_line := v_inv -> 'items' -> 0;
  perform pg_temp.ok('price edit on 1.5 pcs: × ₹40.00 = ₹60.00, both flags set',
    (v_line ->> 'line_total')::int = 6000 and (v_line ->> 'price_edited')::boolean
      and (v_line ->> 'catalog_price')::int = 4500
      and (v_inv ->> 'has_price_edit')::boolean and (v_inv ->> 'has_fractional_qty')::boolean, v_line::text);
  perform pg_temp.ok('price edit above MRP still refused on a fractional qty',
    pg_temp.sale_error(pg_temp.key(3011), jsonb_build_array(pg_temp.line('soap', '0.5', 5001))) like '22023 Price not allowed%');

  -- Idempotent retry: same key, different items -> the original invoice, no new number.
  v_inv := pg_temp.sale(pg_temp.key(3001), jsonb_build_array(pg_temp.line('soap', '0.5')));
  v_before := pg_temp.cl1_last_number();
  v_again := pg_temp.sale(pg_temp.key(3001), jsonb_build_array(pg_temp.line('soap', '3')), 'upi');
  perform pg_temp.ok('idempotent retry returns the original fractional invoice unchanged',
    v_again = v_inv and (v_again -> 'items' -> 0 -> 'qty')::text = '0.500');
  perform pg_temp.ok('idempotent retry used no new number', pg_temp.cl1_last_number() = v_before);
  perform pg_temp.ok('idempotent retry with an invalid qty still returns the original',
    pg_temp.sale(pg_temp.key(3001), jsonb_build_array(pg_temp.line('soap', '1.2345'))) = v_inv);
  perform pg_temp.ok('get_invoice returns the same JSON', public.get_invoice((v_inv ->> 'id')::uuid) = v_inv);
end;
$$;

-- ---------------------------------------------------------------------------
-- Table constraints (direct writes as the owner, which bypasses create_invoice)
-- ---------------------------------------------------------------------------
create function pg_temp.insert_line_error(p_qty numeric, p_weighed boolean, p_price integer, p_total bigint)
returns text language plpgsql as $$
declare
  v_name text;
begin
  insert into public.invoice_items (invoice_id, line_no, product_id, item_code, name, uom, unit_price, catalog_price,
                                    price_edited, mrp, gst_rate, qty, sold_by_weight, line_total, taxable_value, cgst, sgst)
  values ((select id from public.invoices order by created_at limit 1), 98, pg_temp.pid('soap')::uuid, '7021317', 'x',
          'PCS', p_price, p_price, false, null, 0, p_qty, p_weighed, p_total, p_total, 0, 0);
  raise exception 'inserted' using errcode = 'P0001';
exception
  when check_violation then
    get stacked diagnostics v_name = constraint_name;
    return v_name;
  when raise_exception then
    return null;
end;
$$;

do $$
begin
  perform pg_temp.ok('constraint: normal line 0.5 passes', pg_temp.insert_line_error(0.5, false, 4500, 2250) is null);
  perform pg_temp.ok('constraint: normal line 0.001 passes', pg_temp.insert_line_error(0.001, false, 1000, 1) is null);
  perform pg_temp.ok('constraint: normal line 9999 passes', pg_temp.insert_line_error(9999, false, 1, 9999) is null);
  perform pg_temp.ok('constraint: normal line 10000 refused',
    pg_temp.insert_line_error(10000, false, 1, 10000) = 'invoice_items_qty_pieces');
  perform pg_temp.ok('constraint: normal line 0 refused',
    pg_temp.insert_line_error(0, false, 1, 0) = 'invoice_items_qty_pieces');
  perform pg_temp.ok('constraint: weighed line 1000 kg still refused',
    pg_temp.insert_line_error(1000, true, 1, 1000) = 'invoice_items_qty_weighed');
  perform pg_temp.ok('constraint: line_total = round(price × qty) for fractional pieces too',
    pg_temp.insert_line_error(0.5, false, 3, 1) = 'invoice_items_line_total');
end;
$$;

-- ---------------------------------------------------------------------------
-- Exports, privileges
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ok('export summary: total_qty numeric and has_fractional_qty per invoice',
    (select count(*) filter (where e.has_fractional_qty and e.total_qty = 0.5) >= 1
            and bool_and(e.has_fractional_qty = i.has_fractional_qty and e.total_qty = i.total_qty)
       from public.invoice_export_summary(now() - interval '1 day', now() + interval '1 day') e
       join public.invoices i using (invoice_no)));
  perform pg_temp.ok('export lines: fractional piece qty 0.500, sold_by_weight false',
    (select count(*) >= 1
       from public.invoice_export_lines(now() - interval '1 day', now() + interval '1 day') e
      where not e.sold_by_weight and e.qty = 0.5));
  perform pg_temp.ok('has_fractional_qty matches the stored lines on every invoice',
    (select bool_and(i.has_fractional_qty = exists (
              select 1 from public.invoice_items it
               where it.invoice_id = i.id and not it.sold_by_weight and it.qty <> trunc(it.qty)))
       from public.invoices i));
  perform pg_temp.ok('privileges: API roles cannot execute create_invoice / invoice_json / exports',
    not exists (
      select 1
        from pg_proc p cross join (values ('anon'), ('authenticated')) r(role)
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('create_invoice', 'invoice_json', 'get_invoice', 'invoice_export_summary')
         and has_function_privilege(r.role, p.oid, 'EXECUTE')));
  perform pg_temp.ok('privileges: service_role can execute create_invoice and the summary export, not invoice_json',
    has_function_privilege('service_role', 'public.create_invoice(uuid, uuid, uuid, jsonb, text)', 'EXECUTE')
    and has_function_privilege('service_role',
          'public.invoice_export_summary(timestamptz, timestamptz, uuid, timestamptz, text, integer)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.invoice_json(uuid)', 'EXECUTE'));
  perform pg_temp.ok('index: partial index for the "Fractional qty only" filter',
    exists (select 1 from pg_indexes where indexname = 'invoices_fractional_qty_created_at_idx'));
end;
$$;

do $$
declare
  v_failed text := (select string_agg(name, '; ') from t_fail);
begin
  if v_failed is not null then
    raise exception 'decimal-qty tests failed: %', v_failed;
  end if;
  raise notice 'decimal-qty: all checks passed';
end;
$$;
