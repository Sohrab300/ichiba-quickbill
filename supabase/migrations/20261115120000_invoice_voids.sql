-- Keep issued invoice snapshots immutable; append a permanent void audit record.
create table public.invoice_voids (
  invoice_id uuid primary key references public.invoices(id),
  voided_at timestamptz not null default now(),
  voided_by uuid not null references public.staff_profiles(user_id),
  reason text not null check (char_length(btrim(reason)) between 1 and 500)
);
alter table public.invoice_voids enable row level security;
revoke all on public.invoice_voids from public, anon, authenticated, service_role;
grant select on public.invoice_voids to service_role;
create trigger invoice_voids_immutable_row
  before update or delete on public.invoice_voids
  for each row execute function public.invoices_immutable();
create trigger invoice_voids_immutable_truncate
  before truncate on public.invoice_voids
  for each statement execute function public.invoices_immutable();

create function public.void_invoice(p_invoice_id uuid, p_admin_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.staff_profiles s
                 where s.user_id = p_admin_user_id and s.role = 'admin' and s.is_active) then
    raise exception 'Only an active admin can void invoices.' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'Enter a reason (1–500 characters).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.invoices where id = p_invoice_id) then
    raise exception 'Invoice not found.' using errcode = '22023';
  end if;
  insert into public.invoice_voids (invoice_id, voided_by, reason)
  values (p_invoice_id, p_admin_user_id, btrim(p_reason))
  on conflict (invoice_id) do nothing;
end;
$$;
revoke all on function public.void_invoice(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.void_invoice(uuid, uuid, text) to service_role;

-- Totals and exports use the same exclusion rule.
create or replace function public.invoice_day_totals(
  p_from       timestamptz,
  p_to         timestamptz,
  p_counter_id uuid default null
)
returns table (
  payment_method text,
  invoice_count  bigint,
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
         sum(i.taxable_total)::bigint,
         sum(i.cgst_total)::bigint,
         sum(i.sgst_total)::bigint,
         sum(i.round_off)::bigint,
         sum(i.grand_total)::bigint
    from public.invoices i
   where not exists (select 1 from public.invoice_voids v where v.invoice_id = i.id)
     and i.created_at >= p_from
     and i.created_at < p_to
     and (p_counter_id is null or i.counter_id = p_counter_id)
   group by i.payment_method
   order by i.payment_method;
$$;

comment on function public.invoice_day_totals(timestamptz, timestamptz, uuid) is
  'Invoice totals per payment method in [p_from, p_to), optionally for one counter. service_role only.';

-- ---------------------------------------------------------------------------
-- 2. Export pages (at most 1000 rows each, the PostgREST max-rows default)
-- ---------------------------------------------------------------------------
create or replace function public.invoice_export_summary(
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
  grand_total    bigint
)
language sql
stable
set search_path = ''
as $$
  select i.invoice_no, i.created_at, i.counter_code, i.cashier_name, i.payment_method,
         i.item_count, i.total_qty, i.taxable_total, i.cgst_total, i.sgst_total,
         i.round_off, i.grand_total
    from public.invoices i
   where not exists (select 1 from public.invoice_voids v where v.invoice_id = i.id)
     and i.created_at >= p_from
     and i.created_at < p_to
     and (p_counter_id is null or i.counter_id = p_counter_id)
     and (p_after_created_at is null
          or (i.created_at, i.invoice_no) > (p_after_created_at, p_after_invoice_no))
   order by i.created_at, i.invoice_no
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

comment on function public.invoice_export_summary(timestamptz, timestamptz, uuid, timestamptz, text, integer) is
  'One page of the daily-summary export (one row per invoice), after the given keyset cursor. service_role only.';

create or replace function public.invoice_export_lines(
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
  line_total     bigint
)
language sql
stable
set search_path = ''
as $$
  select i.invoice_no, i.created_at, i.counter_code, i.cashier_name, i.payment_method,
         it.line_no::integer, it.item_code, it.name, it.hsn_code, it.uom, it.qty,
         it.unit_price, it.mrp, it.gst_rate::integer, it.taxable_value, it.cgst, it.sgst,
         it.line_total
    from public.invoices i
    join public.invoice_items it on it.invoice_id = i.id
   where not exists (select 1 from public.invoice_voids v where v.invoice_id = i.id)
     and i.created_at >= p_from
     and i.created_at < p_to
     and (p_counter_id is null or i.counter_id = p_counter_id)
     and (p_after_created_at is null
          or (i.created_at, i.invoice_no, it.line_no) > (p_after_created_at, p_after_invoice_no, p_after_line_no))
   order by i.created_at, i.invoice_no, it.line_no
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

comment on function public.invoice_export_lines(timestamptz, timestamptz, uuid, timestamptz, text, integer, integer) is
  'One page of the daily-lines export (one row per invoice line), after the given keyset cursor. service_role only.';

