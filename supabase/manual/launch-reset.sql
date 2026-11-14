-- =====================================================================================
-- ONE-TIME LAUNCH RESET — deletes ALL invoices so real billing starts at 000001.
--
-- Run this ONCE, in the Supabase dashboard → SQL Editor, AFTER the in-store test day
-- and BEFORE the first real customer bill. Never run it after real billing has started:
-- issued tax invoices must never be deleted.
--
-- This is NOT a migration (it lives outside supabase/migrations on purpose).
--
-- How to run:
--   1. Edit the two settings in the "SETTINGS" block below.
--   2. Run the "PREVIEW" query first and read what will be deleted.
--   3. Run the whole "RESET" block. It runs in one transaction: if any check fails,
--      nothing is deleted and the protection triggers stay on.
--   4. Run the "VERIFY" query: 0 invoices, 0 sequences, all 6 triggers enabled ('O').
-- =====================================================================================


-- ---------- PREVIEW (read-only) -------------------------------------------------------
select c.code as counter, count(i.*) as invoices,
       min(i.invoice_no) as first_no, max(i.invoice_no) as last_no,
       min(i.created_at at time zone 'Asia/Kolkata') as first_ist,
       max(i.created_at at time zone 'Asia/Kolkata') as last_ist
from public.invoices i
join public.counters c on c.id = i.counter_id
group by c.code
order by c.code;


-- ---------- RESET ---------------------------------------------------------------------
begin;

do $$
declare
  -- SETTINGS — edit both before running:
  -- 1) Type exactly: DELETE ALL TEST INVOICES
  v_confirm   text        := 'type here';
  -- 2) The moment real billing will start (IST). The reset refuses to run if any invoice
  --    was created at or after this time, so a real sale can never be wiped by mistake.
  v_go_live   timestamptz := '2099-01-01 00:00:00+05:30';
  -- 3) Upper limit on how many test invoices you expect (safety net).
  v_max_count int         := 500;

  v_count int;
  v_newer int;
begin
  if v_confirm <> 'DELETE ALL TEST INVOICES' then
    raise exception 'Confirmation text does not match. Nothing deleted.';
  end if;
  if v_go_live > now() + interval '7 days' then
    raise exception 'Set v_go_live to the real go-live time (it is still the placeholder). Nothing deleted.';
  end if;

  select count(*) into v_count from public.invoices;
  select count(*) into v_newer from public.invoices where created_at >= v_go_live;

  if v_newer > 0 then
    raise exception '% invoice(s) were created at/after go-live (%). These may be real sales. Nothing deleted.',
      v_newer, v_go_live;
  end if;
  if v_count > v_max_count then
    raise exception '% invoices found, more than the expected maximum %. Nothing deleted.', v_count, v_max_count;
  end if;

  raise notice 'Deleting % test invoice(s) and resetting all invoice sequences.', v_count;
end;
$$;

alter table public.invoice_items     disable trigger invoice_items_immutable_row;
alter table public.invoice_items     disable trigger invoice_items_immutable_truncate;
alter table public.invoices          disable trigger invoices_immutable_row;
alter table public.invoices          disable trigger invoices_immutable_truncate;
alter table public.invoice_sequences disable trigger invoice_sequences_guard_row;
alter table public.invoice_sequences disable trigger invoice_sequences_guard_truncate;

delete from public.invoice_items;
delete from public.invoices;
delete from public.invoice_sequences;

alter table public.invoice_items     enable trigger invoice_items_immutable_row;
alter table public.invoice_items     enable trigger invoice_items_immutable_truncate;
alter table public.invoices          enable trigger invoices_immutable_row;
alter table public.invoices          enable trigger invoices_immutable_truncate;
alter table public.invoice_sequences enable trigger invoice_sequences_guard_row;
alter table public.invoice_sequences enable trigger invoice_sequences_guard_truncate;

commit;


-- ---------- VERIFY --------------------------------------------------------------------
select
  (select count(*) from public.invoices)          as invoices,
  (select count(*) from public.invoice_items)     as invoice_items,
  (select count(*) from public.invoice_sequences) as sequences;

select tgrelid::regclass as table_name, tgname, tgenabled   -- every row must show 'O'
from pg_trigger
where tgname in ('invoice_items_immutable_row','invoice_items_immutable_truncate',
                 'invoices_immutable_row','invoices_immutable_truncate',
                 'invoice_sequences_guard_row','invoice_sequences_guard_truncate')
order by 1, 2;
