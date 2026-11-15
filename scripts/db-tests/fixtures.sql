-- Fixtures for scripts/test-db-local.sh (throwaway local Postgres only).
-- Loaded after the migrations older than the price-edit one, so the price-edit migration has
-- real invoices (made by the old create_invoice) to backfill.

do $$
begin
  if current_setting('ichiba.throwaway', true) is distinct from 'yes' then
    raise exception 'Refusing to run: this file writes invoices. Use scripts/test-db-local.sh.';
  end if;
end;
$$;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-0000000000c2');

insert into public.staff_profiles (user_id, display_name, role, counter_id)
select '00000000-0000-4000-8000-0000000000c1', 'Test CL1', 'cashier', id from public.counters where code = 'CL1';
insert into public.staff_profiles (user_id, display_name, role, counter_id)
select '00000000-0000-4000-8000-0000000000c2', 'Test MOB', 'cashier', id from public.counters where code = 'MOB';

-- Prices in paise. "nomrp" has no MRP; "odd" has an awkward price for rounding.
insert into public.products (id, item_code, name, selling_price, mrp, gst_rate, hsn_code, uom) values
  ('00000000-0000-4000-8000-00000000a001', '7021317', 'Test Soap',  4500,  5000, 18, '3401', 'PCS'),
  ('00000000-0000-4000-8000-00000000a002', '7000002', 'Test Oil',  12345, 15000,  5, '1512', 'PCS'),
  ('00000000-0000-4000-8000-00000000a003', '7000003', 'Test NoMRP', 9999,  null, 12, '1905', 'PCS'),
  ('00000000-0000-4000-8000-00000000a004', '7000004', 'Test Odd',    101,   199, 28, '2202', 'PCS'),
  ('00000000-0000-4000-8000-00000000a005', '7000005', 'Test Free',     0,  null,  0, null,   'PCS');

-- Two invoices issued before the price-edit migration.
select public.create_invoice(
  '00000000-0000-4000-8000-0000000b0001', (select id from public.counters where code = 'CL1'),
  '00000000-0000-4000-8000-0000000000c1',
  '[{"product_id": "00000000-0000-4000-8000-00000000a001", "qty": 2},
    {"product_id": "00000000-0000-4000-8000-00000000a002", "qty": 1}]', 'cash');
select public.create_invoice(
  '00000000-0000-4000-8000-0000000b0002', (select id from public.counters where code = 'CL1'),
  '00000000-0000-4000-8000-0000000000c1',
  '[{"product_id": "00000000-0000-4000-8000-00000000a004", "qty": 7}]', 'upi');
