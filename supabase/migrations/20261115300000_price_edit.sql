-- Migration: change an item's price on one bill (REQUIREMENTS.md section 16)
--
-- * invoice_items.catalog_price: products.selling_price at the time of sale; unit_price stays the
--   price actually charged. price_edited is true when the two differ. Existing lines were all
--   charged their catalog price, so they are backfilled with catalog_price = unit_price.
-- * invoices.has_price_edit: at least one line of the bill has an edited price.
-- * create_invoice(): an item may carry "unit_price" (integer paise). The catalog price and MRP
--   are always read from products; a different unit_price is accepted only when
--   0 < unit_price <= MRP. A product without an MRP can only be made cheaper (cap = its catalog
--   price). The same product sent with two different prices is refused. GST and round-off are
--   computed exactly as before, on the charged price. Idempotency is unchanged.
-- * invoice_json() / get_invoice(): catalog_price + price_edited per line, has_price_edit.
-- * Exports: catalog_price / price_edited per line, has_price_edit per invoice;
--   invoice_day_totals(): edited_count (bills with an edited price).
--
-- products is never written by anything here: the catalog price never changes because of an edit.
--
-- Apply before deploying the app code that sends unit_price. The old app keeps working on the
-- new schema (it ignores the new fields); the new app on the old schema would have its edits
-- silently ignored by the old create_invoice().

-- ---------------------------------------------------------------------------
-- 1. Columns and backfill
-- ---------------------------------------------------------------------------
-- Adding a column with a constant default does not rewrite or UPDATE rows, so these do not touch
-- the immutability triggers. has_price_edit is false for every existing invoice through its default.
alter table public.invoice_items
  add column catalog_price integer null,
  add column price_edited  boolean not null default false;

alter table public.invoices
  add column has_price_edit boolean not null default false;

-- The one UPDATE ever run on issued invoice lines. The row trigger is disabled only around this
-- statement, inside this migration's transaction (a failure anywhere rolls the disable back too).
alter table public.invoice_items disable trigger invoice_items_immutable_row;
update public.invoice_items set catalog_price = unit_price where catalog_price is null;
alter table public.invoice_items enable trigger invoice_items_immutable_row;

alter table public.invoice_items
  alter column catalog_price set not null,
  add constraint invoice_items_catalog_price_nonneg check (catalog_price >= 0),
  -- The flag can never disagree with the prices.
  add constraint invoice_items_price_edited_flag check (price_edited = (unit_price <> catalog_price)),
  -- Same rule as create_invoice(): an edited price is > 0 and <= MRP (or <= catalog without an MRP).
  add constraint invoice_items_edited_price_range
    check (not price_edited or (unit_price >= 1 and unit_price <= coalesce(mrp, catalog_price)));

comment on column public.invoice_items.catalog_price is
  'products.selling_price when the invoice was issued (paise). unit_price is what was charged.';
comment on column public.invoice_items.price_edited is
  'The cashier changed the price for this bill (unit_price <> catalog_price).';
comment on column public.invoices.has_price_edit is
  'At least one line has an edited price. Shown to admins only.';

-- "Edited only" filter in /invoices; few rows, so a small partial index.
create index invoices_price_edit_created_at_idx on public.invoices (created_at desc) where has_price_edit;

-- The four immutability triggers must still be enabled.
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
-- 2. invoice_json()
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
               'line_no',       it.line_no,
               'product_id',    it.product_id,
               'item_code',     it.item_code,
               'name',          it.name,
               'hsn_code',      it.hsn_code,
               'uom',           it.uom,
               'unit_price',    it.unit_price,
               'catalog_price', it.catalog_price,
               'price_edited',  it.price_edited,
               'mrp',           it.mrp,
               'gst_rate',      it.gst_rate,
               'qty',           it.qty,
               'line_total',    it.line_total,
               'taxable_value', it.taxable_value,
               'cgst',          it.cgst,
               'sgst',          it.sgst
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
-- 3. create_invoice()
-- ---------------------------------------------------------------------------
-- Same signature and behaviour as 20261114230000_invoices.sql, plus the optional per-item
-- unit_price. Errors meant for the cashier use SQLSTATE 22023 / 42501 as before.
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
  c_max_seq     constant integer := 999999;
  v_staff       record;
  v_counter     record;
  v_store       record;
  v_existing_id uuid;
  v_existing_counter uuid;
  v_product_ids uuid[];
  v_qtys        bigint[];
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
  if exists (
    select 1
      from jsonb_array_elements(p_items) e
      cross join lateral (select (e -> 'qty')::numeric as q) x
     where x.q <> trunc(x.q) or x.q < 1 or x.q > c_max_qty
  ) then
    raise exception 'Quantity must be a whole number from 1 to %.', c_max_qty using errcode = '22023';
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

  -- Merge duplicate product ids (summing qty), keeping the order of first appearance, and collect
  -- the requested price per product: multi = two different explicit prices; mixed = some
  -- elements with a price and some without (a conflict only if that price is not the catalog's).
  select array_agg(m.product_id order by m.first_ord),
         array_agg(m.qty        order by m.first_ord),
         array_agg(m.req_price  order by m.first_ord),
         array_agg(m.multi      order by m.first_ord),
         array_agg(m.mixed      order by m.first_ord)
    into v_product_ids, v_qtys, v_req_prices, v_multi, v_mixed
    from (
      select r.product_id,
             sum(r.qty)::bigint                                  as qty,
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

  -- e) Price every line and compute GST (REQUIREMENTS.md sections 3 and 16), in a single
  --    statement so all lines see the same snapshot:
  --      catalog    = products.selling_price (always read here, never from the browser)
  --      charged    = the requested unit_price if it differs from catalog and 0 < it <= cap,
  --                   cap = coalesce(mrp, catalog); otherwise catalog (a refused request is
  --                   reported below, never billed)
  --      line_total = charged × qty                                (GST-inclusive)
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
             p.item_code, p.name, p.hsn_code, p.uom,
             p.selling_price                        as catalog_price,
             ch.unit_price,
             ok.edit_ok                             as price_edited,
             w.wants_edit,
             x.req_price,
             cap.max_price,
             (x.multi or (x.mixed and w.wants_edit)) as price_conflict,
             p.mrp, p.gst_rate,
             x.qty::integer                         as qty,
             lt.line_total,
             tx.taxable_value,
             (lt.line_total - tx.taxable_value) / 2 as cgst,
             (lt.line_total - tx.taxable_value) - (lt.line_total - tx.taxable_value) / 2 as sgst
        from unnest(v_product_ids, v_qtys, v_req_prices, v_multi, v_mixed)
               with ordinality as x(product_id, qty, req_price, multi, mixed, ord)
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
        cross join lateral (select ch.unit_price::bigint * x.qty as line_total) lt
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

  select count(*), sum(l.qty), sum(l.line_total), sum(l.taxable_value), sum(l.cgst), sum(l.sgst), bool_or(l.price_edited)
    into v_item_count, v_total_qty, v_subtotal, v_taxable, v_cgst, v_sgst, v_has_edit
    from jsonb_to_recordset(v_lines)
      as l(qty integer, line_total bigint, taxable_value bigint, cgst bigint, sgst bigint, price_edited boolean);

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
      unit_price, catalog_price, price_edited, mrp, gst_rate, qty, line_total, taxable_value, cgst, sgst
    )
    select v_invoice_id, l.line_no, l.product_id, l.item_code, l.name, l.hsn_code, l.uom,
           l.unit_price, l.catalog_price, l.price_edited, l.mrp, l.gst_rate, l.qty,
           l.line_total, l.taxable_value, l.cgst, l.sgst
      from jsonb_to_recordset(v_lines) as l(
             line_no smallint, product_id uuid, item_code text, name text, hsn_code text, uom text,
             unit_price integer, catalog_price integer, price_edited boolean, mrp integer,
             gst_rate smallint, qty integer, line_total bigint, taxable_value bigint, cgst bigint, sgst bigint);
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
  'unit_price is a per-bill price edit (0 < price <= MRP). Returns invoice_json(). service_role only.';

-- ---------------------------------------------------------------------------
-- 4. Day totals and exports (new result columns, so drop + create)
-- ---------------------------------------------------------------------------
drop function public.invoice_day_totals(timestamptz, timestamptz, uuid);
create function public.invoice_day_totals(
  p_from       timestamptz,
  p_to         timestamptz,
  p_counter_id uuid default null
)
returns table (
  payment_method text,
  invoice_count  bigint,
  edited_count   bigint,
  taxable_total  bigint,
  cgst_total     bigint,
  sgst_total     bigint,
  round_off      bigint,
  grand_total    bigint
)
language sql
stable
set search_path = ''
as $$
  select i.payment_method,
         count(*)::bigint,
         count(*) filter (where i.has_price_edit)::bigint,
         sum(i.taxable_total)::bigint,
         sum(i.cgst_total)::bigint,
         sum(i.sgst_total)::bigint,
         sum(i.round_off)::bigint,
         sum(i.grand_total)::bigint
    from public.invoices i
   where i.created_at >= p_from
     and i.created_at < p_to
     and (p_counter_id is null or i.counter_id = p_counter_id)
   group by i.payment_method
   order by i.payment_method;
$$;

comment on function public.invoice_day_totals(timestamptz, timestamptz, uuid) is
  'Invoice totals per payment method in [p_from, p_to), optionally for one counter; edited_count = bills with a price edit. service_role only.';

drop function public.invoice_export_summary(timestamptz, timestamptz, uuid, timestamptz, text, integer);
create function public.invoice_export_summary(
  p_from             timestamptz,
  p_to               timestamptz,
  p_counter_id       uuid default null,
  p_after_created_at timestamptz default null,
  p_after_invoice_no text default null,
  p_limit            integer default 1000
)
returns table (
  invoice_no     text,
  created_at     timestamptz,
  counter_code   text,
  cashier_name   text,
  payment_method text,
  item_count     integer,
  total_qty      integer,
  taxable_total  bigint,
  cgst_total     bigint,
  sgst_total     bigint,
  round_off      integer,
  grand_total    bigint,
  has_price_edit boolean
)
language sql
stable
set search_path = ''
as $$
  select i.invoice_no, i.created_at, i.counter_code, i.cashier_name, i.payment_method,
         i.item_count, i.total_qty, i.taxable_total, i.cgst_total, i.sgst_total,
         i.round_off, i.grand_total, i.has_price_edit
    from public.invoices i
   where i.created_at >= p_from
     and i.created_at < p_to
     and (p_counter_id is null or i.counter_id = p_counter_id)
     and (p_after_created_at is null
          or (i.created_at, i.invoice_no) > (p_after_created_at, p_after_invoice_no))
   order by i.created_at, i.invoice_no
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

comment on function public.invoice_export_summary(timestamptz, timestamptz, uuid, timestamptz, text, integer) is
  'One page of the daily-summary export (one row per invoice), after the given keyset cursor. service_role only.';

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
  qty            integer,
  unit_price     integer,
  mrp            integer,
  gst_rate       integer,
  taxable_value  bigint,
  cgst           bigint,
  sgst           bigint,
  line_total     bigint,
  catalog_price  integer,
  price_edited   boolean
)
language sql
stable
set search_path = ''
as $$
  select i.invoice_no, i.created_at, i.counter_code, i.cashier_name, i.payment_method,
         it.line_no::integer, it.item_code, it.name, it.hsn_code, it.uom, it.qty,
         it.unit_price, it.mrp, it.gst_rate::integer, it.taxable_value, it.cgst, it.sgst,
         it.line_total, it.catalog_price, it.price_edited
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
  'One page of the daily-lines export (one row per invoice line), after the given keyset cursor. service_role only.';

-- ---------------------------------------------------------------------------
-- 5. Privileges (re-created functions start with PUBLIC EXECUTE; replaced ones keep theirs,
--    re-asserted anyway)
-- ---------------------------------------------------------------------------
revoke all on function public.create_invoice(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_invoice(uuid, uuid, uuid, jsonb, text) to service_role;

revoke all on function public.invoice_json(uuid) from public, anon, authenticated, service_role;

revoke all on function public.invoice_day_totals(timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.invoice_day_totals(timestamptz, timestamptz, uuid) to service_role;

revoke all on function public.invoice_export_summary(timestamptz, timestamptz, uuid, timestamptz, text, integer)
  from public, anon, authenticated;
grant execute on function public.invoice_export_summary(timestamptz, timestamptz, uuid, timestamptz, text, integer)
  to service_role;

revoke all on function public.invoice_export_lines(timestamptz, timestamptz, uuid, timestamptz, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.invoice_export_lines(timestamptz, timestamptz, uuid, timestamptz, text, integer, integer)
  to service_role;
