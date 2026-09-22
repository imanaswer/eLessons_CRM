-- PHASE 3: connector framework, per-centre Meta, routing rules, coverage, referral, site events, gate v2.

-- ---- default permission matrix becomes data (it was a CASE expression rewritten in every phase)
create table public.permission_defaults (role public.app_role not null, permission_key text not null references public.permissions(key), primary key (role, permission_key));
insert into public.permissions (key, grp, description) values
  ('integrations.manage', 'administration', 'Connect and configure integrations within own scope'),
  ('routing.manage',      'assignment',     'Edit HQ distribution rules'),
  ('deals.manage',        'data_operations','Create and move deals'),
  ('catalogue.manage',    'administration', 'Edit catalogue and prices'),
  ('conversations.send',  'communication',  'Send WhatsApp messages'),
  ('broadcasts.manage',   'communication',  'Create broadcasts and templates'),
  ('automation.manage',   'administration', 'Create automation rules within own scope'),
  ('reports.payouts',     'data_operations','See centre payout report'),
  ('leads.merge',         'data_operations','Merge two leads');
insert into public.permission_defaults
  select r.role, p.key from public.permissions p cross join (select unnest(enum_range(null::public.app_role)) role) r
  where r.role in ('SUPERADMIN','HQ_ADMIN')
     or (r.role = 'HQ_COUNSELLOR' and p.key in ('leads.create','leads.view_phone','leads.view_source','leads.view_prior_activity','deals.manage','conversations.send'))
     or (r.role = 'DISTRICT_MANAGER' and p.key in ('audit.view','leads.create','leads.import','leads.export','leads.bulk_select','leads.assign','leads.transfer','leads.view_phone',
           'leads.view_source','leads.view_prior_activity','leads.view_other_owners','leads.view_other_centre_activity','deals.manage','reports.payouts'))
     or (r.role = 'CENTRE_ADMIN' and p.key in ('users.manage','audit.view','leads.create','leads.import','leads.delete','leads.assign','leads.bulk_select','leads.view_phone','leads.view_source',
           'leads.view_prior_activity','leads.view_other_owners','integrations.manage','deals.manage','conversations.send','automation.manage','reports.payouts','leads.merge'))
     or (r.role = 'COUNSELLOR' and p.key in ('leads.create','leads.view_phone','leads.view_source','leads.view_prior_activity','deals.manage','conversations.send'));
create or replace function app.seed_default_role_permissions(p_org uuid) returns void language sql as $$
  insert into public.role_permissions (org_id, role, permission_key, allowed)
  select p_org, r.role, p.key, exists (select from public.permission_defaults d where d.role = r.role and d.permission_key = p.key)
  from public.permissions p cross join (select unnest(enum_range(null::public.app_role)) as role) r
  on conflict do nothing
$$;
select app.seed_default_role_permissions(id) from public.orgs;
alter table public.permission_defaults enable row level security;

-- ---- connections (PRD s9: Connect / Receive / Map / Health)
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  district_id uuid references public.districts(id),
  centre_id uuid references public.centres(id),              -- NULL = HQ-scoped connector
  kind text not null check (kind in ('meta_page','api','website','lms','payment','google_ads','whatsapp','outbound_webhook')),
  name text not null,
  status text not null default 'pending' check (status in ('pending','connected','error','disabled')),
  external_id text,                                          -- Meta page id / WhatsApp phone_number_id
  meta_business_id text,
  secret_enc text,                                           -- AES-256-GCM(ENCRYPTION_KEY): page token / signing secret. Never selectable by tenant roles.
  api_key_hash text unique,                                  -- sha256 of the bearer key; the key itself is shown once
  token_expires_at timestamptz,
  config jsonb not null default '{}',                        -- non-secret: ad_account_id, pixel_id, pending page list, url...
  last_event_at timestamptz, last_error text, last_error_at timestamptz, last_success_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- MT-2: a page maps to exactly one centre. This index IS the routing table.
create unique index connections_external on public.connections (kind, external_id) where external_id is not null and status <> 'disabled';
create index on public.connections (centre_id); create index on public.connections (org_id, kind);
alter table public.inbound_events add foreign key (connector_id) references public.connections(id);
alter table public.inbound_events drop constraint inbound_events_outcome_check,
  add constraint inbound_events_outcome_check check (outcome in ('created','duplicate','rechurned','dnc','invalid','event','payment','message','ignored'));

create table public.connection_forms (
  connection_id uuid not null references public.connections(id), form_id text not null, name text not null, status text,
  list_id uuid references public.lists(id), last_synced_at timestamptz not null default now(), primary key (connection_id, form_id)
);
create table public.field_mappings (
  connection_id uuid not null references public.connections(id), form_id text not null default '',
  mapping jsonb not null, updated_by uuid references public.users(id), updated_at timestamptz not null default now(), primary key (connection_id, form_id)
);

alter table public.connections enable row level security;
alter table public.connection_forms enable row level security;
alter table public.field_mappings enable row level security;
grant select (id, org_id, district_id, centre_id, kind, name, status, external_id, meta_business_id, token_expires_at, config,
              last_event_at, last_error, last_error_at, last_success_at, created_by, created_at, updated_at) on public.connections to authenticated;
grant select on public.connection_forms, public.field_mappings to authenticated;
grant select on public.connections to elessons_worker;
-- IN-3: a centre sees only its own connections; IN-2: HQ sees all. Counsellors see none.
create policy conn_read on public.connections for select to authenticated
  using (app.can_see(org_id, district_id, centre_id) and app.role() in ('SUPERADMIN','HQ_ADMIN','DISTRICT_MANAGER','CENTRE_ADMIN'));
create policy conn_forms_read on public.connection_forms for select to authenticated using (exists (select from public.connections c where c.id = connection_id));
create policy conn_map_read on public.field_mappings for select to authenticated using (exists (select from public.connections c where c.id = connection_id));
create trigger audit_connections after insert or update of status, centre_id, external_id, name on public.connections for each row execute function app.audit_row_change();

-- takes columns, not the row: a whole-row reference would need SELECT on secret_enc, which tenant roles do not have
create function app.connection_state(p_status text, p_config jsonb, p_expires timestamptz, p_error_at timestamptz, p_success_at timestamptz, p_event_at timestamptz)
returns text language sql stable as $$
  select case
    when p_status = 'disabled' then 'Not connected'
    when p_status = 'pending' then case when p_config ? 'pages' then 'Mapping pending' else 'Configured' end
    when p_status = 'error' or p_expires <= now() then 'Reconnect'
    when p_expires <= now() + interval '7 days' then 'Action needed'            -- MT-4
    when p_error_at is not null and p_error_at > coalesce(p_success_at, '-infinity') then 'Action needed'
    when p_event_at is null then 'No events yet'
    when p_event_at < now() - make_interval(days => coalesce((p_config->>'stale_after_days')::int, 7)) then 'Stale'
    else 'Healthy' end
$$;

-- scope check shared by every connection write
create function app.conn_for_write(p_conn uuid) returns public.connections language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.connections;
begin
  select * into c from public.connections where id = p_conn for update;
  if c.id is null or app.read_only() or not app.has_perm('integrations.manage') or not app.can_see(c.org_id, c.district_id, c.centre_id)
     or (c.centre_id is null and not app.is_hq()) then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  return c;
end $$;

create function app.create_connection(p_kind text, p_name text, p_centre uuid, p_secret_enc text default null, p_api_key_hash text default null, p_config jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_centre uuid := p_centre; c public.centres; v_id uuid;
begin
  if app.read_only() or not app.has_perm('integrations.manage') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  if app.role() = 'CENTRE_ADMIN' then v_centre := app.centre_id(); end if;
  if v_centre is null and not app.is_hq() then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  if v_centre is not null then
    select * into c from public.centres x where x.id = v_centre and x.is_active and app.can_see(x.org_id, x.district_id, x.id);
    if c.id is null then raise exception 'CENTRE_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  insert into public.connections (org_id, district_id, centre_id, kind, name, secret_enc, api_key_hash, config, created_by,
                                  status)
  values (app.org_id(), c.district_id, v_centre, p_kind, trim(p_name), p_secret_enc, p_api_key_hash, coalesce(p_config, '{}'), app.uid(),
          case when p_kind = 'meta_page' then 'pending' else 'connected' end) returning id into v_id;
  return v_id;
end $$;

-- Page selected after OAuth: bind page -> centre, store the encrypted PAGE token.
create function app.connect_meta_page(p_conn uuid, p_page_id text, p_page_name text, p_secret_enc text, p_expires timestamptz, p_business_id text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.connections := app.conn_for_write(p_conn);
begin
  if exists (select from public.connections x where x.kind = 'meta_page' and x.external_id = p_page_id and x.status <> 'disabled' and x.id <> p_conn) then
    raise exception 'PAGE_ALREADY_CONNECTED' using errcode = 'P0001';
  end if;
  update public.connections set external_id = p_page_id, name = p_page_name, secret_enc = p_secret_enc, token_expires_at = p_expires, meta_business_id = p_business_id,
         status = 'connected', config = config - 'pages', last_error = null, last_error_at = null, updated_at = now() where id = p_conn;
  perform app.audit('meta.page_connected', 'connections', p_conn::text, jsonb_build_object('page_id', p_page_id, 'page', p_page_name), c.centre_id, c.district_id);
end $$;

create function app.update_connection(p_conn uuid, p_patch jsonb) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.connections := app.conn_for_write(p_conn);
begin
  update public.connections set
    status = coalesce(p_patch->>'status', status), name = coalesce(p_patch->>'name', name),
    secret_enc = coalesce(p_patch->>'secret_enc', secret_enc), token_expires_at = coalesce((p_patch->>'token_expires_at')::timestamptz, token_expires_at),
    config = config || coalesce(p_patch->'config', '{}'), updated_at = now() where id = p_conn;
  perform app.audit('integration.changed', 'connections', p_conn::text, p_patch - 'secret_enc', c.centre_id, c.district_id);
end $$;

create function app.save_forms(p_conn uuid, p_forms jsonb) returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.connections := app.conn_for_write(p_conn); f jsonb; v_list uuid; n int := 0;
begin
  for f in select * from jsonb_array_elements(p_forms) loop
    if not exists (select from public.connection_forms where connection_id = p_conn and form_id = f->>'id') then
      insert into public.lists (org_id, district_id, centre_id, name, description, origin, owner_user_id)     -- MT-3 / LS-3: each form creates a list
      values (c.org_id, c.district_id, c.centre_id, 'Form: ' || (f->>'name'), 'Created automatically from a Meta lead form', 'form', app.uid()) returning id into v_list;
      insert into public.connection_forms (connection_id, form_id, name, status, list_id) values (p_conn, f->>'id', f->>'name', f->>'status', v_list);
      n := n + 1;
    else
      update public.connection_forms set name = f->>'name', status = f->>'status', last_synced_at = now() where connection_id = p_conn and form_id = f->>'id';
    end if;
  end loop;
  return n;
end $$;

create function app.save_mapping(p_conn uuid, p_form text, p_mapping jsonb) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.connections := app.conn_for_write(p_conn);
begin
  insert into public.field_mappings (connection_id, form_id, mapping, updated_by) values (p_conn, coalesce(p_form, ''), p_mapping, app.uid())
  on conflict (connection_id, form_id) do update set mapping = excluded.mapping, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ciphertext only; useless without ENCRYPTION_KEY, which lives in the server environment
create function app.connection_secret(p_conn uuid) returns text language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.connections := app.conn_for_write(p_conn); begin return c.secret_enc; end $$;

-- ---- external intake: called by webhook route handlers AFTER signature verification; no user session exists there
create function app.receive_external_event(p_kind text, p_external_id text, p_api_key_hash text, p_channel text, p_idempotency_key text,
                                           p_payload jsonb, p_event_external_id text default null)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.connections; v_org uuid; v_id uuid; v_pending boolean := false;
begin
  if p_api_key_hash is not null then select * into c from public.connections where api_key_hash = p_api_key_hash and status <> 'disabled';
  else select * into c from public.connections where kind = p_kind and external_id = p_external_id and status <> 'disabled'; end if;
  if c.id is null then
    if p_api_key_hash is not null then return null; end if;              -- unknown key: caller answers 401
    -- A signed Meta/WhatsApp event for a page nobody has mapped yet is still never dropped: keep it (single-org deployments),
    -- visible to HQ as failed "mapping pending", replayable once the page is connected.
    select id into v_org from public.orgs limit 2; if (select count(*) from public.orgs) <> 1 then return null; end if;
    v_pending := true;
  end if;
  if c.id is not null and c.centre_id is not null and not exists (select from public.centres x where x.id = c.centre_id and x.accepts_inbound) then
    v_pending := true;                                                   -- deactivated centre: HQ decides what to do with it
  end if;
  insert into public.inbound_events (org_id, district_id, centre_id, connector_id, channel, external_event_id, idempotency_key, payload, processing_status, error, next_retry_at)
  values (coalesce(c.org_id, v_org), case when v_pending then null else c.district_id end, case when v_pending then null else c.centre_id end, c.id, p_channel,
          p_event_external_id, p_idempotency_key, p_payload, case when v_pending then 'dead' else 'pending' end,
          case when v_pending then 'MAPPING_PENDING: no active centre is connected for this source. Connect it, then retry.' end, now())
  on conflict (org_id, idempotency_key) do nothing returning id into v_id;
  if c.id is not null then update public.connections set last_event_at = now() where id = c.id; end if;
  return coalesce(v_id, (select id from public.inbound_events where org_id = coalesce(c.org_id, v_org) and idempotency_key = p_idempotency_key));
end $$;

create function app.connection_result(p_conn uuid, p_error text) returns void language sql security definer set search_path = public, pg_temp as $$
  update public.connections set last_error = left(p_error, 500), last_error_at = case when p_error is null then last_error_at else now() end,
         last_success_at = case when p_error is null then now() else last_success_at end,
         status = case when p_error ilike '%OAuthException%' or p_error ilike '%access token%' then 'error' else status end where id = p_conn
$$;

-- ---- four-level source registry + HQ distribution rules (AS-2..5)
create table public.sources (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id),
  l1 text not null, l2 text not null default '', hq_scoped boolean not null, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  lead_count int not null default 0, unique (org_id, l1, l2, hq_scoped)
);
alter table public.sources enable row level security;
grant select on public.sources to authenticated;
create policy sources_read on public.sources for select to authenticated using (org_id = app.org_id() and app.is_hq());

alter table public.orgs add column fallback_centre_id uuid references public.centres(id), add column fallback_owner_id uuid references public.users(id);
create table public.distribution_rules (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id),
  name text not null, priority int not null default 100, is_active boolean not null default true,
  conditions jsonb not null default '[]',                     -- [{field, op: eq|neq|in, value}]  ALL must match
  method text not null check (method in ('round_robin_centres','round_robin_users')),
  target_centre_ids uuid[] not null default '{}', target_user_ids uuid[] not null default '{}',
  rr_cursor int not null default 0, created_by uuid references public.users(id), created_at timestamptz not null default now(),
  check ((method = 'round_robin_centres' and cardinality(target_centre_ids) > 0) or (method = 'round_robin_users' and cardinality(target_user_ids) > 0))
);
create index on public.distribution_rules (org_id, priority) where is_active;
alter table public.distribution_rules enable row level security;
grant select, insert, update on public.distribution_rules to authenticated;
create policy dr_read on public.distribution_rules for select to authenticated using (org_id = app.org_id() and app.is_hq());
create policy dr_insert on public.distribution_rules for insert to authenticated with check (org_id = app.org_id() and app.has_perm('routing.manage') and not app.read_only());
create policy dr_update on public.distribution_rules for update to authenticated using (org_id = app.org_id() and app.has_perm('routing.manage') and not app.read_only()) with check (org_id = app.org_id());
create trigger audit_distribution_rules after insert or update of name, priority, is_active, conditions, method, target_centre_ids, target_user_ids on public.distribution_rules
  for each row execute function app.audit_row_change();

create function app.lead_field(p_lead jsonb, p_field text) returns text language sql immutable as $$
  select lower(case p_field
    when 'country' then p_lead->>'country' when 'state' then p_lead->>'state' when 'city' then p_lead->>'city'
    when 'source' then p_lead#>>'{source,l1}' when 'page' then p_lead#>>'{source,l2}' when 'campaign' then p_lead#>>'{source,l3}' when 'form' then p_lead#>>'{source,l4}'
    when 'grade' then p_lead#>>'{students,0,grade}' when 'language' then p_lead->>'language'
    else case when p_field like 'custom.%' then p_lead#>>array['custom', substr(p_field, 8)] end end)
$$;

-- p_advance = false is the "Where would this lead go?" tool (AS-5): same code path, no side effects.
create function app.route_lead(p_org uuid, p_lead jsonb, p_advance boolean) returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.distribution_rules; k jsonb; v text; ok boolean; n int; i int; v_centre uuid; v_user uuid; o public.orgs;
begin
  for r in select * from public.distribution_rules where org_id = p_org and is_active order by priority, created_at for update loop
    ok := true;
    for k in select * from jsonb_array_elements(r.conditions) loop
      v := app.lead_field(p_lead, k->>'field');
      ok := ok and case k->>'op'
        when 'eq' then v is not distinct from lower(k->>'value')
        when 'neq' then v is distinct from lower(k->>'value')
        when 'in' then v in (select lower(x) from jsonb_array_elements_text(case jsonb_typeof(k->'value') when 'array' then k->'value' else '[]' end) x)
        else false end;
      exit when not ok;
    end loop;
    continue when not ok;
    if r.method = 'round_robin_centres' then
      n := cardinality(r.target_centre_ids);
      for i in 0 .. n - 1 loop      -- skip centres that stopped accepting leads
        select id into v_centre from public.centres where id = r.target_centre_ids[1 + (r.rr_cursor + i) % n] and is_active and accepts_inbound;
        if v_centre is not null then
          if p_advance then update public.distribution_rules set rr_cursor = (r.rr_cursor + i + 1) % n where id = r.id; end if;
          return jsonb_build_object('rule_id', r.id, 'rule', r.name, 'centre_id', v_centre, 'owner_user_id', null);
        end if;
      end loop;
    else
      n := cardinality(r.target_user_ids);
      for i in 0 .. n - 1 loop
        select id, centre_id into v_user, v_centre from public.users where id = r.target_user_ids[1 + (r.rr_cursor + i) % n] and is_active;
        if v_user is not null then
          if p_advance then update public.distribution_rules set rr_cursor = (r.rr_cursor + i + 1) % n where id = r.id; end if;
          return jsonb_build_object('rule_id', r.id, 'rule', r.name, 'centre_id', v_centre, 'owner_user_id', v_user);
        end if;
      end loop;
    end if;
  end loop;
  select * into o from public.orgs where id = p_org;
  if o.fallback_centre_id is not null or o.fallback_owner_id is not null then
    return jsonb_build_object('rule_id', null, 'rule', 'Fallback owner', 'centre_id', coalesce(o.fallback_centre_id, (select centre_id from public.users where id = o.fallback_owner_id)), 'owner_user_id', o.fallback_owner_id);
  end if;
  return jsonb_build_object('rule_id', null, 'rule', null, 'centre_id', null, 'owner_user_id', null);      -- stays in the HQ pool, unassigned
end $$;

create function app.route_preview(p_lead jsonb) returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_hq() then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  return app.route_lead(app.org_id(), p_lead, false);
end $$;

-- AS-5 coverage: every HQ-scoped source, and the rule (if any) a lead from it would hit.
create function app.coverage() returns table (l1 text, l2 text, lead_count int, last_seen_at timestamptz, rule text) language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_hq() then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  return query select s.l1, s.l2, s.lead_count, s.last_seen_at,
      app.route_lead(s.org_id, jsonb_build_object('source', jsonb_build_object('l1', s.l1, 'l2', s.l2)), false)->>'rule'
    from public.sources s where s.org_id = app.org_id() and s.hq_scoped order by 5 nulls first, s.lead_count desc;
end $$;

-- ---- referral (EL-1..3)
create table public.referral_codes (
  centre_id uuid primary key references public.centres(id), org_id uuid not null references public.orgs(id),
  code text not null unique, coupon_code text unique, is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.referral_touches (
  id bigint generated always as identity primary key, org_id uuid not null references public.orgs(id),
  parent_identity_id uuid not null references public.parent_identities(id), centre_id uuid not null references public.centres(id),
  code text not null, touched_at timestamptz not null default now()
);
create index on public.referral_touches (parent_identity_id, touched_at);
alter table public.referral_codes enable row level security; alter table public.referral_touches enable row level security;
grant select on public.referral_codes to authenticated;
create policy ref_read on public.referral_codes for select to authenticated using (exists (select from public.centres c where c.id = centre_id));
create function app.centre_referral_code() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin insert into public.referral_codes (centre_id, org_id, code) values (new.id, new.org_id, new.code) on conflict do nothing; return new; end $$;
create trigger centres_referral after insert on public.centres for each row execute function app.centre_referral_code();
insert into public.referral_codes (centre_id, org_id, code) select id, org_id, code from public.centres on conflict do nothing;

create function app.set_coupon(p_centre uuid, p_coupon text) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if app.read_only() or not (app.is_hq() and app.has_perm('centres.manage')) then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  update public.referral_codes set coupon_code = nullif(upper(trim(p_coupon)), '') where centre_id = p_centre and org_id = app.org_id();
  perform app.audit('referral.coupon_changed', 'centres', p_centre::text, jsonb_build_object('coupon', p_coupon), p_centre);
end $$;

-- First referral wins inside the window (EL-3). Returns the credited centre, or NULL if the code is unknown.
create function app.resolve_referral(p_org uuid, p_identity uuid, p_code text) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_centre uuid; v_first uuid; v_days int;
begin
  select r.centre_id into v_centre from public.referral_codes r join public.centres c on c.id = r.centre_id
   where r.org_id = p_org and r.is_active and c.is_active and upper(trim(p_code)) in (r.code, r.coupon_code);
  if v_centre is null then return null; end if;
  select referral_window_days into v_days from public.orgs where id = p_org;
  select centre_id into v_first from public.referral_touches where parent_identity_id = p_identity and touched_at > now() - make_interval(days => v_days) order by touched_at limit 1;
  if v_first is null then
    insert into public.referral_touches (org_id, parent_identity_id, centre_id, code) values (p_org, p_identity, v_centre, upper(trim(p_code)));
    return v_centre;
  end if;
  return v_first;
end $$;

do $$ declare f text; begin
  foreach f in array array['app.conn_for_write(uuid)', 'app.route_lead(uuid, jsonb, boolean)', 'app.resolve_referral(uuid, uuid, text)'] loop
    execute format('revoke all on function %s from public', f); end loop;
  foreach f in array array['app.create_connection(text, text, uuid, text, text, jsonb)', 'app.connect_meta_page(uuid, text, text, text, timestamptz, text)', 'app.update_connection(uuid, jsonb)',
    'app.save_forms(uuid, jsonb)', 'app.save_mapping(uuid, text, jsonb)', 'app.connection_secret(uuid)', 'app.route_preview(jsonb)', 'app.coverage()', 'app.set_coupon(uuid, text)'] loop
    execute format('revoke all on function %s from public', f); execute format('grant execute on function %s to authenticated', f); end loop;
  execute 'revoke all on function app.receive_external_event(text, text, text, text, text, jsonb, text) from public';
  execute 'grant execute on function app.receive_external_event(text, text, text, text, text, jsonb, text) to elessons_app, elessons_worker';
  execute 'revoke all on function app.connection_result(uuid, text) from public';
  execute 'grant execute on function app.connection_result(uuid, text) to elessons_worker, authenticated';
end $$;

create view public.connection_list with (security_invoker = true) as
  select c.id, c.org_id, c.district_id, c.centre_id, c.kind, c.name, c.status, c.external_id, c.token_expires_at, c.config, c.last_event_at, c.last_error, c.last_error_at,
         c.created_at, app.connection_state(c.status, c.config, c.token_expires_at, c.last_error_at, c.last_success_at, c.last_event_at) as state, x.code as centre_code
  from public.connections c left join public.centres x on x.id = c.centre_id;
grant select on public.connection_list to authenticated;
