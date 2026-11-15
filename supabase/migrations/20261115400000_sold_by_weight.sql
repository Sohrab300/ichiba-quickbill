-- Migration: items sold by weight (REQUIREMENTS.md section 17)
--
-- * products.sold_by_weight: loose fruit & vegetables priced per kg. Set once from a reviewed list
--   (scripts/flag-weighed-items.ts), then by an admin for new products.
-- * invoice_items.qty: integer -> numeric(10,3) (kg with up to 3 decimals for weighed lines).
--   invoice_items.sold_by_weight snapshots the flag at the time of sale.
--   line_total = round(unit_price × qty), half up, to the paisa. Weighed lines: 0.001..999.999;
--   other lines: whole numbers 1..9999 (as before).
-- * invoices.total_qty now means pieces: the summed qty of lines NOT sold by weight (kg are never
--   added to pieces), so a bill of only weighed lines has total_qty 0. Every existing invoice has
--   only whole-number lines, so its total_qty already is its piece count.
-- * create_invoice(): qty may be a JSON number with up to 3 decimals, but only for a product that
--   is sold by weight; everything else must be a whole number. A repeated product is merged
--   (qty summed, one price) before rounding. Idempotency and price edit are unchanged.
-- * invoice_json() / get_invoice(): qty as a 3-decimal number and sold_by_weight per line.
--   invoice_export_lines(): the same two fields. invoice_export_summary() / invoice_day_totals()
--   are unchanged (they carry no line quantities; total_qty is pieces).
--
-- No existing invoice row is updated: adding columns with a constant default does not touch rows,
-- and changing a column type rewrites the table without firing row triggers. The immutability
-- triggers are never disabled; the end of this file asserts that all four are still enabled.
--
-- Apply before deploying the app code that sends decimal quantities. The old app keeps working on
-- the new schema (it only sends whole numbers and reads qty as a number).

-- ---------------------------------------------------------------------------
-- 1. products.sold_by_weight
-- ---------------------------------------------------------------------------
alter table public.products
  add column sold_by_weight boolean not null default false;

comment on column public.products.sold_by_weight is
  'Loose fruit/vegetables priced per kg: qty on a bill is kg with up to 3 decimals (0.001-999.999).';

-- ---------------------------------------------------------------------------
-- 2. invoice_items: decimal qty, weighed flag, rounding rule
-- ---------------------------------------------------------------------------
alter table public.invoice_items
  drop constraint invoice_items_line_total,
  drop constraint invoice_items_qty_range;

alter table public.invoice_items
  alter column qty type numeric(10, 3),
  add column sold_by_weight boolean not null default false;

-- Re-validated against every existing line (all whole-number qty, line_total = price × qty).
alter table public.invoice_items
  -- round(numeric) rounds ties away from zero, i.e. half up for these non-negative amounts.
  add constraint invoice_items_line_total check (line_total = round(unit_price::numeric * qty)),
  add constraint invoice_items_qty_weighed
    check (not sold_by_weight or (qty >= 0.001 and qty <= 999.999 and qty = round(qty, 3))),
  add constraint invoice_items_qty_whole
    check (sold_by_weight or (qty = trunc(qty) and qty >= 1 and qty <= 9999));

comment on column public.invoice_items.qty is
  'Quantity: kg with up to 3 decimals when sold_by_weight, otherwise a whole number of pieces.';
comment on column public.invoice_items.sold_by_weight is
  'products.sold_by_weight when the invoice was issued.';

alter table public.invoices
  drop constraint invoices_total_qty_pos,
  add constraint invoices_total_qty_nonneg check (total_qty >= 0);

comment on column public.invoices.total_qty is
  'Pieces: summed qty of the lines not sold by weight (kg are not counted). 0 if every line is weighed.';

-- The four immutability triggers must still be enabled (nothing above disables them).
do $$
begin
  if (
    select count(*)
      from pg_trigger t
     where t.tgrelid in ('public.invoices'::regclass, 'public.invoice_items'::regclass)
       and t.tgname in ('invoices_immutable_row', 'invoices_immutable_truncate',
                        'invoice_items_immutable_row', 'invoice_items_immutable_truncate')
       and t.tgenabled = 'O'
  ) <> 4 then
    raise exception 'Invoice immutability triggers are not all enabled.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. invoice_json()
-- ---------------------------------------------------------------------------
create or replace function public.invoice_json(p_invoice_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id',              i.id,
    'invoice_no',      i.invoice_no,
    'counter_id',      i.counter_id,
    'counter_code',    i.counter_code,
    'fy',              i.fy,
    'seq_number',      i.seq_number,
    'idempotency_key', i.idempotency_key,
    'cashier_user_id', i.cashier_user_id,
    'cashier_name',    i.cashier_name,
    'payment_method',  i.payment_method,
    'item_count',      i.item_count,
    'total_qty',       i.total_qty,
    'subtotal',        i.subtotal,
    'taxable_total',   i.taxable_total,
    'cgst_total',      i.cgst_total,
    'sgst_total',      i.sgst_total,
    'round_off',       i.round_off,
    'grand_total',     i.grand_total,
    'has_price_edit',  i.has_price_edit,
    'created_at',      i.created_at,
    'store', jsonb_build_object(
      'legal_name', i.store_legal_name,
      'address',    i.store_address,
      'phone',      i.store_phone,
      'gstin',      i.store_gstin,
      'state_code', i.store_state_code,
      'state_name', i.store_state_name,
      'footer',     i.invoice_footer
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'line_no',        it.line_no,
               'product_id',     it.product_id,
               'item_code',      it.item_code,
               'name',           it.name,
               'hsn_code',       it.hsn_code,
               'uom',            it.uom,
               'unit_price',     it.unit_price,
               'catalog_price',  it.catalog_price,
               'price_edited',   it.price_edited,
               'mrp',            it.mrp,
               'gst_rate',       it.gst_rate,
               'qty',            it.qty,            -- numeric(10,3): 0.250, 2.000
               'sold_by_weight', it.sold_by_weight,
               'line_total',     it.line_total,
               'taxable_value',  it.taxable_value,
               'cgst',           it.cgst,
               'sgst',           it.sgst
             ) order by it.line_no), '[]'::jsonb)
      from public.invoice_items it
      where it.invoice_id = i.id
    ),
    -- HSN / rate-wise tax summary (REQUIREMENTS.md section 3), derived from the stored lines.
    'tax_summary', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'hsn_code',      s.hsn_code,
               'gst_rate',      s.gst_rate,
               'taxable_value', s.taxable_value,
               'cgst',          s.cgst,
               'sgst',          s.sgst,
               'total',         s.total
             ) order by s.gst_rate, s.hsn_code nulls last), '[]'::jsonb)
      from (
        select it.hsn_code, it.gst_rate,
               sum(it.taxable_value) as taxable_value,
               sum(it.cgst)          as cgst,
               sum(it.sgst)          as sgst,
               sum(it.line_total)    as total
        from public.invoice_items it
        where it.invoice_id = i.id
        group by it.hsn_code, it.gst_rate
      ) s
    )
  )
  from public.invoices i
  where i.id = p_invoice_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. create_invoice()
-- ---------------------------------------------------------------------------
-- Same signature and behaviour as 20261115300000_price_edit.sql, plus decimal qty for products
-- sold by weight. Errors meant for the cashier use SQLSTATE 22023 / 42501 as before. Every check
-- runs before the invoice number is assigned, so a refused sale never uses a number.
create or replace function public.create_invoice(
  p_idempotency_key uuid,
  p_counter_id      uuid,
  p_cashier_user_id uuid,
  p_items           jsonb,
  p_payment_method  text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '10s'
as $$
declare
  c_max_lines   constant integer := 500;
  c_max_qty     constant integer := 9999;
  c_max_weight  constant numeric := 999.999;
  c_max_seq     constant integer := 999999;
  v_staff       record;
  v_counter     record;
  v_store       record;
  v_existing_id uuid;
  v_existing_counter uuid;
  v_product_ids uuid[];
  v_qtys        numeric[];
  v_fractions   boolean[];
  v_req_prices  numeric[];
  v_multi       boolean[];
  v_mixed       boolean[];
  v_lines       jsonb;
  v_problem     text;
  v_item_count  integer;
  v_total_qty   integer;
  v_subtotal    bigint;
  v_taxable     bigint;
  v_cgst        bigint;
  v_sgst        bigint;
  v_has_edit    boolean;
  v_grand_total bigint;
  v_round_off   integer;
  v_seq         integer;
  v_invoice_no  text;
  v_invoice_id  uuid;
  v_constraint  text;
begin
  -- a) Arguments that do not depend on the database.
  if p_idempotency_key is null or p_counter_id is null or p_cashier_user_id is null then
    raise exception 'Sale key, counter and cashier are required.' using errcode = '22023';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'upi', 'card') then
    raise exception 'Payment method must be cash, upi or card.' using errcode = '22023';
  end if;

  -- b) The cashier must be an active staff login that bills on this (active) counter.
  select s.display_name, s.is_active, s.counter_id
    into v_staff
    from public.staff_profiles s
   where s.user_id = p_cashier_user_id;
  if not found or not v_staff.is_active then
    raise exception 'This login is not an active staff member.' using errcode = '42501';
  end if;
  if v_staff.counter_id is distinct from p_counter_id then
    raise exception 'This login does not bill on this counter.' using errcode = '42501';
  end if;

  select c.code, c.invoice_prefix, c.is_active
    into v_counter
    from public.counters c
   where c.id = p_counter_id;
  if not found or not v_counter.is_active then
    raise exception 'This counter is disabled.' using errcode = '42501';
  end if;

  -- c) Idempotency (unchanged): serialize requests with the same key; a repeated key returns the
  --    original invoice unchanged, whatever items, prices or payment method the retry carries.
  perform pg_advisory_xact_lock(hashtextextended('ichiba.create_invoice:' || p_idempotency_key::text, 0));

  select i.id, i.counter_id
    into v_existing_id, v_existing_counter
    from public.invoices i
   where i.idempotency_key = p_idempotency_key;
  if found then
    if v_existing_counter <> p_counter_id then
      raise exception 'This sale key was already used on another counter.' using errcode = '22023';
    end if;
    return public.invoice_json(v_existing_id);
  end if;

  -- d) Validate the items.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The cart is empty.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > c_max_lines then
    raise exception 'Too many lines on one bill (max %).', c_max_lines using errcode = '22023';
  end if;
  -- qty must be a JSON number (a string such as "0.250" is refused; JSON has no NaN/Infinity).
  if exists (
    select 1
      from jsonb_array_elements(p_items) e
     where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e -> 'product_id') is distinct from 'string'
        or (e ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(e -> 'qty') is distinct from 'number'
  ) then
    raise exception 'Every item needs a product_id (UUID) and a numeric qty.' using errcode = '22023';
  end if;
  -- The exact JSON value (jsonb keeps numbers as numeric), checked before any rounding or cast.
  if exists (
    select 1 from jsonb_array_elements(p_items) e
     where (e -> 'qty')::numeric <= 0
  ) then
    raise exception 'Quantity must be more than 0.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
     where (e -> 'qty')::numeric > c_max_qty
  ) then
    raise exception 'Quantity cannot exceed %.', c_max_qty using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
     where (e -> 'qty')::numeric <> round((e -> 'qty')::numeric, 3)
  ) then
    raise exception 'Quantity can have at most 3 decimals (0.001 kg = 1 g).' using errcode = '22023';
  end if;
  -- unit_price is optional (absent or JSON null = charge the catalog price). When given it must be
  -- a whole number of paise; its range is checked against the product below.
  if exists (
    select 1
      from jsonb_array_elements(p_items) e
     where coalesce(jsonb_typeof(e -> 'unit_price'), 'null') not in ('number', 'null')
        or (jsonb_typeof(e -> 'unit_price') = 'number'
            and (e -> 'unit_price')::numeric <> trunc((e -> 'unit_price')::numeric))
  ) then
    raise exception 'A changed price must be a whole number of paise.' using errcode = '22023';
  end if;

  -- Merge duplicate product ids (summing qty, so the line is rounded once), keeping the order of
  -- first appearance; fraction = some element of the product had a non-whole qty (allowed only
  -- if it is sold by weight, checked against the product below). Requested prices as before:
  -- multi = two different explicit prices; mixed = some elements with a price and some without.
  select array_agg(m.product_id order by m.first_ord),
         array_agg(m.qty        order by m.first_ord),
         array_agg(m.fraction   order by m.first_ord),
         array_agg(m.req_price  order by m.first_ord),
         array_agg(m.multi      order by m.first_ord),
         array_agg(m.mixed      order by m.first_ord)
    into v_product_ids, v_qtys, v_fractions, v_req_prices, v_multi, v_mixed
    from (
      select r.product_id,
             sum(r.qty)                                          as qty,
             bool_or(r.qty <> trunc(r.qty))                      as fraction,
             min(r.ord)                                          as first_ord,
             max(r.req_price)                                    as req_price,
             count(distinct r.req_price) > 1                     as multi,
             bool_or(r.req_price is null) and bool_or(r.req_price is not null) as mixed
        from (
          select (e ->> 'product_id')::uuid as product_id,
                 (e -> 'qty')::numeric      as qty,
                 t.ord,
                 case when jsonb_typeof(e -> 'unit_price') = 'number' then (e -> 'unit_price')::numeric end as req_price
            from jsonb_array_elements(p_items) with ordinality as t(e, ord)
        ) r
       group by r.product_id
    ) m;

  if exists (select 1 from unnest(v_qtys) q where q > c_max_qty) then
    raise exception 'Quantity of one product must not exceed % on one bill.', c_max_qty using errcode = '22023';
  end if;

  -- e) Price every line and compute GST (REQUIREMENTS.md sections 3, 16 and 17), in a single
  --    statement so all lines (and the sold_by_weight checks below) see the same snapshot:
  --      catalog    = products.selling_price (always read here, never from the browser)
  --      charged    = the requested unit_price if it differs from catalog and 0 < it <= cap,
  --                   cap = coalesce(mrp, catalog); otherwise catalog (a refused request is
  --                   reported below, never billed)
  --      line_total = round(charged × qty), half up to the paisa       (GST-inclusive)
  --      taxable    = round_half_up(line_total × 100 / (100 + rate)) = (2·line_total·100 + d) div 2d
  --      gst        = line_total − taxable;  CGST = floor(gst / 2);  SGST = gst − CGST
  --    Mirrored for the on-screen preview by src/lib/gst.ts (keep the two in sync).
  select jsonb_agg(to_jsonb(l) order by l.line_no)
    into v_lines
    from (
      select x.ord::integer                         as line_no,
             x.product_id                           as product_id,
             p.id is not null                       as found,
             coalesce(p.is_active, false)           as is_active,
             coalesce(p.sold_by_weight, false)      as sold_by_weight,
             x.fraction,
             p.item_code, p.name, p.hsn_code, p.uom,
             p.selling_price                        as catalog_price,
             ch.unit_price,
             ok.edit_ok                             as price_edited,
             w.wants_edit,
             x.req_price,
             cap.max_price,
             (x.multi or (x.mixed and w.wants_edit)) as price_conflict,
             p.mrp, p.gst_rate,
             x.qty                                  as qty,
             lt.line_total,
             tx.taxable_value,
             (lt.line_total - tx.taxable_value) / 2 as cgst,
             (lt.line_total - tx.taxable_value) - (lt.line_total - tx.taxable_value) / 2 as sgst
        from unnest(v_product_ids, v_qtys, v_fractions, v_req_prices, v_multi, v_mixed)
               with ordinality as x(product_id, qty, fraction, req_price, multi, mixed, ord)
        left join public.products p on p.id = x.product_id
        cross join lateral (select coalesce(p.mrp, p.selling_price) as max_price) cap
        cross join lateral (
          select coalesce(x.req_price is not null and x.req_price <> p.selling_price, false) as wants_edit
        ) w
        cross join lateral (
          select w.wants_edit and x.req_price >= 1 and x.req_price <= cap.max_price as edit_ok
        ) ok
        cross join lateral (
          select case when ok.edit_ok then x.req_price::integer else p.selling_price end as unit_price
        ) ch
        cross join lateral (select round(ch.unit_price::numeric * x.qty)::bigint as line_total) lt
        cross join lateral (
          select (lt.line_total * 200 + (100 + p.gst_rate)) / (2 * (100 + p.gst_rate)) as taxable_value
        ) tx
    ) l;

  select string_agg(l ->> 'product_id', ', ')
    into v_problem
    from jsonb_array_elements(v_lines) l
   where not (l ->> 'found')::boolean;
  if v_problem is not null then
    raise exception 'Product not found: %.', v_problem using errcode = '22023';
  end if;

  select string_agg((l ->> 'item_code') || ' ' || (l ->> 'name'), ', ')
    into v_problem
    from jsonb_array_elements(v_lines) l
   where not (l ->> 'is_active')::boolean;
  if v_problem is not null then
    raise exception 'Inactive product cannot be sold: %.', v_problem using errcode = '22023';
  end if;

  select string_agg((l ->> 'item_code') || ' ' || (l ->> 'name'), ', ')
    into v_problem
    from jsonb_array_elements(v_lines) l
   where (l ->> 'fraction')::boolean and not (l ->> 'sold_by_weight')::boolean;
  if v_problem is not null then
    raise exception 'Quantity must be a whole number (not sold by weight): %.', v_problem using errcode = '22023';
  end if;

  select string_agg((l ->> 'item_code') || ' ' || (l ->> 'name'), ', ')
    into v_problem
    from jsonb_array_elements(v_lines) l
   where (l ->> 'sold_by_weight')::boolean and (l ->> 'qty')::numeric > c_max_weight;
  if v_problem is not null then
    raise exception 'Weight cannot exceed % kg for one product on one bill: %.', c_max_weight, v_problem
      using errcode = '22023';
  end if;

  select string_agg((l ->> 'item_code') || ' ' || (l ->> 'name'), ', ')
    into v_problem
    from jsonb_array_elements(v_lines) l
   where (l ->> 'price_conflict')::boolean;
  if v_problem is not null then
    raise exception 'The same product cannot have two prices on one bill: %.', v_problem using errcode = '22023';
  end if;

  select string_agg(
           (l ->> 'item_code') || ' ' || (l ->> 'name') || ': ' ||
           case
             when (l ->> 'req_price')::numeric < 1 then 'the price must be more than ₹0'
             when l -> 'mrp' = 'null'::jsonb then
               'it has no MRP, so the price can only be lowered (at most ₹' ||
               to_char((l ->> 'max_price')::numeric / 100, 'FM999999990.00') || ')'
             else
               'the price cannot be above the MRP ₹' || to_char((l ->> 'max_price')::numeric / 100, 'FM999999990.00')
           end,
           '; ')
    into v_problem
    from jsonb_array_elements(v_lines) l
   where (l ->> 'wants_edit')::boolean and not (l ->> 'price_edited')::boolean;
  if v_problem is not null then
    raise exception 'Price not allowed — %.', v_problem using errcode = '22023';
  end if;

  -- total_qty = pieces: weighed lines count as lines, their kg are not added.
  select count(*),
         coalesce(sum(l.qty) filter (where not l.sold_by_weight), 0)::integer,
         sum(l.line_total), sum(l.taxable_value), sum(l.cgst), sum(l.sgst), bool_or(l.price_edited)
    into v_item_count, v_total_qty, v_subtotal, v_taxable, v_cgst, v_sgst, v_has_edit
    from jsonb_to_recordset(v_lines)
      as l(qty numeric, sold_by_weight boolean, line_total bigint, taxable_value bigint, cgst bigint, sgst bigint,
           price_edited boolean);

  -- Grand total rounded to the nearest rupee, 50 paise rounding up.
  v_grand_total := ((v_subtotal + 50) / 100) * 100;
  v_round_off   := v_grand_total - v_subtotal;

  -- f) Store header + FY (one row).
  select s.legal_name, s.address, s.phone, s.gstin, s.state_code, s.state_name, s.fy_label, s.invoice_footer
    into v_store
    from public.store_settings s
   where s.id;
  if not found then
    raise exception 'Store settings are missing.';
  end if;

  begin
    -- g) The number. Done last so the per-counter row lock is held only for the inserts below.
    insert into public.invoice_sequences as s (counter_id, fy, last_number)
    values (p_counter_id, v_store.fy_label, 1)
    on conflict (counter_id, fy)
      do update set last_number = s.last_number + 1, updated_at = now()
    returning s.last_number into v_seq;

    if v_seq > c_max_seq then
      raise exception 'Counter % has used all invoice numbers for FY %.', v_counter.code, v_store.fy_label;
    end if;

    v_invoice_no := v_counter.invoice_prefix || '/' || v_store.fy_label || '/' || lpad(v_seq::text, 6, '0');

    insert into public.invoices (
      invoice_no, counter_id, counter_code, fy, seq_number, idempotency_key,
      cashier_user_id, cashier_name, payment_method, item_count, total_qty,
      subtotal, taxable_total, cgst_total, sgst_total, round_off, grand_total, has_price_edit,
      store_legal_name, store_address, store_phone, store_gstin, store_state_code, store_state_name,
      invoice_footer
    ) values (
      v_invoice_no, p_counter_id, v_counter.code, v_store.fy_label, v_seq, p_idempotency_key,
      p_cashier_user_id, v_staff.display_name, p_payment_method, v_item_count, v_total_qty,
      v_subtotal, v_taxable, v_cgst, v_sgst, v_round_off, v_grand_total, coalesce(v_has_edit, false),
      v_store.legal_name, v_store.address, v_store.phone, v_store.gstin, v_store.state_code, v_store.state_name,
      v_store.invoice_footer
    )
    returning id into v_invoice_id;

    insert into public.invoice_items (
      invoice_id, line_no, product_id, item_code, name, hsn_code, uom,
      unit_price, catalog_price, price_edited, mrp, gst_rate, qty, sold_by_weight,
      line_total, taxable_value, cgst, sgst
    )
    select v_invoice_id, l.line_no, l.product_id, l.item_code, l.name, l.hsn_code, l.uom,
           l.unit_price, l.catalog_price, l.price_edited, l.mrp, l.gst_rate, l.qty, l.sold_by_weight,
           l.line_total, l.taxable_value, l.cgst, l.sgst
      from jsonb_to_recordset(v_lines) as l(
             line_no smallint, product_id uuid, item_code text, name text, hsn_code text, uom text,
             unit_price integer, catalog_price integer, price_edited boolean, mrp integer,
             gst_rate smallint, qty numeric, sold_by_weight boolean,
             line_total bigint, taxable_value bigint, cgst bigint, sgst bigint);
  exception
    when unique_violation then
      -- Safety net for a same-key race the advisory lock did not cover (see the invoices migration).
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'invoices_idempotency_key_key' then
        raise;
      end if;
      select i.id, i.counter_id
        into v_existing_id, v_existing_counter
        from public.invoices i
       where i.idempotency_key = p_idempotency_key;
      if v_existing_counter is distinct from p_counter_id then
        raise exception 'This sale key was already used on another counter.' using errcode = '22023';
      end if;
      return public.invoice_json(v_existing_id);
  end;

  return public.invoice_json(v_invoice_id);
end;
$$;

comment on function public.create_invoice(uuid, uuid, uuid, jsonb, text) is
  'Creates an invoice in one transaction (idempotent on p_idempotency_key). Items: {product_id, qty, unit_price?}; '
  'qty is a whole number, or kg with up to 3 decimals for products sold by weight; unit_price is a per-bill '
  'price edit (0 < price <= MRP). Returns invoice_json(). service_role only.';

-- ---------------------------------------------------------------------------
-- 5. Lines export (new result columns, so drop + create)
-- ---------------------------------------------------------------------------
drop function public.invoice_export_lines(timestamptz, timestamptz, uuid, timestamptz, text, integer, integer);
create function public.invoice_export_lines(
  p_from             timestamptz,
  p_to               timestamptz,
  p_counter_id       uuid default null,
  p_after_created_at timestamptz default null,
  p_after_invoice_no text default null,
  p_after_line_no    integer default null,
  p_limit            integer default 1000
)
returns table (
  invoice_no     text,
  created_at     timestamptz,
  counter_code   text,
  cashier_name   text,
  payment_method text,
  line_no        integer,
  item_code      text,
  name           text,
  hsn_code       text,
  uom            text,
  qty            numeric,
  unit_price     integer,
  mrp            integer,
  gst_rate       integer,
  taxable_value  bigint,
  cgst           bigint,
  sgst           bigint,
  line_total     bigint,
  catalog_price  integer,
  price_edited   boolean,
  sold_by_weight boolean
)
language sql
stable
set search_path = ''
as $$
  select i.invoice_no, i.created_at, i.counter_code, i.cashier_name, i.payment_method,
         it.line_no::integer, it.item_code, it.name, it.hsn_code, it.uom, it.qty,
         it.unit_price, it.mrp, it.gst_rate::integer, it.taxable_value, it.cgst, it.sgst,
         it.line_total, it.catalog_price, it.price_edited, it.sold_by_weight
    from public.invoices i
    join public.invoice_items it on it.invoice_id = i.id
   where i.created_at >= p_from
     and i.created_at < p_to
     and (p_counter_id is null or i.counter_id = p_counter_id)
     and (p_after_created_at is null
          or (i.created_at, i.invoice_no, it.line_no) > (p_after_created_at, p_after_invoice_no, p_after_line_no))
   order by i.created_at, i.invoice_no, it.line_no
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

comment on function public.invoice_export_lines(timestamptz, timestamptz, uuid, timestamptz, text, integer, integer) is
  'One page of the daily-lines export (one row per invoice line), after the given keyset cursor. '
  'qty has 3 decimals (kg when sold_by_weight). service_role only.';

-- ---------------------------------------------------------------------------
-- 6. Privileges (the re-created function starts with PUBLIC EXECUTE; replaced ones keep theirs,
--    re-asserted anyway)
-- ---------------------------------------------------------------------------
revoke all on function public.create_invoice(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_invoice(uuid, uuid, uuid, jsonb, text) to service_role;

revoke all on function public.invoice_json(uuid) from public, anon, authenticated, service_role;

revoke all on function public.invoice_export_lines(timestamptz, timestamptz, uuid, timestamptz, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.invoice_export_lines(timestamptz, timestamptz, uuid, timestamptz, text, integer, integer)
  to service_role;
