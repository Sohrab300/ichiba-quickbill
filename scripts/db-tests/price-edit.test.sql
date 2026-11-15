-- Price edit (REQUIREMENTS.md section 16) — database checks. Run with scripts/test-db-local.sh
-- (throwaway local Postgres). Creates invoices, so it refuses to run anywhere else.

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

-- Product ids from fixtures.sql.
create function pg_temp.pid(p_name text) returns text language sql as $$
  select case p_name
    when 'soap'  then '00000000-0000-4000-8000-00000000a001'   -- 45.00, MRP 50.00, 18%
    when 'oil'   then '00000000-0000-4000-8000-00000000a002'   -- 123.45, MRP 150.00, 5%
    when 'nomrp' then '00000000-0000-4000-8000-00000000a003'   -- 99.99, no MRP, 12%
    when 'odd'   then '00000000-0000-4000-8000-00000000a004'   -- 1.01, MRP 1.99, 28%
    when 'free'  then '00000000-0000-4000-8000-00000000a005'   -- 0.00, no MRP, 0%
  end;
$$;

create function pg_temp.key(n integer) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid;
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
-- Migration: backfill and immutability
-- ---------------------------------------------------------------------------
do $$
declare
  v_msg text;
begin
  perform pg_temp.ok('backfill: every pre-existing line has catalog_price = unit_price and is not edited',
    (select count(*) = 3 and bool_and(catalog_price = unit_price and not price_edited) from public.invoice_items));
  perform pg_temp.ok('backfill: pre-existing invoices have has_price_edit = false',
    (select count(*) = 2 and not bool_or(has_price_edit) from public.invoices));

  begin
    update public.invoice_items set unit_price = unit_price;
    perform pg_temp.ok('immutability: UPDATE invoice_items refused', false);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.ok('immutability: UPDATE invoice_items refused', v_msg like 'Issued invoices are immutable%', v_msg);
  end;
  begin
    update public.invoices set has_price_edit = true;
    perform pg_temp.ok('immutability: UPDATE invoices refused', false);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.ok('immutability: UPDATE invoices refused', v_msg like 'Issued invoices are immutable%', v_msg);
  end;
  begin
    delete from public.invoice_items;
    perform pg_temp.ok('immutability: DELETE invoice_items refused', false);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.ok('immutability: DELETE invoice_items refused', v_msg like 'Issued invoices are immutable%', v_msg);
  end;
  perform pg_temp.ok('immutability: all four triggers enabled',
    (select count(*) = 4 from pg_trigger where tgname like '%immutable%' and tgenabled = 'O'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Refused prices: nothing is created, no number is used
-- ---------------------------------------------------------------------------
do $$
declare
  v_before_n  integer := pg_temp.cl1_last_number();
  v_before_i  bigint  := (select count(*) from public.invoices);
  v_err       text;
begin
  v_err := pg_temp.sale_error(pg_temp.key(101), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', 5001)));
  perform pg_temp.ok('price above MRP refused (22023, names the MRP)', v_err like '22023 %above the MRP ₹50.00%', v_err);

  v_err := pg_temp.sale_error(pg_temp.key(102), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', 0)));
  perform pg_temp.ok('price 0 refused', v_err like '22023 %more than ₹0%', v_err);

  v_err := pg_temp.sale_error(pg_temp.key(103), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', -100)));
  perform pg_temp.ok('negative price refused', v_err like '22023 %more than ₹0%', v_err);

  v_err := pg_temp.sale_error(pg_temp.key(104), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', 4000.5)));
  perform pg_temp.ok('fractional paise refused', v_err like '22023 %whole number of paise%', v_err);

  v_err := pg_temp.sale_error(pg_temp.key(105), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', '4000')));
  perform pg_temp.ok('price as a string refused', v_err like '22023 %whole number of paise%', v_err);

  v_err := pg_temp.sale_error(pg_temp.key(106), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', 1e30)));
  perform pg_temp.ok('huge price refused cleanly (no overflow error)', v_err like '22023 %above the MRP%', v_err);

  v_err := pg_temp.sale_error(pg_temp.key(107), jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', 4000),
    jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', 4100)));
  perform pg_temp.ok('same product with two different prices refused', v_err like '22023 %two prices%7021317%', v_err);

  v_err := pg_temp.sale_error(pg_temp.key(108), jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', 4000),
    jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1)));
  perform pg_temp.ok('same product edited once and at catalog price once refused', v_err like '22023 %two prices%', v_err);

  v_err := pg_temp.sale_error(pg_temp.key(109), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('nomrp'), 'qty', 1, 'unit_price', 10000)));
  perform pg_temp.ok('no MRP: price above the catalog price refused', v_err like '22023 %no MRP%₹99.99%', v_err);

  v_err := pg_temp.sale_error(pg_temp.key(110), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('free'), 'qty', 1, 'unit_price', 100)));
  perform pg_temp.ok('no MRP, catalog 0: any edit refused', v_err like '22023 %no MRP%', v_err);

  v_err := pg_temp.sale_error(pg_temp.key(111), jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.pid('oil'), 'qty', 1, 'unit_price', 12000),
    jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', 6000)));
  perform pg_temp.ok('one bad line refuses the whole bill', v_err like '22023 %7021317%', v_err);

  perform pg_temp.ok('refused sales created no invoice', (select count(*) from public.invoices) = v_before_i);
  perform pg_temp.ok('refused sales used no invoice number', pg_temp.cl1_last_number() = v_before_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Accepted edits
-- ---------------------------------------------------------------------------
do $$
declare
  v_catalog_before jsonb := (select jsonb_agg(to_jsonb(p) order by p.id) from public.products p);
  v_inv     jsonb;
  v_retry   jsonb;
  v_line    jsonb;
  v_n       integer;
begin
  -- Soap 45.00 → 40.00 × 3 (18%): line 120.00; taxable = round(12000 × 100 / 118) = 10169;
  -- GST 1831 → CGST 915, SGST 916. Oil at catalog 123.45 × 1 (5%): taxable round(1234500/105) =
  -- 11757; GST 588 → 294 + 294. Subtotal 24345 → grand 24300, round off −45.
  v_inv := pg_temp.sale(pg_temp.key(201), jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 3, 'unit_price', 4000),
    jsonb_build_object('product_id', pg_temp.pid('oil'), 'qty', 1)));
  v_line := v_inv -> 'items' -> 0;
  perform pg_temp.ok('edit: charged price is the edited one, catalog price kept',
    (v_line ->> 'unit_price')::int = 4000 and (v_line ->> 'catalog_price')::int = 4500 and (v_line ->> 'price_edited')::boolean,
    v_line::text);
  perform pg_temp.ok('edit: GST on the edited price (line 12000 = 10169 + 915 + 916)',
    (v_line ->> 'line_total')::int = 12000 and (v_line ->> 'taxable_value')::int = 10169
      and (v_line ->> 'cgst')::int = 915 and (v_line ->> 'sgst')::int = 916, v_line::text);
  v_line := v_inv -> 'items' -> 1;
  perform pg_temp.ok('edit: unedited line on the same bill stays at catalog, not flagged',
    (v_line ->> 'unit_price')::int = 12345 and (v_line ->> 'catalog_price')::int = 12345 and not (v_line ->> 'price_edited')::boolean,
    v_line::text);
  perform pg_temp.ok('edit: invoice totals and round-off on the charged prices',
    (v_inv ->> 'subtotal')::int = 24345 and (v_inv ->> 'taxable_total')::int = 21926
      and (v_inv ->> 'grand_total')::int = 24300 and (v_inv ->> 'round_off')::int = -45, v_inv::text);
  perform pg_temp.ok('edit: has_price_edit set', (v_inv ->> 'has_price_edit')::boolean);

  -- Idempotent retry: same key, different items and prices → the original invoice, unchanged.
  v_n := pg_temp.cl1_last_number();
  v_retry := pg_temp.sale(pg_temp.key(201), jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 9, 'unit_price', 100)), 'upi');
  perform pg_temp.ok('edit + idempotent retry returns the same invoice unchanged', v_retry = v_inv);
  perform pg_temp.ok('idempotent retry used no new number', pg_temp.cl1_last_number() = v_n);
  perform pg_temp.ok('get_invoice returns the same JSON', public.get_invoice((v_inv ->> 'id')::uuid) = v_inv);

  -- Catalog untouched (every column of every product, incl. updated_at).
  perform pg_temp.ok('products unchanged after sales with edits',
    (select jsonb_agg(to_jsonb(p) order by p.id) from public.products p) = v_catalog_before);
  perform pg_temp.ok('products.selling_price of 7021317 still 4500',
    (select selling_price from public.products where item_code = '7021317') = 4500);

  -- unit_price equal to the catalog price is not an edit.
  v_inv := pg_temp.sale(pg_temp.key(202), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', 4500)));
  perform pg_temp.ok('unit_price = catalog price is not an edit',
    not (v_inv ->> 'has_price_edit')::boolean and not (v_inv -> 'items' -> 0 ->> 'price_edited')::boolean);

  -- JSON null = no edit.
  v_inv := pg_temp.sale(pg_temp.key(203), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', null)));
  perform pg_temp.ok('unit_price null charges the catalog price',
    (v_inv -> 'items' -> 0 ->> 'unit_price')::int = 4500 and not (v_inv ->> 'has_price_edit')::boolean);

  -- Exactly MRP is allowed (a price increase up to MRP).
  v_inv := pg_temp.sale(pg_temp.key(204), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', 5000)));
  perform pg_temp.ok('price = MRP allowed', (v_inv -> 'items' -> 0 ->> 'unit_price')::int = 5000 and (v_inv ->> 'has_price_edit')::boolean);

  -- 1 paisa is allowed (no maximum discount).
  v_inv := pg_temp.sale(pg_temp.key(205), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('oil'), 'qty', 2, 'unit_price', 1)));
  perform pg_temp.ok('price 0.01 allowed (no maximum discount)', (v_inv -> 'items' -> 0 ->> 'line_total')::int = 2);

  -- Same product twice with the same edited price merges into one edited line.
  v_inv := pg_temp.sale(pg_temp.key(206), jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.pid('odd'), 'qty', 2, 'unit_price', 150),
    jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1),
    jsonb_build_object('product_id', pg_temp.pid('odd'), 'qty', 3, 'unit_price', 150)));
  perform pg_temp.ok('same product, same price twice: merged (qty 5) and edited',
    jsonb_array_length(v_inv -> 'items') = 2 and (v_inv -> 'items' -> 0 ->> 'qty')::int = 5
      and (v_inv -> 'items' -> 0 ->> 'unit_price')::int = 150, (v_inv -> 'items')::text);

  -- Same product with the catalog price given explicitly once and omitted once: fine.
  v_inv := pg_temp.sale(pg_temp.key(207), jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1, 'unit_price', 4500),
    jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 1)));
  perform pg_temp.ok('catalog price given once and omitted once: merged, not edited',
    (v_inv -> 'items' -> 0 ->> 'qty')::int = 2 and not (v_inv ->> 'has_price_edit')::boolean);

  -- No MRP: lowering is allowed.
  v_inv := pg_temp.sale(pg_temp.key(208), jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('nomrp'), 'qty', 1, 'unit_price', 9000)));
  perform pg_temp.ok('no MRP: lower price allowed', (v_inv -> 'items' -> 0 ->> 'unit_price')::int = 9000);

  -- A spread of edited prices for check-preview.ts (rounding at every GST rate).
  perform pg_temp.sale(pg_temp.key(209), jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.pid('soap'), 'qty', 7, 'unit_price', 4333),
    jsonb_build_object('product_id', pg_temp.pid('oil'), 'qty', 13, 'unit_price', 14999),
    jsonb_build_object('product_id', pg_temp.pid('nomrp'), 'qty', 9999, 'unit_price', 1),
    jsonb_build_object('product_id', pg_temp.pid('odd'), 'qty', 11, 'unit_price', 199)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Table constraints (direct writes as the owner, which bypasses create_invoice)
-- ---------------------------------------------------------------------------
do $$
declare
  v_inv uuid := (select id from public.invoices order by created_at limit 1);
  v_msg text;
begin
  begin
    insert into public.invoice_items (invoice_id, line_no, product_id, item_code, name, uom, unit_price, catalog_price,
                                      price_edited, mrp, gst_rate, qty, line_total, taxable_value, cgst, sgst)
    values (v_inv, 99, pg_temp.pid('soap')::uuid, '7021317', 'x', 'PCS', 4000, 4500, false, 5000, 0, 1, 4000, 4000, 0, 0);
    perform pg_temp.ok('constraint: price_edited must match the prices', false);
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    perform pg_temp.ok('constraint: price_edited must match the prices', v_msg = 'invoice_items_price_edited_flag', v_msg);
  end;
  begin
    insert into public.invoice_items (invoice_id, line_no, product_id, item_code, name, uom, unit_price, catalog_price,
                                      price_edited, mrp, gst_rate, qty, line_total, taxable_value, cgst, sgst)
    values (v_inv, 99, pg_temp.pid('soap')::uuid, '7021317', 'x', 'PCS', 6000, 4500, true, 5000, 0, 1, 6000, 6000, 0, 0);
    perform pg_temp.ok('constraint: edited price cannot exceed MRP', false);
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    perform pg_temp.ok('constraint: edited price cannot exceed MRP', v_msg = 'invoice_items_edited_price_range', v_msg);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Day totals, exports, privileges
-- ---------------------------------------------------------------------------
do $$
declare
  v_edited bigint;
  v_all    bigint;
begin
  select sum(edited_count), sum(invoice_count) into v_edited, v_all
    from public.invoice_day_totals(now() - interval '1 day', now() + interval '1 day');
  perform pg_temp.ok('invoice_day_totals: edited_count counts bills with an edit',
    v_edited = (select count(*) from public.invoices where has_price_edit) and v_edited > 0 and v_all > v_edited,
    format('edited %s of %s', v_edited, v_all));

  perform pg_temp.ok('export summary: has_price_edit per invoice',
    (select bool_and(e.has_price_edit = i.has_price_edit)
       from public.invoice_export_summary(now() - interval '1 day', now() + interval '1 day') e
       join public.invoices i using (invoice_no)));
  perform pg_temp.ok('export lines: catalog_price and price_edited per line',
    (select count(*) filter (where e.price_edited and e.catalog_price = 4500 and e.unit_price = 4000) >= 1
            and bool_and(e.price_edited = (e.unit_price <> e.catalog_price))
       from public.invoice_export_lines(now() - interval '1 day', now() + interval '1 day') e));

  perform pg_temp.ok('privileges: API roles cannot execute the new/replaced functions',
    not exists (
      select 1
        from pg_proc p cross join (values ('anon'), ('authenticated')) r(role)
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('create_invoice', 'invoice_json', 'get_invoice', 'invoice_day_totals',
                           'invoice_export_summary', 'invoice_export_lines')
         and has_function_privilege(r.role, p.oid, 'EXECUTE')));
  perform pg_temp.ok('privileges: service_role can execute create_invoice and the exports, not invoice_json',
    has_function_privilege('service_role', 'public.create_invoice(uuid, uuid, uuid, jsonb, text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.invoice_day_totals(timestamptz, timestamptz, uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.invoice_export_lines(timestamptz, timestamptz, uuid, timestamptz, text, integer, integer)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.invoice_json(uuid)', 'EXECUTE'));
  perform pg_temp.ok('privileges: service_role cannot write invoice tables',
    not has_table_privilege('service_role', 'public.invoice_items', 'INSERT, UPDATE, DELETE')
    and not has_table_privilege('service_role', 'public.invoices', 'INSERT, UPDATE, DELETE'));
end;
$$;

do $$
declare
  v_failed text := (select string_agg(name, '; ') from t_fail);
begin
  if v_failed is not null then
    raise exception 'price-edit tests failed: %', v_failed;
  end if;
  raise notice 'price-edit: all checks passed';
end;
$$;
