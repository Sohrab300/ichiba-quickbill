-- Fixtures for scripts/test-db-local.sh (throwaway local Postgres only), loaded just before
-- 20261115500000_decimal_qty_all_products.sql: invoices issued by the sold-by-weight version of
-- create_invoice (a weighed line, an edited price, whole pieces), so the decimal-qty migration
-- runs against real rows of every kind it must leave untouched.

do $$
begin
  if current_setting('ichiba.throwaway', true) is distinct from 'yes' then
    raise exception 'Refusing to run: this file writes invoices. Use scripts/test-db-local.sh.';
  end if;
end;
$$;

-- One weighed product (₹80.00/kg). Not one of the four that sold-by-weight.test.sql adds.
insert into public.products (id, item_code, name, selling_price, mrp, gst_rate, hsn_code, uom, sold_by_weight) values
  ('00000000-0000-4000-8000-00000000a006', '7000006', 'Test Fixture Onion P/KG', 8000, null, 0, '0703', 'KG', true);

select public.create_invoice(
  '00000000-0000-4000-8000-0000000b0003', (select id from public.counters where code = 'CL1'),
  '00000000-0000-4000-8000-0000000000c1',
  '[{"product_id": "00000000-0000-4000-8000-00000000a006", "qty": 0.375},
    {"product_id": "00000000-0000-4000-8000-00000000a001", "qty": 3, "unit_price": 4200}]', 'card');

-- The old function refused a fractional piece qty; prove it, so no such row can exist before.
do $$
begin
  perform public.create_invoice(
    gen_random_uuid(), (select id from public.counters where code = 'CL1'),
    '00000000-0000-4000-8000-0000000000c1',
    '[{"product_id": "00000000-0000-4000-8000-00000000a001", "qty": 0.5}]', 'cash');
  raise exception 'fixture: the old create_invoice accepted 0.5 pcs';
exception when sqlstate '22023' then
  null;
end;
$$;
