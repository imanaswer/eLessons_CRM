grant authenticated to elessons_worker;    -- so the worker can drop to a user's RLS scope for exports

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  district_id uuid references public.districts(id),
  centre_id uuid references public.centres(id),
  created_by uuid not null references public.users(id),
  filename text not null,
  headers text[] not null,
  mapping jsonb,
  list_id uuid references public.lists(id),
  row_count int not null default 0,
  status text not null default 'mapping' check (status in ('mapping','processing','done')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.import_batches (centre_id, created_at desc);
alter table public.leads add foreign key (import_batch_id) references public.import_batches(id);

-- Brief s8. Every lead, from every source, exists here first.
create table public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  district_id uuid references public.districts(id),
  centre_id uuid references public.centres(id),           -- NULL = HQ-scoped source
  connector_id uuid,                                      -- FK added with `connections` in Phase 3
  channel text not null,                                  -- manual | bulk_upload | api | meta | website | ...
  external_event_id text,
  idempotency_key text not null,
  payload jsonb not null,                                 -- raw, never rewritten
  import_batch_id uuid references public.import_batches(id),
  created_by uuid references public.users(id),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'pending' check (processing_status in ('held','pending','processing','processed','failed','dead')),
  outcome text check (outcome in ('created','duplicate','rechurned','dnc','invalid')),
  lead_id uuid references public.leads(id),
  retry_count int not null default 0,
  next_retry_at timestamptz not null default now(),
  locked_at timestamptz,
  error text,
  unique (org_id, idempotency_key)
);
create index on public.inbound_events (next_retry_at) where processing_status in ('pending','failed');
create index on public.inbound_events (locked_at) where processing_status = 'processing';
create index on public.inbound_events (org_id, processing_status, received_at desc);
create index on public.inbound_events (centre_id, received_at desc);
create index on public.inbound_events (import_batch_id, outcome) where import_batch_id is not null;

alter table public.import_batches enable row level security;
alter table public.inbound_events enable row level security;
grant select on public.import_batches, public.inbound_events to authenticated;
create policy import_read on public.import_batches for select to authenticated
  using (app.can_see(org_id, district_id, centre_id) and app.has_perm('leads.import'));
-- raw payloads hold contact data: admins of the owning scope only, never counsellors
create policy inbound_read on public.inbound_events for select to authenticated
  using (app.can_see(org_id, district_id, centre_id) and app.role() in ('SUPERADMIN','HQ_ADMIN','DISTRICT_MANAGER','CENTRE_ADMIN'));

create function app.is_worker() returns boolean language sql stable as $$ select session_user = 'elessons_worker' $$;

-- Step 1 of the gate: STORE RAW. Idempotent: a repeated key returns the original event id.
create function app.receive_event(p_channel text, p_centre uuid, p_idempotency_key text, p_payload jsonb,
                                  p_external_id text default null, p_batch uuid default null, p_status text default 'pending', p_org uuid default null)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_org uuid := coalesce(app.org_id(), p_org); v_district uuid; v_id uuid; v_centre uuid := p_centre;
begin
  if app.is_worker() then
    if v_org is null then raise exception 'ORG_REQUIRED' using errcode = 'P0001'; end if;
  else
    if app.uid() is null or app.read_only() or not app.has_perm('leads.create') then
      raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
    end if;
    -- centre-scoped users can only ever ingest into their own centre, whatever they pass
    if app.role() in ('CENTRE_ADMIN','COUNSELLOR') then v_centre := app.centre_id(); end if;
  end if;
  if v_centre is not null then
    select district_id into v_district from public.centres c where c.id = v_centre and c.org_id = v_org and c.is_active and c.accepts_inbound
      and (app.is_worker() or app.can_see(c.org_id, c.district_id, c.id));
    if v_district is null then raise exception 'CENTRE_NOT_FOUND' using errcode = 'P0002'; end if;
  elsif not app.is_worker() and not app.is_hq() then
    raise exception 'CENTRE_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.inbound_events (org_id, district_id, centre_id, channel, external_event_id, idempotency_key, payload, import_batch_id, created_by, processing_status)
  values (v_org, v_district, v_centre, p_channel, p_external_id, p_idempotency_key, p_payload, p_batch, app.uid(),
          case when p_status = 'held' then 'held' else 'pending' end)
  on conflict (org_id, idempotency_key) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.inbound_events where org_id = v_org and idempotency_key = p_idempotency_key;
  end if;
  return v_id;
end $$;

create function app.pick_owner(p_centre uuid) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mode text; v_owner uuid;
begin
  select intra_centre_assignment into v_mode from public.centres where id = p_centre;
  if v_mode = 'round_robin' then
    select id into v_owner from public.users where centre_id = p_centre and role = 'COUNSELLOR' and is_active
      order by last_assigned_at nulls first, id limit 1 for update skip locked;
  end if;
  if v_owner is null then
    select id into v_owner from public.users where centre_id = p_centre and role = 'CENTRE_ADMIN' and is_active;
  end if;
  if v_owner is not null then update public.users set last_assigned_at = clock_timestamp() where id = v_owner; end if;
  return v_owner;
end $$;
revoke all on function app.pick_owner(uuid) from public;

-- THE INGESTION GATE (LT-1..8, PRD s13 "Writes to leads happen only through the ingestion function").
-- p_lead is the normalised form produced by src/lib/ingest/normalize.ts:
--   { phone (E.164, required), name, email, country, state, city, timezone, language,
--     students:[{name,grade,stream,school,board,subjects[]}], source:{l1,l2,l3,l4}, referral_code,
--     consent:{status,source,evidence}, owner_user_id, list_id, repeat_enquiry, tags[] }
create function app.ingest_lead(p_event uuid, p_lead jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  e public.inbound_events; l public.leads; o public.orgs; v_phone text := p_lead->>'phone'; v_identity uuid; v_first public.leads;
  v_owner uuid; v_outcome text; v_list uuid := nullif(p_lead->>'list_id', '')::uuid; v_list_row public.lists; s jsonb;
  v_rechurn boolean; v_consent text := coalesce(p_lead#>>'{consent,status}', 'unknown');
begin
  select * into e from public.inbound_events where id = p_event for update;
  if e.id is null or not (app.is_worker() or (app.uid() is not null and not app.read_only() and e.org_id = app.org_id()
       and (e.created_by = app.uid() or app.can_see(e.org_id, e.district_id, e.centre_id)))) then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- IDEMPOTENCY: a processed event returns its recorded result and touches nothing
  if e.processing_status = 'processed' then
    return jsonb_build_object('outcome', e.outcome, 'lead_id', e.lead_id, 'replayed', true);
  end if;

  -- VALIDATE
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then v_outcome := 'invalid';
  -- DNC CHECK
  elsif exists (select from public.dnc where org_id = e.org_id and phone_e164 = v_phone) then v_outcome := 'dnc';
  end if;
  if v_outcome is not null then
    update public.inbound_events set processing_status = 'processed', processed_at = now(), outcome = v_outcome, locked_at = null, error = null where id = e.id;
    return jsonb_build_object('outcome', v_outcome, 'lead_id', null);
  end if;

  select * into o from public.orgs where id = e.org_id;
  if v_list is not null then
    select * into v_list_row from public.lists where id = v_list and org_id = e.org_id;
    if v_list_row.id is null then v_list := null; end if;
  end if;
  -- serialise concurrent ingestion of the same number
  perform pg_advisory_xact_lock(hashtextextended(e.org_id::text || v_phone, 0));

  insert into public.parent_identities (org_id, phone_e164, phone_hash, email_hash)
  values (e.org_id, v_phone, encode(digest(v_phone, 'sha256'), 'hex'),
          case when nullif(p_lead->>'email', '') is not null then encode(digest(lower(trim(p_lead->>'email')), 'sha256'), 'hex') end)
  on conflict (org_id, phone_e164) do update set email_hash = coalesce(public.parent_identities.email_hash, excluded.email_hash)
  returning id into v_identity;

  -- DEDUPE, strict within the centre (any phone on the lead counts)
  select x.* into l from public.leads x          -- by identity (indexed), then by any secondary phone
   where x.parent_identity_id = v_identity and x.current_centre_id is not distinct from e.centre_id for update;
  if l.id is null then
    select x.* into l from public.lead_phones p join public.leads x on x.id = p.lead_id
     where p.phone_e164 = v_phone and x.org_id = e.org_id and x.current_centre_id is not distinct from e.centre_id
     order by x.created_at limit 1 for update of x;
  end if;

  if l.id is not null then
    -- LT-8 / TE-7: repeat enquiry. Manual re-entry and bulk rows only "open the existing lead".
    v_rechurn := coalesce((p_lead->>'repeat_enquiry')::boolean, e.channel not in ('manual','bulk_upload','migration'));
    if v_rechurn then
      perform app.write_activity(l, 'repeat_enquiry', jsonb_build_object('channel', e.channel, 'event_id', e.id, 'source', p_lead->'source'));
      if l.lifecycle in ('DEAD','ENROLLED') and not coalesce(v_list_row.disallow_auto_rechurn, false) then
        perform app.set_lifecycle(l, 'ENQUIRY', null);
        if l.owner_user_id is not null then
          insert into public.tasks (org_id, district_id, centre_id, lead_id, type, title, due_at, owner_user_id, origin)
          values (l.org_id, l.district_id, l.current_centre_id, l.id, 'followup', 'Repeat enquiry: call', now(), l.owner_user_id, 'system');
          perform app.refresh_next_followup(l.id);
        end if;
        v_outcome := 'rechurned';
      end if;
    end if;
    v_outcome := coalesce(v_outcome, 'duplicate');
  else
    -- ASSIGN CENTRE (the event's centre; page->centre mapping and HQ routing rules set it upstream) + ASSIGN OWNER
    v_owner := nullif(p_lead->>'owner_user_id', '')::uuid;
    if v_owner is not null and not exists (select from public.users u where u.id = v_owner and u.is_active and u.org_id = e.org_id
                                           and u.centre_id is not distinct from e.centre_id) then v_owner := null; end if;
    if v_owner is null and e.channel = 'manual' and e.centre_id is not null
       and exists (select from public.users u where u.id = e.created_by and u.centre_id = e.centre_id) then v_owner := e.created_by; end if;
    if v_owner is null and e.centre_id is not null then v_owner := app.pick_owner(e.centre_id); end if;

    insert into public.leads (org_id, district_id, current_centre_id, origin_centre_id, parent_identity_id, owner_user_id, assigned_at, assign_status,
        name, primary_phone, email, country, state, city, timezone, language, consent_status, consent_at,
        source_l1, source_l2, source_l3, source_l4, added_by, import_batch_id, referral_code, tags)
    values (e.org_id, e.district_id, e.centre_id, e.centre_id, v_identity, v_owner, case when v_owner is not null then now() end,
        case when v_owner is null then 'unassigned' else 'assigned' end,
        nullif(trim(p_lead->>'name'), ''), v_phone, nullif(lower(trim(p_lead->>'email')), ''), nullif(p_lead->>'country', ''),
        nullif(p_lead->>'state', ''), nullif(p_lead->>'city', ''), coalesce(nullif(p_lead->>'timezone', ''), 'Asia/Kolkata'), nullif(p_lead->>'language', ''),
        v_consent, case when v_consent <> 'unknown' then now() end,
        coalesce(nullif(p_lead#>>'{source,l1}', ''), e.channel), nullif(p_lead#>>'{source,l2}', ''), nullif(p_lead#>>'{source,l3}', ''), nullif(p_lead#>>'{source,l4}', ''),
        e.created_by, e.import_batch_id, nullif(p_lead->>'referral_code', ''),
        coalesce((select array_agg(distinct lower(t)) from jsonb_array_elements_text(coalesce(p_lead->'tags', '[]')) t), '{}'))
    returning * into l;
    insert into public.lead_phones (lead_id, phone_e164, is_primary) values (l.id, v_phone, true);
    insert into public.consents (org_id, lead_id, status, source, evidence)
    values (e.org_id, l.id, v_consent, coalesce(p_lead#>>'{consent,source}', e.channel), coalesce(p_lead#>'{consent,evidence}', '{}'));
    perform app.write_activity(l, 'lead_created', jsonb_build_object('channel', e.channel, 'event_id', e.id));
    if v_owner is not null then
      perform app.write_activity(l, 'lead_assigned', jsonb_build_object('owner_user_id', v_owner, 'by', 'ingestion'));
      insert into public.tasks (org_id, district_id, centre_id, lead_id, type, title, due_at, owner_user_id, origin)
      values (l.org_id, l.district_id, l.current_centre_id, l.id, 'followup', 'First call', now(), v_owner, 'system');   -- cadence day 0
      perform app.refresh_next_followup(l.id);
    end if;

    -- CROSS-CENTRE CONFLICT CHECK. Visible to HQ only; the entering centre gets a normal "created".
    select x.* into v_first from public.leads x where x.parent_identity_id = v_identity and x.id <> l.id order by x.created_at, x.id limit 1;
    if v_first.id is not null then
      insert into public.conflicts (org_id, parent_identity_id, first_lead_id, new_lead_id, status, resolution, credited_centre_ids)
      values (e.org_id, v_identity, v_first.id, l.id,
              case o.cross_centre_policy when 'first_touch_wins' then 'auto_resolved' else 'open' end,
              case o.cross_centre_policy when 'first_touch_wins' then 'keep_first' end,
              case when o.cross_centre_policy = 'first_touch_wins' and v_first.current_centre_id is not null then array[v_first.current_centre_id] else '{}'::uuid[] end);
    end if;
    v_outcome := 'created';
  end if;

  -- students: add any not already on the lead
  for s in select * from jsonb_array_elements(coalesce(p_lead->'students', '[]')) loop
    if nullif(trim(s->>'name'), '') is not null and not exists (select from public.students st where st.lead_id = l.id and lower(st.name) = lower(trim(s->>'name'))) then
      insert into public.students (org_id, district_id, centre_id, lead_id, name, grade, stream, school, board, subjects)
      values (l.org_id, l.district_id, l.current_centre_id, l.id, trim(s->>'name'),
              case when (s->>'grade') ~ '^(8|9|10|11|12)$' then (s->>'grade')::int end,
              case when (s->>'grade') in ('11','12') and s->>'stream' in ('PCMB','PCMC','Commerce') then s->>'stream' end,
              nullif(s->>'school', ''), nullif(s->>'board', ''),
              coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(s->'subjects', '[]')) x), '{}'));
    end if;
  end loop;
  if v_list is not null then
    insert into public.list_members (list_id, lead_id) values (v_list, l.id) on conflict do nothing;
  end if;

  update public.inbound_events set processing_status = 'processed', processed_at = now(), outcome = v_outcome, lead_id = l.id, locked_at = null, error = null where id = e.id;
  return jsonb_build_object('outcome', v_outcome, 'lead_id', l.id);
end $$;

-- ---------------------------------------------------------------- worker + replay
create function app.claim_events(p_limit int default 20) returns setof public.inbound_events
language sql security definer set search_path = public, pg_temp as $$
  update public.inbound_events set processing_status = 'processing', locked_at = now()
  where id in (select id from public.inbound_events
               where (processing_status in ('pending','failed') and next_retry_at <= now())
                  or (processing_status = 'processing' and locked_at < now() - interval '5 minutes')   -- worker died mid-event
               order by received_at limit p_limit for update skip locked)
  returning *
$$;

-- exponential backoff 1,2,4,8.. minutes, then dead-letter. Nothing is ever dropped.
create function app.fail_event(p_event uuid, p_error text) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  update public.inbound_events e set retry_count = retry_count + 1, error = left(p_error, 2000), locked_at = null,
    processing_status = case when e.retry_count + 1 > o.max_event_retries then 'dead' else 'failed' end,
    next_retry_at = now() + make_interval(mins => power(2, e.retry_count)::int)
  from public.orgs o where e.id = p_event and o.id = e.org_id and e.processing_status <> 'processed'
  returning e.processing_status into v_status;
  return v_status;
end $$;

create function app.replay_event(p_event uuid) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.inbound_events;
begin
  select * into e from public.inbound_events where id = p_event and org_id = app.org_id();
  if e.id is null or app.read_only() or not app.has_perm('inbound.replay') or not app.can_see(e.org_id, e.district_id, e.centre_id) then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  update public.inbound_events set processing_status = 'pending', retry_count = 0, next_retry_at = now(), locked_at = null
    where id = p_event and processing_status in ('failed','dead');
  perform app.audit('inbound.replayed', 'inbound_events', p_event::text, jsonb_build_object('error', e.error), e.centre_id, e.district_id);
end $$;

-- ---------------------------------------------------------------- bulk import (LT-6, LS-3)
create function app.create_import_batch(p_centre uuid, p_filename text, p_headers text[], p_rows jsonb) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; v_centre uuid := p_centre; c public.centres; i int := 0; r jsonb;
begin
  if app.read_only() or not app.has_perm('leads.import') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  if app.role() in ('CENTRE_ADMIN','COUNSELLOR') then v_centre := app.centre_id(); end if;
  select * into c from public.centres x where x.id = v_centre and x.is_active and app.can_see(x.org_id, x.district_id, x.id);
  if c.id is null then raise exception 'CENTRE_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.import_batches (org_id, district_id, centre_id, created_by, filename, headers, row_count)
  values (c.org_id, c.district_id, c.id, app.uid(), p_filename, p_headers, jsonb_array_length(p_rows)) returning id into v_id;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;   -- raw rows are stored BEFORE mapping; held until the mapping is confirmed
    perform app.receive_event('bulk_upload', c.id, 'import:' || v_id || ':' || i, r, i::text, v_id, 'held');
  end loop;
  return v_id;
end $$;

create function app.start_import(p_batch uuid, p_mapping jsonb) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare b public.import_batches; v_list uuid;
begin
  select * into b from public.import_batches where id = p_batch for update;
  if b.id is null or app.read_only() or not app.has_perm('leads.import') or not app.can_see(b.org_id, b.district_id, b.centre_id) then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  if b.status <> 'mapping' then return; end if;     -- re-submitting the mapping is a no-op
  if p_mapping->>'phone' is null then raise exception 'INVALID' using errcode = 'P0001'; end if;
  insert into public.lists (org_id, district_id, centre_id, name, description, origin, owner_user_id)
  values (b.org_id, b.district_id, b.centre_id, 'Upload: ' || b.filename || ' ' || to_char(b.created_at, 'YYYY-MM-DD HH24:MI'), 'Created automatically from a bulk upload', 'upload', app.uid())
  returning id into v_list;
  update public.import_batches set mapping = p_mapping, list_id = v_list, status = 'processing' where id = p_batch;
  update public.inbound_events set processing_status = 'pending', next_retry_at = now() where import_batch_id = p_batch and processing_status = 'held';
  perform app.audit('import.started', 'import_batches', p_batch::text, jsonb_build_object('rows', b.row_count, 'filename', b.filename), b.centre_id, b.district_id);
end $$;

create function app.finish_imports() returns void language sql security definer set search_path = public, pg_temp as $$
  update public.import_batches b set status = 'done', completed_at = now()
  where b.status = 'processing' and not exists (select from public.inbound_events e where e.import_batch_id = b.id
        and e.processing_status in ('held','pending','processing','failed'))
$$;

do $$ declare f text; begin
  foreach f in array array['app.receive_event(text, uuid, text, jsonb, text, uuid, text, uuid)', 'app.ingest_lead(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated, elessons_worker', f);
  end loop;
  foreach f in array array['app.claim_events(int)', 'app.fail_event(uuid, text)', 'app.finish_imports()'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to elessons_worker', f);
  end loop;
  foreach f in array array['app.replay_event(uuid)', 'app.create_import_batch(uuid, text, text[], jsonb)', 'app.start_import(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
