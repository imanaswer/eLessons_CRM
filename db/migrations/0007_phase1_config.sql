create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- Policy knobs are data (brief s9, s13; PRD open questions)
alter table public.orgs
  add column cross_centre_policy text not null default 'first_touch_wins' check (cross_centre_policy in ('first_touch_wins','hq_decides')),
  add column cadence_days int[] not null default '{0,1,3,7,14,30}',      -- TE-2: max attempts = array length
  add column max_event_retries int not null default 5 check (max_event_retries >= 0);
alter table public.centres add column default_country char(2) not null default 'IN';
alter table public.users add column last_assigned_at timestamptz;          -- round-robin cursor

insert into public.permissions (key, grp, description) values
  ('leads.create',  'data_operations', 'Enter leads'),
  ('leads.import',  'data_operations', 'Bulk upload leads'),
  ('leads.delete',  'data_operations', 'Erase (anonymise) a lead'),
  ('leads.view_other_centre_activity', 'privacy', 'See activity recorded by another centre before a transfer'),
  ('exports.unmasked_phone', 'privacy', 'Exports contain full phone numbers'),
  ('conflicts.resolve', 'assignment', 'See and resolve cross-centre conflicts'),
  ('inbound.replay', 'administration', 'Replay failed inbound events'),
  ('dnc.manage', 'administration', 'Manage the Do Not Contact registry'),
  ('config.manage', 'administration', 'Edit dispositions and lead configuration');

-- Default matrix, replacing the 0006 version. Per-org rows stay editable by Superadmin.
create or replace function app.seed_default_role_permissions(p_org uuid) returns void language sql as $$
  insert into public.role_permissions (org_id, role, permission_key, allowed)
  select p_org, r.role, p.key, p.key = any (case r.role
      when 'SUPERADMIN' then (select array_agg(key) from public.permissions)
      when 'HQ_ADMIN' then (select array_agg(key) from public.permissions)
      when 'HQ_COUNSELLOR' then array['leads.create','leads.view_phone','leads.view_source','leads.view_prior_activity']
      when 'DISTRICT_MANAGER' then array['audit.view','leads.create','leads.import','leads.export','leads.bulk_select','leads.assign','leads.transfer',
           'leads.view_phone','leads.view_source','leads.view_prior_activity','leads.view_other_owners','leads.view_other_centre_activity']
      when 'CENTRE_ADMIN' then array['users.manage','audit.view','leads.create','leads.import','leads.delete','leads.assign','leads.bulk_select',
           'leads.view_phone','leads.view_source','leads.view_prior_activity','leads.view_other_owners']
      when 'COUNSELLOR' then array['leads.create','leads.view_phone','leads.view_source','leads.view_prior_activity']
    end)
  from public.permissions p cross join (select unnest(enum_range(null::public.app_role)) as role) r
  on conflict do nothing
$$;
-- existing orgs: add the new keys; within-centre history is visible by default, other-centre history is not
select app.seed_default_role_permissions(id) from public.orgs;
update public.role_permissions set allowed = true
  where permission_key = 'leads.view_prior_activity' and role in ('CENTRE_ADMIN','COUNSELLOR');

create type public.lifecycle as enum ('ENQUIRY','PROSPECT','INTERESTED','DEAD','ENROLLED');

-- TE-1: dispositions are configuration. `effect` is the only thing that can move lifecycle.
create table public.dispositions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  name text not null,
  sentiment text not null check (sentiment in ('positive','neutral','negative','junk')),
  effect text not null default 'none' check (effect in ('none','to_interested','to_dead','to_enrolled')),
  note_required boolean not null default false,
  followup text not null default 'cadence' check (followup in ('none','cadence','days','user')),
  followup_days int check ((followup = 'days') = (followup_days is not null)),
  creates_deal boolean not null default false,       -- acted on from Phase 4 (deals)
  add_tag text,
  sort int not null default 0,
  is_active boolean not null default true,
  unique (org_id, name)
);
alter table public.dispositions enable row level security;
grant select, insert, update on public.dispositions to authenticated;
create policy disp_read on public.dispositions for select to authenticated using (org_id = app.org_id());
create policy disp_insert on public.dispositions for insert to authenticated
  with check (org_id = app.org_id() and app.has_perm('config.manage') and not app.read_only());
create policy disp_update on public.dispositions for update to authenticated
  using (org_id = app.org_id() and app.has_perm('config.manage') and not app.read_only()) with check (org_id = app.org_id());
create trigger audit_dispositions after insert or update on public.dispositions for each row execute function app.audit_row_change();

create function app.seed_default_dispositions(p_org uuid) returns void language sql as $$
  insert into public.dispositions (org_id, name, sentiment, effect, followup, followup_days, creates_deal, add_tag, note_required, sort) values
    (p_org,'Interested','positive','to_interested','cadence',null,true,null,false,1),
    (p_org,'Demo requested','positive','none','days',1,false,null,false,2),
    (p_org,'Will watch demo','neutral','none','days',2,false,null,false,3),
    (p_org,'Parent to discuss at home','neutral','none','cadence',null,false,null,false,4),
    (p_org,'Need details','neutral','none','cadence',null,false,null,false,5),
    (p_org,'Call back later','neutral','none','user',null,false,null,false,6),
    (p_org,'Not reachable','neutral','none','cadence',null,false,null,false,7),
    (p_org,'Price concern','neutral','none','cadence',null,false,'price-concern',false,8),
    (p_org,'Wants live classes','negative','to_dead','none',null,false,null,false,9),
    (p_org,'Already has tuition','negative','to_dead','none',null,false,null,false,10),
    (p_org,'Not interested','negative','to_dead','none',null,false,null,true,11),
    (p_org,'Not CBSE or wrong grade','junk','to_dead','none',null,false,null,false,12),
    (p_org,'Wrong number','junk','to_dead','none',null,false,null,false,13),
    (p_org,'Enrolled','positive','to_enrolled','none',null,false,null,false,14)
  on conflict do nothing
$$;
revoke all on function app.seed_default_dispositions(uuid) from public;
select app.seed_default_dispositions(id) from public.orgs;
