-- Parent identity -> centre-scoped lead -> students (brief s6).
-- parent_identities is cross-centre by nature, so NO tenant role can read it: knowing a row
-- exists would reveal that some other centre holds the parent (LT-4).
create table public.parent_identities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_hash text not null,                 -- sha256 hex of E.164; the only identifier later sent to Meta CAPI
  email_hash text,
  created_at timestamptz not null default now(),
  unique (org_id, phone_e164)
);
create index on public.parent_identities (phone_hash);
create index on public.parent_identities (email_hash) where email_hash is not null;
alter table public.parent_identities enable row level security;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  district_id uuid references public.districts(id),          -- district of current centre
  current_centre_id uuid references public.centres(id),      -- NULL = HQ pool awaiting routing
  origin_centre_id uuid references public.centres(id),       -- immutable (trigger below)
  parent_identity_id uuid references public.parent_identities(id),   -- NULL only after erasure
  owner_user_id uuid references public.users(id),
  assigned_at timestamptz,
  assign_status text not null default 'unassigned' check (assign_status in ('unassigned','assigned')),
  name text,
  primary_phone text check (primary_phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  country char(2), state text, city text,
  timezone text not null default 'Asia/Kolkata',
  language text,
  lifecycle public.lifecycle not null default 'ENQUIRY',
  closed_reason text,
  is_customer boolean not null default false,
  consent_status text not null default 'unknown' check (consent_status in ('granted','denied','unknown','withdrawn')),
  consent_at timestamptz,
  source_l1 text not null, source_l2 text, source_l3 text, source_l4 text,
  added_by uuid references public.users(id),
  import_batch_id uuid,
  referral_code text,
  tags text[] not null default '{}',
  custom jsonb not null default '{}',
  -- projection, maintained only by app.project_activity / app.refresh_next_followup (AL-2)
  first_touch_at timestamptz, last_worked_at timestamptz, last_activity_at timestamptz,
  attempts int not null default 0, total_calls int not null default 0,
  last_call_at timestamptz, last_note_at timestamptz,
  last_disposition_id uuid references public.dispositions(id), last_disposition_at timestamptz,
  next_followup_at timestamptz, next_followup_origin text,
  times_re_engaged int not null default 0, last_repeat_enquiry_at timestamptz,
  anonymised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- LT-3 backstop: one lead per parent per centre, even under concurrent ingestion
  unique (current_centre_id, parent_identity_id)
);
create index on public.leads (org_id, created_at desc, id desc);
create index on public.leads (current_centre_id, created_at desc, id desc);
create index on public.leads (district_id, created_at desc, id desc);
create index on public.leads (origin_centre_id);
create index on public.leads (owner_user_id, lifecycle);
create index on public.leads (current_centre_id, lifecycle, created_at desc);
create index on public.leads (current_centre_id, next_followup_at) where next_followup_at is not null;
create index on public.leads (org_id, lifecycle, created_at desc);
create index on public.leads (org_id, source_l1, source_l2);
create index on public.leads (source_l3) where source_l3 is not null;
create index on public.leads (source_l4) where source_l4 is not null;
create index on public.leads (last_disposition_id);
create index on public.leads (updated_at);
create index on public.leads (import_batch_id) where import_batch_id is not null;
create index on public.leads (parent_identity_id);
create index on public.leads (current_centre_id) where owner_user_id is null;
create index on public.leads using gin (tags);
create index on public.leads using gin (name gin_trgm_ops);

create function app.origin_immutable() returns trigger language plpgsql as $$
begin
  if new.origin_centre_id is distinct from old.origin_centre_id then
    raise exception 'origin_centre_id never changes (TR-1)' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger leads_origin_immutable before update on public.leads for each row execute function app.origin_immutable();

create table public.lead_phones (
  lead_id uuid not null references public.leads(id),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (lead_id, phone_e164)
);
create index on public.lead_phones (phone_e164);
create index on public.lead_phones using gin (phone_e164 gin_trgm_ops);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  district_id uuid, centre_id uuid,          -- stamp of where it was recorded; visibility follows the lead
  lead_id uuid not null references public.leads(id),
  name text not null,
  grade int check (grade between 8 and 12),
  stream text check (stream in ('PCMB','PCMC','Commerce')),
  school text, board text, subjects text[] not null default '{}',
  academic_year text, access_end_date date,
  created_at timestamptz not null default now(),
  check (stream is null or grade in (11, 12))
);
create index on public.students (lead_id);

create table public.consents (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id),
  lead_id uuid not null references public.leads(id),
  status text not null check (status in ('granted','denied','unknown','withdrawn')),
  source text not null,
  evidence jsonb not null default '{}',
  captured_at timestamptz not null default now()
);
create index on public.consents (lead_id);

create table public.dnc (
  org_id uuid not null references public.orgs(id),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  reason text not null,
  added_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  primary key (org_id, phone_e164)
);

-- HQ-only. `first_lead_id` = first touch: the lead for this parent identity with the earliest created_at in the org.
create table public.conflicts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  parent_identity_id uuid not null references public.parent_identities(id),
  first_lead_id uuid not null references public.leads(id),
  new_lead_id uuid not null references public.leads(id) unique,
  status text not null check (status in ('open','auto_resolved','resolved')),
  resolution text check (resolution in ('keep_first','move_to_second','share_credit')),
  credited_centre_ids uuid[] not null default '{}',
  resolved_by uuid references public.users(id), resolved_at timestamptz, note text,
  created_at timestamptz not null default now()
);
create index on public.conflicts (org_id, status, created_at desc);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  district_id uuid references public.districts(id),
  centre_id uuid references public.centres(id),
  name text not null, description text,
  kind text not null default 'static' check (kind in ('static','dynamic')),
  origin text not null default 'manual' check (origin in ('manual','upload','page','form')),
  owner_user_id uuid references public.users(id),
  allow_duplicate boolean not null default false,
  disallow_auto_rechurn boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.lists (centre_id);
create index on public.lists (org_id);
create table public.list_members (
  list_id uuid not null references public.lists(id),
  lead_id uuid not null references public.leads(id),
  added_at timestamptz not null default now(),
  primary key (list_id, lead_id)
);
create index on public.list_members (lead_id);

-- ---------------------------------------------------------------- visibility
create function app.centre_shows_all() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select counsellor_lead_visibility = 'all' from public.centres where id = app.centre_id()), false)
$$;

-- THE lead scope rule. Used by the RLS policy, the read views and every write function.
create function app.can_see_lead(row_org uuid, row_district uuid, row_centre uuid, row_owner uuid)
returns boolean language sql stable as $$
  select coalesce(row_org = app.org_id() and case app.role()
    when 'SUPERADMIN' then true
    when 'HQ_ADMIN' then true
    when 'HQ_COUNSELLOR' then row_owner = app.uid()          -- HQ teams are not modelled yet: own leads only
    when 'DISTRICT_MANAGER' then row_district = app.district_id()
    when 'CENTRE_ADMIN' then row_centre = app.centre_id()
    when 'COUNSELLOR' then row_centre = app.centre_id() and (row_owner = app.uid() or app.centre_shows_all())
    else false end, false)
$$;

create function app.mask_phone(p text) returns text language sql immutable as $$
  select case when p is null then null else left(p, 3) || repeat('•', greatest(length(p) - 7, 0)) || right(p, 4) end
$$;

alter table public.leads enable row level security;
alter table public.lead_phones enable row level security;
alter table public.students enable row level security;
alter table public.consents enable row level security;
alter table public.dnc enable row level security;
alter table public.conflicts enable row level security;
alter table public.lists enable row level security;
alter table public.list_members enable row level security;

-- `authenticated` has NO privilege on leads / lead_phones: no insert, no update, not even select.
-- Reads go through these views, which apply the scope rule and the privacy toggles (TEN-8).
-- Writes go through app.* functions. The policy exists so a future accidental GRANT still fails closed.
create policy leads_read on public.leads for select to authenticated
  using (app.can_see_lead(org_id, district_id, current_centre_id, owner_user_id));

-- ponytail: has_perm() is evaluated per row (3 PK lookups). Fine for pages and exports;
-- move the flags into session claims if profiling ever shows it.
create view public.lead_list with (security_barrier) as
  select l.id, l.org_id, l.district_id, l.current_centre_id, l.origin_centre_id, l.owner_user_id, l.assigned_at, l.assign_status,
         l.name,
         case when app.has_perm('leads.view_phone') then l.primary_phone else app.mask_phone(l.primary_phone) end as primary_phone,
         case when app.has_perm('leads.view_phone') then l.email end as email,
         l.country, l.state, l.city, l.timezone, l.language, l.lifecycle, l.closed_reason, l.is_customer,
         l.consent_status, l.consent_at,
         case when app.has_perm('leads.view_source') then l.source_l1 end as source_l1,
         case when app.has_perm('leads.view_source') then l.source_l2 end as source_l2,
         case when app.has_perm('leads.view_source') then l.source_l3 end as source_l3,
         case when app.has_perm('leads.view_source') then l.source_l4 end as source_l4,
         l.added_by, l.import_batch_id, l.tags, l.custom,
         l.first_touch_at, l.last_worked_at, l.last_activity_at, l.attempts, l.total_calls, l.last_call_at, l.last_note_at,
         l.last_disposition_id, l.last_disposition_at, l.next_followup_at, l.next_followup_origin,
         l.times_re_engaged, l.last_repeat_enquiry_at, l.anonymised_at, l.created_at, l.updated_at
  from public.leads l
  where app.can_see_lead(l.org_id, l.district_id, l.current_centre_id, l.owner_user_id);

create view public.lead_phone_list with (security_barrier) as
  select p.lead_id, p.is_primary,
         case when app.has_perm('leads.view_phone') then p.phone_e164 else app.mask_phone(p.phone_e164) end as phone_e164
  from public.lead_phones p join public.leads l on l.id = p.lead_id
  where app.can_see_lead(l.org_id, l.district_id, l.current_centre_id, l.owner_user_id);

grant select on public.lead_list, public.lead_phone_list to authenticated;
grant select on public.students, public.consents, public.dnc, public.conflicts, public.lists, public.list_members to authenticated;

create function app.lead_visible(p_lead uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select from public.leads l where l.id = p_lead
                 and app.can_see_lead(l.org_id, l.district_id, l.current_centre_id, l.owner_user_id))
$$;

create policy students_read on public.students for select to authenticated using (app.lead_visible(lead_id));
create policy consents_read on public.consents for select to authenticated using (app.lead_visible(lead_id));
create policy dnc_read on public.dnc for select to authenticated using (org_id = app.org_id() and app.has_perm('dnc.manage'));
create policy conflicts_read on public.conflicts for select to authenticated using (org_id = app.org_id() and app.has_perm('conflicts.resolve'));
create policy lists_read on public.lists for select to authenticated using (app.can_see(org_id, district_id, centre_id));
create policy list_members_read on public.list_members for select to authenticated using (app.lead_visible(lead_id));

-- Phone search without exposing lead_phones; partial matches need the unmasked-phone permission.
create function app.search_lead_ids_by_phone(p_digits text) returns setof uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p.lead_id from public.lead_phones p join public.leads l on l.id = p.lead_id
  where p_digits ~ '^[0-9]{4,15}$' and app.has_perm('leads.view_phone')
    and p.phone_e164 like '%' || p_digits || '%'
    and app.can_see_lead(l.org_id, l.district_id, l.current_centre_id, l.owner_user_id)
$$;
revoke all on function app.search_lead_ids_by_phone(text), app.lead_visible(uuid), app.centre_shows_all() from public;
grant execute on function app.search_lead_ids_by_phone(text), app.lead_visible(uuid), app.centre_shows_all() to authenticated;

-- the table-level unique treats NULL centres as distinct; this covers the HQ pool
create unique index leads_hq_pool_dedupe on public.leads (org_id, parent_identity_id)
  where current_centre_id is null and parent_identity_id is not null;
