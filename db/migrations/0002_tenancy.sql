create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- auth policy is data, not code (PRD s14 Authentication)
  max_failed_logins int not null default 5 check (max_failed_logins > 0),
  lockout_minutes int not null default 15 check (lockout_minutes > 0),
  session_hours int not null default 12 check (session_hours > 0),
  created_at timestamptz not null default now()
);

create table public.districts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9]{2,8}$'),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.districts (org_id);

create table public.centres (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  district_id uuid not null references public.districts(id),
  -- globally unique: login resolves a centre from its code alone (TEN-1, TEN-2)
  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9]{2,8}-[0-9]{2,4}$'),
  name text not null,
  timezone text not null default 'Asia/Kolkata',
  is_active boolean not null default true,
  accepts_inbound boolean not null default true,   -- deactivation step 1
  deactivated_at timestamptz,
  -- PRD open questions kept as per-centre config, never hardcoded:
  counsellor_lead_visibility text not null default 'own' check (counsellor_lead_visibility in ('own','all')),
  intra_centre_assignment text not null default 'centre_admin' check (intra_centre_assignment in ('centre_admin','round_robin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.centres (org_id);
create index on public.centres (district_id);

alter table public.orgs enable row level security;
alter table public.districts enable row level security;
alter table public.centres enable row level security;

-- No DELETE grant anywhere: history is never destroyed (PRD s17).
grant select on public.orgs to authenticated;
grant select, insert, update on public.districts, public.centres to authenticated;

create policy org_read on public.orgs for select to authenticated using (id = app.org_id());

create policy district_read on public.districts for select to authenticated
  using (org_id = app.org_id() and (app.is_hq() or id = app.district_id()));
create policy centre_read on public.centres for select to authenticated
  using (app.can_see(org_id, district_id, id));
-- write policies are added in 0003 once app.has_perm() exists
