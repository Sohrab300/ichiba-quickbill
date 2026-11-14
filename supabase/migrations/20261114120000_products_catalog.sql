-- Migration: product catalog for Ichiba QuickBill (REQUIREMENTS.md sections 1, 2, 11)
--
-- * Removes the first prototype's sales tables and complete_sale() (test data only).
-- * Replaces `products` with the imported-catalog shape (item_code, paise prices, GST, HSN, ...).
-- * Adds product_barcodes (manufacturer EAN aliases) and store_settings (single row).
-- * RLS on every table, no policies: only the service role (server-side) can touch data.

-- ---------------------------------------------------------------------------
-- 0. Drop the prototype
-- ---------------------------------------------------------------------------
drop function if exists public.complete_sale(jsonb);
drop table if exists public.sale_items;
drop table if exists public.sales;
-- The prototype products table (barcode/price/category) only ever held seed data.
drop table if exists public.products cascade;

create extension if not exists pg_trgm with schema extensions;

-- Shared updated_at trigger function (re-created with a fixed search_path).
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. products
-- ---------------------------------------------------------------------------
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  -- Internal item code from the stock export (7 digits today); also scannable.
  item_code     text not null
                constraint products_item_code_key unique
                constraint products_item_code_format check (item_code ~ '^[0-9A-Za-z_-]{1,32}$'),
  name          text not null
                constraint products_name_length check (char_length(btrim(name)) between 1 and 255),
  -- Money is integer paise. selling_price is GST-inclusive (REQUIREMENTS.md section 3).
  selling_price integer not null constraint products_selling_price_nonneg check (selling_price >= 0),
  mrp           integer null     constraint products_mrp_nonneg check (mrp >= 0),
  gst_rate      smallint not null
                -- 0/5/12/18/28 per REQUIREMENTS.md, plus 40 (GST 2.0 slab, present in the stock export).
                constraint products_gst_rate_valid check (gst_rate in (0, 5, 12, 18, 28, 40)),
  hsn_code      text null constraint products_hsn_format check (hsn_code ~ '^[0-9]{4,8}$'),
  uom           text not null default 'PCS'
                constraint products_uom_length check (char_length(uom) between 1 and 16),
  category      text null,
  department    text null,
  -- Informational only; never decremented by sales in the MVP.
  stock_qty     numeric(12, 3) not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint products_selling_le_mrp check (mrp is null or selling_price <= mrp)
);

comment on table public.products is 'Sellable items. Imported from the Current Stock Detail CSV (scripts/import-products.ts).';
comment on column public.products.selling_price is 'GST-inclusive selling price in paise.';
comment on column public.products.mrp is 'Maximum retail price in paise.';
comment on column public.products.stock_qty is 'Stock at import time, for reference only. Not decremented on sale.';

-- item_code lookups use the btree index behind products_item_code_key (UNIQUE).
-- Trigram index so `name ILIKE '%term%'` searches do not need a sequential scan.
create index products_name_trgm_idx on public.products using gin (name extensions.gin_trgm_ops);

create trigger trigger_products_updated_at
  before update on public.products
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 2. product_barcodes (manufacturer EAN / UPC aliases)
-- ---------------------------------------------------------------------------
create table public.product_barcodes (
  id          uuid primary key default gen_random_uuid(),
  -- Printable ASCII without spaces; scanners emit EAN-8/13, UPC-A or Code 128.
  barcode     text not null
              constraint product_barcodes_barcode_key unique
              constraint product_barcodes_barcode_format check (barcode ~ '^[!-~]{1,64}$'),
  product_id  uuid not null references public.products (id) on delete cascade,
  created_at  timestamptz not null default now()
);

comment on table public.product_barcodes is 'Barcode aliases. Scan lookup checks this table first, then products.item_code.';

-- barcode lookups use the btree index behind product_barcodes_barcode_key (UNIQUE).
create index product_barcodes_product_id_idx on public.product_barcodes (product_id);

-- ---------------------------------------------------------------------------
-- 3. store_settings (exactly one row)
-- ---------------------------------------------------------------------------
create table public.store_settings (
  id                     boolean primary key default true
                         constraint store_settings_single_row check (id),
  legal_name             text not null,
  address                text not null,
  phone                  text null,
  gstin                  text not null
                         constraint store_settings_gstin_format
                         check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  state_code             text not null,
  state_name             text not null,
  -- Indian FY label, e.g. '26-27' for 1 Apr 2026 - 31 Mar 2027.
  fy_label               text not null
                         constraint store_settings_fy_label_format check (fy_label ~ '^[0-9]{2}-[0-9]{2}$'),
  default_print_width_mm smallint not null default 80
                         constraint store_settings_print_width check (default_print_width_mm in (58, 80)),
  invoice_footer         text null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint store_settings_state_matches_gstin check (state_code = left(gstin, 2))
);

comment on table public.store_settings is 'Invoice header / store configuration. Single row (id = true).';

create trigger trigger_store_settings_updated_at
  before update on public.store_settings
  for each row execute function public.update_updated_at_column();

insert into public.store_settings
  (id, legal_name, address, phone, gstin, state_code, state_name, fy_label, default_print_width_mm)
values
  (true, 'ASIANA FOOD AND BEVERAGE LLP', 'LG04, South Point Mall, Gurgaon', '8448852544',
   '06ABLFA8216A1ZT', '06', 'Haryana', '26-27', 80)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Scan lookup: barcode alias first, then item_code, in one round trip
-- ---------------------------------------------------------------------------
create or replace function public.lookup_product(p_code text)
returns setof public.products
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
  from (
    select b.product_id, 1 as priority
    from public.product_barcodes b
    where b.barcode = p_code
    union all
    select p2.id, 2 as priority
    from public.products p2
    where p2.item_code = p_code
  ) m
  join public.products p on p.id = m.product_id
  order by m.priority
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security and privileges
-- ---------------------------------------------------------------------------
alter table public.products         enable row level security;
alter table public.product_barcodes enable row level security;
alter table public.store_settings   enable row level security;
-- No policies: anon/authenticated get nothing. The service role bypasses RLS.

revoke all on table public.products, public.product_barcodes, public.store_settings from anon, authenticated;
grant select, insert, update, delete on table public.products, public.product_barcodes, public.store_settings to service_role;

revoke all on function public.lookup_product(text) from public, anon, authenticated;
grant execute on function public.lookup_product(text) to service_role;
