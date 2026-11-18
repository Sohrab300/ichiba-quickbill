-- Migration: sales report aggregate (Reports page, REQUIREMENTS.md sections 3, 9 and 17)
--
-- * sales_report(): invoice lines in [p_from, p_to), optionally for one counter, summed per
--   (HSN, GST rate) or per GST rate, in one set-based query. Replaces the Reports page's old
--   approach of downloading the daily-lines CSV and summing it in the browser, so a month is one
--   request instead of one export per day.
--   - hsn: NULL for missing or blank HSN codes (the app shows "Unspecified"); always NULL when
--     grouping by GST rate.
--   - invoice_count: distinct invoices in the group. One invoice can be in several groups, so
--     the group counts do not add up to the total; the totals row (is_total) counts each invoice
--     once.
--   - qty_kg: summed qty of lines sold by weight; qty_pcs: summed qty of the other lines
--     (section 17: kg are never added to pieces).
--   - taxable / cgst / sgst / line_total: integer paise (bigint), summed from the stored lines.
--     line_total is before the invoice round-off, so taxable + cgst + sgst = line_total.
--   - is_total: the one extra row over the whole range (GROUPING SETS ... ()), always present,
--     all zeros for an empty range. Ordered last.
-- * invoice_items_invoice_id_report_idx: covering index for the join, see section 2.
--
-- Read-only over the immutable invoices tables. SECURITY DEFINER with a pinned search_path;
-- EXECUTE for service_role only (the app calls it with the server's secret key after checking
-- the login is an admin).

-- ---------------------------------------------------------------------------
-- 1. sales_report()
-- ---------------------------------------------------------------------------
-- p_group has a default only because PostgreSQL requires every parameter after one with a
-- default (p_counter_id) to have one too.
create function public.sales_report(
  p_from       timestamptz,
  p_to         timestamptz,
  p_counter_id uuid default null,
  p_group      text default 'hsn'
)
returns table (
  is_total      boolean,
  hsn           text,
  gst_rate      integer,
  invoice_count bigint,
  line_count    bigint,
  qty_kg        numeric,
  qty_pcs       numeric,
  taxable       bigint,
  cgst          bigint,
  sgst          bigint,
  line_total    bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_group is null or p_group not in ('hsn', 'gst') then
    raise exception 'p_group must be ''hsn'' or ''gst'' (got %).', coalesce(p_group, 'null')
      using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Invalid range [%, %).', p_from, p_to using errcode = '22023';
  end if;

  return query
  select grouping(l.hsn, l.gst_rate) = 3,
         l.hsn,
         l.gst_rate,
         count(distinct l.invoice_id),
         count(*),
         coalesce(sum(l.qty) filter (where l.sold_by_weight), 0)::numeric,
         coalesce(sum(l.qty) filter (where not l.sold_by_weight), 0)::numeric,
         coalesce(sum(l.taxable_value), 0)::bigint,
         coalesce(sum(l.cgst), 0)::bigint,
         coalesce(sum(l.sgst), 0)::bigint,
         coalesce(sum(l.line_total), 0)::bigint
    from (
      select it.invoice_id,
             case when p_group = 'hsn' then nullif(btrim(it.hsn_code), '') end as hsn,
             it.gst_rate::integer as gst_rate,
             it.qty, it.sold_by_weight, it.taxable_value, it.cgst, it.sgst, it.line_total
        from public.invoices i
        join public.invoice_items it on it.invoice_id = i.id
       where i.created_at >= p_from
         and i.created_at < p_to
         and (p_counter_id is null or i.counter_id = p_counter_id)
    ) l
   group by grouping sets ((l.hsn, l.gst_rate), ())
   order by grouping(l.hsn, l.gst_rate), l.hsn nulls last, l.gst_rate;
end;
$$;

comment on function public.sales_report(timestamptz, timestamptz, uuid, text) is
  'Sales per (HSN, GST rate) or per GST rate for invoices in [p_from, p_to), optionally one counter, plus one is_total row. Paise. service_role only.';

-- ---------------------------------------------------------------------------
-- 2. Index
-- ---------------------------------------------------------------------------
-- invoices are found through invoices_created_at_idx / invoices_counter_created_at_idx. Their lines
-- were reachable only through the (invoice_id, line_no) unique index, i.e. one heap visit per
-- line; for a month PostgreSQL preferred a sequential scan of all of invoice_items instead,
-- which grows with every day of history. This covering index serves the join with index-only
-- scans (invoice_items is append-only, so its pages stay all-visible after vacuum).
create index invoice_items_invoice_id_report_idx on public.invoice_items (invoice_id)
  include (hsn_code, gst_rate, qty, sold_by_weight, taxable_value, cgst, sgst, line_total);

-- ---------------------------------------------------------------------------
-- 3. Privileges (a new function starts with EXECUTE for PUBLIC)
-- ---------------------------------------------------------------------------
revoke all on function public.sales_report(timestamptz, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.sales_report(timestamptz, timestamptz, uuid, text) to service_role;
