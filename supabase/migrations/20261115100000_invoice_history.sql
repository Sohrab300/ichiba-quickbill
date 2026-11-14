-- Migration: invoice history, day totals and CSV exports (REQUIREMENTS.md section 9),
-- plus a guard for editing counter prefixes in Settings.
--
-- * invoice_day_totals(): totals per payment method for a time range (one IST day) and an
--   optional counter. Shown at the top of /invoices; adds up to the daily-summary export.
-- * invoice_export_summary() / invoice_export_lines(): one page of export rows, keyset-paginated
--   on (created_at, invoice_no[, line_no]) so a sale committed while an export is streaming can
--   never make a row appear twice or shift a page.
-- * counters_prefix_guard: a counter may not take a prefix that another counter has already
--   issued invoices under (its next number could collide with an existing invoice_no).
--
-- All read-only over the immutable invoices tables; EXECUTE for service_role only. Amounts are
-- integer paise.

-- ---------------------------------------------------------------------------
-- 1. Day totals
-- ---------------------------------------------------------------------------
create function public.invoice_day_totals(
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
   where i.created_at >= p_from
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
-- 3. Counter prefix guard
-- ---------------------------------------------------------------------------
-- Issued invoices keep their number whatever happens to the counter (they are immutable
-- snapshots). But if counter B took a prefix counter A has already used, B's next invoice in the
-- same FY could get a number A already issued, and every sale on B would fail on
-- invoices_invoice_no_key. Refuse that up front. Going back to a prefix this counter used before
-- is fine: its own sequence continues.
create function public.counters_prefix_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.invoice_prefix is not distinct from old.invoice_prefix then
    return new;
  end if;
  if exists (
    select 1
      from public.invoices i
     where i.counter_id <> new.id
       and split_part(i.invoice_no, '/', 1) = new.invoice_prefix
  ) then
    raise exception 'Prefix % is already used on invoices of another counter.', new.invoice_prefix
      using errcode = '22023',
            hint = 'Pick a prefix no other counter has issued invoices under.';
  end if;
  return new;
end;
$$;

create trigger counters_prefix_guard_row
  before insert or update of invoice_prefix on public.counters
  for each row execute function public.counters_prefix_guard();

-- ---------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------
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

-- Trigger function: runs as the updating role (service_role can read invoices); not an API endpoint.
revoke all on function public.counters_prefix_guard() from public, anon, authenticated, service_role;
