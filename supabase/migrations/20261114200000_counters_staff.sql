-- Migration: billing counters and staff logins (REQUIREMENTS.md section 4)
--
-- * counters: CL1, CL2, CL3 (desk PCs) and MOB (mobile billing).
-- * staff_profiles: one row per Supabase Auth user, mapping the login to a role and a counter.
--   The counter used for an invoice is always read from here on the server, never from the browser.
-- * RLS on, no policies: only the service role (server-side) can read or write these tables.

-- ---------------------------------------------------------------------------
-- 1. counters
-- ---------------------------------------------------------------------------
create table public.counters (
  id             uuid primary key default gen_random_uuid(),
  code           text not null
                 constraint counters_code_key unique
                 constraint counters_code_format check (code ~ '^[A-Z0-9]{1,8}$'),
  -- Used in invoice numbers: {PREFIX}/{FY}/{000001}.
  invoice_prefix text not null
                 constraint counters_invoice_prefix_key unique
                 constraint counters_invoice_prefix_format check (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  kind           text not null
                 constraint counters_kind_valid check (kind in ('desk', 'mobile')),
  print_width_mm smallint not null default 80
                 constraint counters_print_width check (print_width_mm in (58, 80)),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.counters is 'Billing counters (desk PCs and mobile). Each has its own invoice number sequence.';

create trigger trigger_counters_updated_at
  before update on public.counters
  for each row execute function public.update_updated_at_column();

insert into public.counters (code, invoice_prefix, kind, print_width_mm)
values
  ('CL1', 'CL1', 'desk',   80),
  ('CL2', 'CL2', 'desk',   80),
  ('CL3', 'CL3', 'desk',   80),
  ('MOB', 'MOB', 'mobile', 80)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. staff_profiles
-- ---------------------------------------------------------------------------
create table public.staff_profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
               constraint staff_profiles_display_name_length check (char_length(btrim(display_name)) between 1 and 80),
  role         text not null
               constraint staff_profiles_role_valid check (role in ('admin', 'cashier')),
  -- Cashiers always bill on a counter. An admin may have none (catalog/settings only).
  counter_id   uuid null references public.counters (id) on delete restrict,
  -- Set to false to lock a login out immediately (checked on every request).
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint staff_profiles_cashier_has_counter check (role = 'admin' or counter_id is not null)
);

comment on table public.staff_profiles is 'Role and counter for each Supabase Auth login. Created with scripts/create-staff.ts.';

create index staff_profiles_counter_id_idx on public.staff_profiles (counter_id);

create trigger trigger_staff_profiles_updated_at
  before update on public.staff_profiles
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security and privileges
-- ---------------------------------------------------------------------------
alter table public.counters       enable row level security;
alter table public.staff_profiles enable row level security;
-- No policies: anon/authenticated get nothing. The service role bypasses RLS.

revoke all on table public.counters, public.staff_profiles from anon, authenticated;
grant select, insert, update, delete on table public.counters, public.staff_profiles to service_role;
