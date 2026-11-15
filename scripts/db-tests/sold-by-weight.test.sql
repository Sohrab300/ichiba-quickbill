-- Items sold by weight (REQUIREMENTS.md section 17) — database checks. Run with
-- scripts/test-db-local.sh (throwaway local Postgres). Creates products and invoices, so it refuses
-- to run anywhere else.

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

-- Weighed products (added here; fixtures.sql loads before this migration's column exists) plus
-- the soap from fixtures.sql. Prices in paise per kg.
insert into public.products (id, item_code, name, selling_price, mrp, gst_rate, hsn_code, uom, sold_by_weight) values
  ('00000000-0000-4000-8000-00000000b001', '7900001', 'Test Tomato P/KG',   7000,  null, 0, '0702', 'KG', true),
  ('00000000-0000-4000-8000-00000000b002', '7900002', 'Test Almonds P/KG', 12345, 15000, 5, '0802', 'KG', true),
  ('00000000-0000-4000-8000-00000000b003', '7900003', 'Test Penny P/KG',       3,  null, 0, null,   'KG', true),
  ('00000000-0000-4000-8000-00000000b004', '7900004', 'Test Odd P/KG',       101,  null, 0, null,   'KG', true);

create function pg_temp.pid(p_name text) returns text language sql as $$
  select case p_name
    when 'soap'    then '00000000-0000-4000-8000-00000000a001'   -- 45.00 / piece, MRP 50.00, 18%
    when 'tomato'  then '00000000-0000-4000-8000-00000000b001'   -- 70.00 / kg, no MRP, 0%
    when 'almonds' then '00000000-0000-4000-8000-00000000b002'   -- 123.45 / kg, MRP 150.00, 5%
    when 'penny'   then '00000000-0000-4000-8000-00000000b003'   -- 0.03 / kg, 0%
    when 'odd'     then '00000000-0000-4000-8000-00000000b004'   -- 1.01 / kg, 0%
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

/** SQLSTATE + message of a refused sale, or null if it succeeded. */
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
  perform pg_temp.ok('schema: invoice_items.qty is numeric(10,3)',
    (select format_type(atttypid, atttypmod) = 'numeric(10,3)'
       from pg_attribute where attrelid = 'public.invoice_items'::regclass and attname = 'qty'));
  perform pg_temp.ok('schema: products.sold_by_weight defaults to false (only the 4 test products flagged)',
    (select count(*) filter (where sold_by_weight) = 4 from public.products));
  perform pg_temp.ok('existing lines: not weighed, whole qty, line_total = round(price × qty)',
    (select count(*) >= 3
            and bool_and(not it.sold_by_weight and it.qty = trunc(it.qty) and it.line_total = it.unit_price * it.qty)
       from public.invoice_items it
       join public.invoices i on i.id = it.invoice_id
      where i.idempotency_key in ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-0000000b0002')));
  perform pg_temp.ok('existing invoices: total_qty still their piece count',
    (select bool_and(i.total_qty = (select sum(qty) from public.invoice_items it where it.invoice_id = i.id))
       from public.invoices i));
  perform pg_temp.ok('immutability: all four triggers enabled',
    (select count(*) = 4 from pg_trigger where tgname like '%immutable%' and tgenabled = 'O'));
  begin
    update public.invoice_items set sold_by_weight = true;
    perform pg_temp.ok('immutability: UPDATE invoice_items refused', false);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.ok('immutability: UPDATE invoice_items refused', v_msg like 'Issued invoices are immutable%', v_msg);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refused quantities: nothing is created, no number is used
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
      ('weighed qty 0',                         jsonb_build_array(pg_temp.line('tomato', '0')),            'more than 0'),
      ('weighed qty -0.250',                    jsonb_build_array(pg_temp.line('tomato', '-0.250')),       'more than 0'),
      ('weighed qty 0.0005 (4 decimals)',       jsonb_build_array(pg_temp.line('tomato', '0.0005')),       'at most 3 decimals'),
      ('weighed qty 1.2345',                    jsonb_build_array(pg_temp.line('tomato', '1.2345')),       'at most 3 decimals'),
      ('weighed qty 1000',                      jsonb_build_array(pg_temp.line('tomato', '1000')),         'cannot exceed 999.999 kg'),
      ('weighed qty 999.999 + 0.001 merged',    jsonb_build_array(pg_temp.line('tomato', '999.999'), pg_temp.line('tomato', '0.001')),
                                                                                                           'cannot exceed 999.999 kg'),
      ('weighed qty as a string "0.250"',       jsonb_build_array(pg_temp.line('tomato', '"0.250"')),      'numeric qty'),
      ('weighed qty "NaN"',                     jsonb_build_array(pg_temp.line('tomato', '"NaN"')),        'numeric qty'),
      ('weighed qty null',                      jsonb_build_array(pg_temp.line('tomato', 'null')),         'numeric qty'),
      ('normal item qty 1.5',                   jsonb_build_array(pg_temp.line('soap', '1.5')),            'whole number'),
      ('normal item qty 0.5 + 0.5 (sums to 1)', jsonb_build_array(pg_temp.line('soap', '0.5'), pg_temp.line('soap', '0.5')),
                                                                                                           'whole number'),
      ('normal item qty 1.2345',                jsonb_build_array(pg_temp.line('soap', '1.2345')),         'at most 3 decimals'),
      ('normal item qty 10000',                 jsonb_build_array(pg_temp.line('soap', '10000')),          'cannot exceed 9999'),
      ('one bad weighed line refuses the bill', jsonb_build_array(pg_temp.line('soap', '2'), pg_temp.line('tomato', '0.0001')),
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
-- Weighed sales
-- ---------------------------------------------------------------------------
do $$
declare
  v_inv    jsonb;
  v_again  jsonb;
  v_line   jsonb;
  v_before integer;
begin
  -- 0.250 kg tomato at ₹70.00/kg = ₹17.50 (the README check).
  v_inv := pg_temp.sale(pg_temp.key(1001), jsonb_build_array(pg_temp.line('tomato', '0.250')));
  v_line := v_inv -> 'items' -> 0;
  perform pg_temp.ok('weighed sale: 0.250 kg × ₹70.00 = ₹17.50',
    (v_line ->> 'line_total')::bigint = 1750 and (v_line ->> 'unit_price')::int = 7000, v_line::text);
  perform pg_temp.ok('weighed sale: qty is the 3-decimal number 0.250 and sold_by_weight is true',
    (v_line -> 'qty')::text = '0.250' and (v_line ->> 'sold_by_weight')::boolean, v_line::text);
  perform pg_temp.ok('weighed sale: 1 line, 0 pieces, round-off to ₹18',
    (v_inv ->> 'item_count')::int = 1 and (v_inv ->> 'total_qty')::int = 0
      and (v_inv ->> 'grand_total')::bigint = 1800 and (v_inv ->> 'round_off')::int = 50, v_inv::text);
  perform pg_temp.ok('weighed sale: stored qty 0.250, snapshot sold_by_weight',
    (select qty = 0.250 and sold_by_weight from public.invoice_items
      where invoice_id = (v_inv ->> 'id')::uuid));

  -- Bounds that are allowed.
  v_inv := pg_temp.sale(pg_temp.key(1002), jsonb_build_array(
    pg_temp.line('tomato', '0.001'), pg_temp.line('almonds', '999.999'), pg_temp.line('odd', '1.005')));
  perform pg_temp.ok('weighed bounds: 0.001 kg (₹0.07) and 999.999 kg accepted, 1.005 kg × ₹1.01 = ₹1.02',
    (v_inv -> 'items' -> 0 ->> 'line_total')::bigint = 7
      and (v_inv -> 'items' -> 1 ->> 'line_total')::bigint = 12344988   -- 12345 × 999.999 = 12344987.655
      and (v_inv -> 'items' -> 2 ->> 'line_total')::bigint = 102,       -- 101 × 1.005 = 101.505
    (v_inv -> 'items')::text);
  perform pg_temp.ok('weighed GST: 5% on the rounded line total (12344988 = 11757131 + 293928 + 293929)',
    (v_inv -> 'items' -> 1 ->> 'taxable_value')::bigint = 11757131
      and (v_inv -> 'items' -> 1 ->> 'cgst')::bigint = 293928
      and (v_inv -> 'items' -> 1 ->> 'sgst')::bigint = 293929, (v_inv -> 'items' -> 1)::text);

  -- Half up to the paisa.
  v_inv := pg_temp.sale(pg_temp.key(1003), jsonb_build_array(pg_temp.line('penny', '0.5')));
  perform pg_temp.ok('half up: 0.500 kg × ₹0.03 = 1.5 paise -> 2',
    (v_inv -> 'items' -> 0 ->> 'line_total')::bigint = 2, (v_inv -> 'items')::text);
  v_inv := pg_temp.sale(pg_temp.key(1004), jsonb_build_array(pg_temp.line('penny', '0.166')));
  perform pg_temp.ok('half up: 0.166 kg × ₹0.03 = 0.498 paise -> 0',
    (v_inv -> 'items' -> 0 ->> 'line_total')::bigint = 0, (v_inv -> 'items')::text);
  v_inv := pg_temp.sale(pg_temp.key(1005), jsonb_build_array(pg_temp.line('penny', '0.167')));
  perform pg_temp.ok('half up: 0.167 kg × ₹0.03 = 0.501 paise -> 1',
    (v_inv -> 'items' -> 0 ->> 'line_total')::bigint = 1, (v_inv -> 'items')::text);

  -- Same product twice: qty summed, rounded once (51 + 51 would be 102).
  v_inv := pg_temp.sale(pg_temp.key(1006), jsonb_build_array(pg_temp.line('odd', '0.5'), pg_temp.line('odd', '0.5')));
  perform pg_temp.ok('same weighed product twice: one line, 1.000 kg, rounded once (101)',
    jsonb_array_length(v_inv -> 'items') = 1 and (v_inv -> 'items' -> 0 -> 'qty')::text = '1.000'
      and (v_inv -> 'items' -> 0 ->> 'line_total')::bigint = 101, (v_inv -> 'items')::text);

  -- Mixed cart: pieces count only the normal lines.
  v_inv := pg_temp.sale(pg_temp.key(1007), jsonb_build_array(
    pg_temp.line('soap', '2'), pg_temp.line('tomato', '1.5'), pg_temp.line('soap', '1'), pg_temp.line('almonds', '0.75')));
  perform pg_temp.ok('mixed cart: 3 lines in first-scanned order, soap merged to 3',
    jsonb_array_length(v_inv -> 'items') = 3
      and v_inv -> 'items' -> 0 ->> 'item_code' = '7021317' and (v_inv -> 'items' -> 0 -> 'qty')::text = '3.000'
      and not (v_inv -> 'items' -> 0 ->> 'sold_by_weight')::boolean
      and v_inv -> 'items' -> 1 ->> 'item_code' = '7900001' and (v_inv -> 'items' -> 1 ->> 'sold_by_weight')::boolean,
    (v_inv -> 'items')::text);
  perform pg_temp.ok('mixed cart: amounts (13500 + 10500 + 9259) and 3 pieces',
    (v_inv -> 'items' -> 0 ->> 'line_total')::bigint = 13500
      and (v_inv -> 'items' -> 1 ->> 'line_total')::bigint = 10500
      and (v_inv -> 'items' -> 2 ->> 'line_total')::bigint = 9259      -- 12345 × 0.75 = 9258.75
      and (v_inv ->> 'subtotal')::bigint = 33259 and (v_inv ->> 'grand_total')::bigint = 33300
      and (v_inv ->> 'total_qty')::int = 3, v_inv::text);

  -- Idempotent retry: same key, different items -> the original invoice, no new number.
  v_before := pg_temp.cl1_last_number();
  v_again := pg_temp.sale(pg_temp.key(1007), jsonb_build_array(pg_temp.line('tomato', '9.999')), 'upi');
  perform pg_temp.ok('idempotent retry returns the original weighed invoice unchanged', v_again = v_inv);
  perform pg_temp.ok('idempotent retry used no new number', pg_temp.cl1_last_number() = v_before);
  perform pg_temp.ok('get_invoice returns the same JSON', public.get_invoice((v_inv ->> 'id')::uuid) = v_inv);

  -- Price edit on a weighed item: the edited price is per kg.
  v_inv := pg_temp.sale(pg_temp.key(1008), jsonb_build_array(pg_temp.line('almonds', '0.250', 14000)));
  v_line := v_inv -> 'items' -> 0;
  perform pg_temp.ok('price edit on weighed: 0.250 kg × ₹140.00 = ₹35.00, catalog ₹123.45 kept',
    (v_line ->> 'line_total')::bigint = 3500 and (v_line ->> 'unit_price')::int = 14000
      and (v_line ->> 'catalog_price')::int = 12345 and (v_line ->> 'price_edited')::boolean
      and (v_inv ->> 'has_price_edit')::boolean and (v_line ->> 'sold_by_weight')::boolean, v_line::text);
  perform pg_temp.ok('price edit on weighed: above MRP still refused',
    pg_temp.sale_error(pg_temp.key(1009), jsonb_build_array(pg_temp.line('almonds', '0.250', 15001))) like '22023 Price not allowed%');
  v_inv := pg_temp.sale(pg_temp.key(1010), jsonb_build_array(pg_temp.line('tomato', '0.333', 6000)));
  perform pg_temp.ok('price edit on weighed without MRP: lowered to ₹60.00/kg, 0.333 kg = ₹19.98',
    (v_inv -> 'items' -> 0 ->> 'line_total')::bigint = 1998 and (v_inv -> 'items' -> 0 ->> 'price_edited')::boolean,
    (v_inv -> 'items')::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- The flag is read at sale time and snapshotted
-- ---------------------------------------------------------------------------
do $$
declare
  v_err text;
begin
  update public.products set sold_by_weight = false where id = pg_temp.pid('tomato')::uuid;
  v_err := pg_temp.sale_error(pg_temp.key(1101), jsonb_build_array(pg_temp.line('tomato', '0.250')));
  perform pg_temp.ok('flag cleared: decimal qty refused for that product', v_err like '22023 %whole number%', v_err);
  perform pg_temp.ok('flag cleared: earlier invoice lines keep sold_by_weight = true',
    (select bool_and(sold_by_weight) from public.invoice_items where product_id = pg_temp.pid('tomato')::uuid));
  update public.products set sold_by_weight = true where id = pg_temp.pid('tomato')::uuid;
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
  values ((select id from public.invoices order by created_at limit 1), 99, pg_temp.pid('tomato')::uuid, '7900001', 'x',
          'KG', p_price, p_price, false, null, 0, p_qty, p_weighed, p_total, p_total, 0, 0);
  raise exception 'inserted' using errcode = 'P0001'; -- roll back the row; report "no error"
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
  perform pg_temp.ok('constraint: normal line with qty 1.5 refused',
    pg_temp.insert_line_error(1.5, false, 100, 150) = 'invoice_items_qty_whole');
  perform pg_temp.ok('constraint: weighed line with qty 0 refused',
    pg_temp.insert_line_error(0, true, 100, 0) = 'invoice_items_qty_weighed');
  perform pg_temp.ok('constraint: weighed line above 999.999 kg refused',
    pg_temp.insert_line_error(1000, true, 100, 100000) = 'invoice_items_qty_weighed');
  perform pg_temp.ok('constraint: line_total must be round(price × qty), half up',
    pg_temp.insert_line_error(0.5, true, 3, 1) = 'invoice_items_line_total');
  perform pg_temp.ok('constraint: a correct weighed line passes (3 × 0.5 = 2)',
    pg_temp.insert_line_error(0.5, true, 3, 2) is null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Exports, privileges
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ok('export lines: qty with 3 decimals and sold_by_weight per line',
    (select count(*) filter (where e.sold_by_weight and e.qty::text = '0.250') >= 1
            and bool_and(e.sold_by_weight = it.sold_by_weight and e.qty = it.qty)
       from public.invoice_export_lines(now() - interval '1 day', now() + interval '1 day') e
       join public.invoices i on i.invoice_no = e.invoice_no
       join public.invoice_items it on it.invoice_id = i.id and it.line_no = e.line_no));
  perform pg_temp.ok('export summary: total_qty is pieces',
    (select bool_and(e.total_qty = i.total_qty)
       from public.invoice_export_summary(now() - interval '1 day', now() + interval '1 day') e
       join public.invoices i using (invoice_no)));
  perform pg_temp.ok('privileges: API roles cannot execute create_invoice / exports / invoice_json',
    not exists (
      select 1
        from pg_proc p cross join (values ('anon'), ('authenticated')) r(role)
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('create_invoice', 'invoice_json', 'get_invoice', 'invoice_export_lines')
         and has_function_privilege(r.role, p.oid, 'EXECUTE')));
  perform pg_temp.ok('privileges: service_role can execute create_invoice and the lines export, not invoice_json',
    has_function_privilege('service_role', 'public.create_invoice(uuid, uuid, uuid, jsonb, text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.invoice_export_lines(timestamptz, timestamptz, uuid, timestamptz, text, integer, integer)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.invoice_json(uuid)', 'EXECUTE'));
end;
$$;

do $$
declare
  v_failed text := (select string_agg(name, '; ') from t_fail);
begin
  if v_failed is not null then
    raise exception 'sold-by-weight tests failed: %', v_failed;
  end if;
  raise notice 'sold-by-weight: all checks passed';
end;
$$;
