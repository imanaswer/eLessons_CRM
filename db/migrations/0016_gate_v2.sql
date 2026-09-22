-- The ingestion gate, second version. Same pipeline and guarantees as 0010, plus: HQ routing rules, referral
-- attribution, Meta ids, source registry, new-lead notification, and the Salesmax migration channel.
create or replace function app.ingest_lead(p_event uuid, p_lead jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  e public.inbound_events; l public.leads; o public.orgs; v_phone text := p_lead->>'phone'; v_identity uuid; v_first public.leads;
  v_owner uuid; v_outcome text; v_list uuid := nullif(p_lead->>'list_id', '')::uuid; v_list_row public.lists; s jsonb;
  v_rechurn boolean; v_consent text := coalesce(p_lead#>>'{consent,status}', 'unknown');
  v_centre uuid; v_district uuid; v_route jsonb; v_ref uuid; m jsonb := p_lead->'migration'; v_mig boolean; v_created timestamptz; v_lc public.lifecycle;
begin
  select * into e from public.inbound_events where id = p_event for update;
  if e.id is null or not (app.is_worker() or (app.uid() is not null and not app.read_only() and e.org_id = app.org_id()
       and (e.created_by = app.uid() or app.can_see(e.org_id, e.district_id, e.centre_id)))) then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if e.processing_status = 'processed' then        -- IDEMPOTENCY
    return jsonb_build_object('outcome', e.outcome, 'lead_id', e.lead_id, 'replayed', true);
  end if;
  v_mig := e.channel = 'migration' and m is not null;      -- only import batches created by app.create_import_batch(kind salesmax) carry this channel

  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then v_outcome := 'invalid';                       -- VALIDATE
  elsif exists (select from public.dnc where org_id = e.org_id and phone_e164 = v_phone) then v_outcome := 'dnc';   -- DNC
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
  perform pg_advisory_xact_lock(hashtextextended(e.org_id::text || v_phone, 0));

  insert into public.parent_identities (org_id, phone_e164, phone_hash, email_hash)
  values (e.org_id, v_phone, encode(digest(v_phone, 'sha256'), 'hex'),
          case when nullif(p_lead->>'email', '') is not null then encode(digest(lower(trim(p_lead->>'email')), 'sha256'), 'hex') end)
  on conflict (org_id, phone_e164) do update set email_hash = coalesce(public.parent_identities.email_hash, excluded.email_hash)
  returning id into v_identity;

  -- ASSIGN CENTRE. Order: the source's own centre (page -> centre, manual entry) > referral credit > HQ routing rules > HQ pool.
  v_centre := e.centre_id; v_district := e.district_id;
  if v_mig and v_centre is null and nullif(m->>'centre_code', '') is not null then      -- Salesmax team/page mapped to a centre code
    select id into v_centre from public.centres where org_id = e.org_id and code = upper(trim(m->>'centre_code'));
  end if;
  if v_centre is null and nullif(p_lead->>'referral_code', '') is not null then
    v_ref := app.resolve_referral(e.org_id, v_identity, p_lead->>'referral_code');
    v_centre := v_ref;
  end if;
  if v_centre is null then
    v_route := app.route_lead(e.org_id, p_lead, true);
    v_centre := (v_route->>'centre_id')::uuid; v_owner := (v_route->>'owner_user_id')::uuid;
  end if;
  if v_centre is not null and v_district is null then select district_id into v_district from public.centres where id = v_centre; end if;

  insert into public.sources (org_id, l1, l2, hq_scoped) values (e.org_id, coalesce(nullif(p_lead#>>'{source,l1}', ''), e.channel), coalesce(p_lead#>>'{source,l2}', ''), e.centre_id is null and v_ref is null)
  on conflict (org_id, l1, l2, hq_scoped) do update set last_seen_at = now(), lead_count = public.sources.lead_count + 1;

  -- DEDUPE, strict within the centre
  select x.* into l from public.leads x where x.parent_identity_id = v_identity and x.current_centre_id is not distinct from v_centre for update;
  if l.id is null then
    select x.* into l from public.lead_phones p join public.leads x on x.id = p.lead_id
     where p.phone_e164 = v_phone and x.org_id = e.org_id and x.current_centre_id is not distinct from v_centre order by x.created_at limit 1 for update of x;
  end if;

  if l.id is not null then
    v_rechurn := coalesce((p_lead->>'repeat_enquiry')::boolean, e.channel not in ('manual','bulk_upload','migration'));
    if v_rechurn then
      perform app.write_activity(l, 'repeat_enquiry', jsonb_build_object('channel', e.channel, 'event_id', e.id, 'source', p_lead->'source'));
      if l.lifecycle in ('DEAD','ENROLLED') and not coalesce(v_list_row.disallow_auto_rechurn, false) then
        perform app.set_lifecycle(l, 'ENQUIRY', null);
        if l.owner_user_id is not null then
          insert into public.tasks (org_id, district_id, centre_id, lead_id, type, title, due_at, owner_user_id, origin)
          values (l.org_id, l.district_id, l.current_centre_id, l.id, 'followup', 'Repeat enquiry: call', now(), l.owner_user_id, 'system');
          perform app.refresh_next_followup(l.id);
          perform app.notify(l.owner_user_id, 'repeat_enquiry', 'Repeat enquiry: ' || coalesce(l.name, 'a parent'), 'A closed lead enquired again.', l.id);
        end if;
        v_outcome := 'rechurned';
      end if;
    end if;
    v_outcome := coalesce(v_outcome, 'duplicate');
  else
    -- ASSIGN OWNER
    if v_owner is null then v_owner := nullif(p_lead->>'owner_user_id', '')::uuid; end if;
    if v_mig and m->>'owner_username' is not null then
      select u.id into v_owner from public.users u where u.org_id = e.org_id and u.username = lower(m->>'owner_username') and u.centre_id is not distinct from v_centre and u.is_active;
    end if;
    if v_owner is not null and not exists (select from public.users u where u.id = v_owner and u.is_active and u.org_id = e.org_id
                                           and (u.centre_id is not distinct from v_centre or (v_route is not null and u.centre_id is null))) then v_owner := null; end if;
    if v_owner is null and e.channel = 'manual' and v_centre is not null
       and exists (select from public.users u where u.id = e.created_by and u.centre_id = v_centre) then v_owner := e.created_by; end if;
    if v_owner is null and v_centre is not null then v_owner := app.pick_owner(v_centre); end if;
    v_created := case when v_mig then coalesce((m->>'created_at')::timestamptz, now()) else now() end;       -- MG-2

    insert into public.leads (org_id, district_id, current_centre_id, origin_centre_id, parent_identity_id, owner_user_id, assigned_at, assign_status,
        name, primary_phone, email, country, state, city, timezone, language, consent_status, consent_at,
        source_l1, source_l2, source_l3, source_l4, page_id, form_id, campaign_id, ad_id, added_by, import_batch_id, referral_code, tags, custom, created_at)
    values (e.org_id, v_district, v_centre, v_centre, v_identity, v_owner, case when v_owner is not null then now() end,
        case when v_owner is null then 'unassigned' else 'assigned' end,
        nullif(trim(p_lead->>'name'), ''), v_phone, nullif(lower(trim(p_lead->>'email')), ''), nullif(p_lead->>'country', ''),
        nullif(p_lead->>'state', ''), nullif(p_lead->>'city', ''), coalesce(nullif(p_lead->>'timezone', ''), 'Asia/Kolkata'), nullif(p_lead->>'language', ''),
        v_consent, case when v_consent <> 'unknown' then now() end,
        coalesce(nullif(p_lead#>>'{source,l1}', ''), e.channel), nullif(p_lead#>>'{source,l2}', ''), nullif(p_lead#>>'{source,l3}', ''), nullif(p_lead#>>'{source,l4}', ''),
        nullif(p_lead#>>'{meta,page_id}', ''), nullif(p_lead#>>'{meta,form_id}', ''), nullif(p_lead#>>'{meta,campaign_id}', ''), nullif(p_lead#>>'{meta,ad_id}', ''),
        e.created_by, e.import_batch_id, case when v_ref is not null or e.centre_id is not null then nullif(upper(p_lead->>'referral_code'), '') end,
        coalesce((select array_agg(distinct lower(t)) from jsonb_array_elements_text(coalesce(p_lead->'tags', '[]')) t), '{}'),
        case when jsonb_typeof(p_lead->'custom') = 'object' then p_lead->'custom' else '{}' end, v_created)
    returning * into l;
    insert into public.lead_phones (lead_id, phone_e164, is_primary) values (l.id, v_phone, true);
    insert into public.consents (org_id, lead_id, status, source, evidence)
    values (e.org_id, l.id, v_consent, coalesce(p_lead#>>'{consent,source}', e.channel), coalesce(p_lead#>'{consent,evidence}', '{}'));
    perform app.write_activity(l, 'lead_created', jsonb_build_object('channel', e.channel, 'event_id', e.id, 'routed_by', v_route->>'rule', 'referral', v_ref is not null));
    if v_owner is not null then
      perform app.write_activity(l, 'lead_assigned', jsonb_build_object('owner_user_id', v_owner, 'by', coalesce(v_route->>'rule', 'ingestion')));
    end if;

    if v_mig then
      -- MG-2: carry the Salesmax rollups; one marker event stands in for unexportable history
      perform app.write_activity(l, 'migrated', jsonb_build_object('note', 'Migrated from Salesmax', 'salesmax_id', m->>'id', 'last_disposition', m->>'last_disposition'));
      v_lc := case upper(coalesce(m->>'lifecycle', '')) when 'PROSPECT' then 'PROSPECT' when 'INTERESTED' then 'INTERESTED' when 'DEAD' then 'DEAD' when 'ENROLLED' then 'ENROLLED' else 'ENQUIRY' end;
      perform app.set_lifecycle(l, v_lc, nullif(m->>'closed_reason', ''));
      update public.leads set attempts = coalesce((m->>'attempts')::int, case when v_lc = 'ENQUIRY' then 0 else 1 end),
             first_touch_at = case when v_lc <> 'ENQUIRY' then v_created end,
             last_disposition_id = (select d.id from public.dispositions d where d.org_id = e.org_id and lower(d.name) = lower(m->>'last_disposition')) where id = l.id;
      if v_lc not in ('DEAD','ENROLLED') and (m->>'next_followup_at') is not null and v_owner is not null then
        insert into public.tasks (org_id, district_id, centre_id, lead_id, type, title, due_at, owner_user_id, origin)
        values (l.org_id, l.district_id, l.current_centre_id, l.id, 'followup', 'Follow up (from Salesmax)', (m->>'next_followup_at')::timestamptz, v_owner, 'user');
      end if;
      perform app.refresh_next_followup(l.id);
    elsif v_owner is not null then
      insert into public.tasks (org_id, district_id, centre_id, lead_id, type, title, due_at, owner_user_id, origin)
      values (l.org_id, l.district_id, l.current_centre_id, l.id, 'followup', 'First call', now(), v_owner, 'system');     -- cadence day 0
      perform app.refresh_next_followup(l.id);
      if v_owner is distinct from e.created_by then
        perform app.notify(v_owner, 'new_lead', 'New lead: ' || coalesce(l.name, 'unnamed parent'), coalesce(l.source_l1, '') || coalesce(' · ' || l.source_l2, ''), l.id);
      end if;
    end if;

    select x.* into v_first from public.leads x where x.parent_identity_id = v_identity and x.id <> l.id order by x.created_at, x.id limit 1;   -- CROSS-CENTRE CONFLICT
    if v_first.id is not null then
      insert into public.conflicts (org_id, parent_identity_id, first_lead_id, new_lead_id, status, resolution, credited_centre_ids)
      values (e.org_id, v_identity, v_first.id, l.id,
              case o.cross_centre_policy when 'first_touch_wins' then 'auto_resolved' else 'open' end,
              case o.cross_centre_policy when 'first_touch_wins' then 'keep_first' end,
              case when o.cross_centre_policy = 'first_touch_wins' and v_first.current_centre_id is not null then array[v_first.current_centre_id] else '{}'::uuid[] end);
    end if;
    v_outcome := 'created';
  end if;

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
  if v_list is not null then insert into public.list_members (list_id, lead_id) values (v_list, l.id) on conflict do nothing; end if;

  update public.inbound_events set processing_status = 'processed', processed_at = now(), outcome = v_outcome, lead_id = l.id, locked_at = null, error = null where id = e.id;
  return jsonb_build_object('outcome', v_outcome, 'lead_id', l.id, 'centre_id', l.current_centre_id, 'routed_by', v_route->>'rule');
end $$;

-- ---- website / LMS events (brief s25). Match by phone, then email. Returns NULL when no lead exists, so the
-- worker can create one through the gate first and call again.
create function app.match_lead(p_org uuid, p_phone text, p_email text, p_prefer_centre uuid default null) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select l.id from public.leads l left join public.parent_identities i on i.id = l.parent_identity_id
  where l.org_id = p_org and l.anonymised_at is null and l.merged_into_id is null
    and ((p_phone is not null and i.phone_e164 = p_phone) or (p_email is not null and lower(l.email) = lower(p_email)))
  order by (l.current_centre_id is not distinct from p_prefer_centre) desc, (i.phone_e164 = p_phone) desc nulls last, (l.lifecycle not in ('DEAD')) desc, l.enquiry_at desc limit 1
$$;

create function app.record_site_event(p_event uuid, p_type text, p_lead uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.inbound_events; l public.leads;
begin
  if not app.is_worker() then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  select * into e from public.inbound_events where id = p_event for update;
  if e.processing_status = 'processed' and e.outcome = 'event' then return; end if;      -- idempotent
  select * into l from public.leads where id = p_lead and org_id = e.org_id for update;
  if l.id is null then raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.write_activity(l, 'site_event', jsonb_build_object('event', p_type, 'data', p_data, 'event_id', e.id));
  if p_type = 'checkout_abandoned' then      -- EL-10: immediate follow-up task carrying the cart
    insert into public.tasks (org_id, district_id, centre_id, lead_id, type, title, due_at, owner_user_id, origin)
    values (l.org_id, l.district_id, l.current_centre_id, l.id, 'call',
            left('Abandoned checkout: ' || coalesce((select string_agg(coalesce(i->>'name', i->>'sku', 'item'), ', ') from jsonb_array_elements(case jsonb_typeof(p_data->'cart') when 'array' then p_data->'cart' else '[]' end) i), 'cart')
                 || coalesce(' (' || (p_data->>'currency') || ' ' || (p_data->>'amount') || ')', ''), 300),
            now(), l.owner_user_id, 'system');
    perform app.refresh_next_followup(l.id);
    perform app.notify(l.owner_user_id, 'checkout_abandoned', 'Abandoned checkout: ' || coalesce(l.name, 'a parent'), 'Call now while they are still deciding.', l.id);
  end if;
  update public.inbound_events set processing_status = 'processed', processed_at = now(), outcome = 'event', lead_id = l.id, locked_at = null, error = null where id = e.id;
end $$;

create function app.ignore_event(p_event uuid, p_reason text) returns void language sql security definer set search_path = public, pg_temp as $$
  update public.inbound_events set processing_status = 'processed', processed_at = now(), outcome = 'ignored', error = p_reason, locked_at = null where id = p_event and processing_status <> 'processed'
$$;

revoke all on function app.match_lead(uuid, text, text, uuid), app.record_site_event(uuid, text, uuid, jsonb), app.ignore_event(uuid, text) from public;
grant execute on function app.match_lead(uuid, text, text, uuid), app.record_site_event(uuid, text, uuid, jsonb), app.ignore_event(uuid, text) to elessons_worker;

-- ---- Salesmax migration batches reuse the import pipeline with the 'migration' channel (MG-1..3)
alter table public.import_batches add column kind text not null default 'upload' check (kind in ('upload','salesmax'));
create or replace function app.create_import_batch(p_centre uuid, p_filename text, p_headers text[], p_rows jsonb, p_kind text default 'upload') returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; v_centre uuid := p_centre; c public.centres; i int := 0; r jsonb; v_key text;
begin
  if app.read_only() or not app.has_perm('leads.import') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  if p_kind = 'salesmax' and app.role() not in ('SUPERADMIN','HQ_ADMIN') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  if app.role() in ('CENTRE_ADMIN','COUNSELLOR') then v_centre := app.centre_id(); end if;
  if v_centre is not null or p_kind <> 'salesmax' then      -- a Salesmax batch may span centres: the centre then comes from each row's mapped team/page
    select * into c from public.centres x where x.id = v_centre and x.is_active and app.can_see(x.org_id, x.district_id, x.id);
    if c.id is null then raise exception 'CENTRE_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  insert into public.import_batches (org_id, district_id, centre_id, created_by, filename, headers, row_count, kind)
  values (app.org_id(), c.district_id, c.id, app.uid(), p_filename, p_headers, jsonb_array_length(p_rows), p_kind) returning id into v_id;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    insert into public.inbound_events (org_id, district_id, centre_id, channel, external_event_id, idempotency_key, payload, import_batch_id, created_by, processing_status)
    values (app.org_id(), c.district_id, c.id, case p_kind when 'salesmax' then 'migration' else 'bulk_upload' end, i::text, 'import:' || v_id || ':' || i, r, v_id, app.uid(), 'held');
  end loop;
  return v_id;
end $$;
drop function app.create_import_batch(uuid, text, text[], jsonb);
revoke all on function app.create_import_batch(uuid, text, text[], jsonb, text) from public;
grant execute on function app.create_import_batch(uuid, text, text[], jsonb, text) to authenticated;

-- MG-3 re-runnable: a Salesmax row is keyed by its Salesmax id, not by batch, so re-importing the same export changes nothing.
create or replace function app.start_import(p_batch uuid, p_mapping jsonb) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare b public.import_batches; v_list uuid; v_idcol text := p_mapping->>'salesmax_id';
begin
  select * into b from public.import_batches where id = p_batch for update;
  if b.id is null or app.read_only() or not app.has_perm('leads.import') or not app.can_see(b.org_id, b.district_id, b.centre_id) then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  if b.status <> 'mapping' then return; end if;
  if p_mapping->>'phone' is null then raise exception 'INVALID' using errcode = 'P0001'; end if;
  insert into public.lists (org_id, district_id, centre_id, name, description, origin, owner_user_id)
  values (b.org_id, b.district_id, b.centre_id, case b.kind when 'salesmax' then 'Salesmax: ' else 'Upload: ' end || b.filename || ' ' || to_char(b.created_at, 'YYYY-MM-DD HH24:MI'),
          'Created automatically from a bulk upload', 'upload', app.uid()) returning id into v_list;
  update public.import_batches set mapping = p_mapping, list_id = v_list, status = 'processing' where id = p_batch;
  if b.kind = 'salesmax' and v_idcol is not null then
    -- rows already imported by an earlier batch are marked duplicate up front
    update public.inbound_events e set processing_status = 'processed', processed_at = now(), outcome = 'duplicate',
           lead_id = (select x.lead_id from public.inbound_events x where x.org_id = e.org_id and x.idempotency_key = 'salesmax:' || (e.payload->>v_idcol))
     where e.import_batch_id = p_batch and e.processing_status = 'held' and nullif(e.payload->>v_idcol, '') is not null
       and exists (select from public.inbound_events x where x.org_id = e.org_id and x.idempotency_key = 'salesmax:' || (e.payload->>v_idcol));
    update public.inbound_events e set idempotency_key = 'salesmax:' || (e.payload->>v_idcol)
     where e.import_batch_id = p_batch and e.processing_status = 'held' and nullif(e.payload->>v_idcol, '') is not null
       and e.id = (select min(y.id::text)::uuid from public.inbound_events y where y.import_batch_id = p_batch and y.payload->>v_idcol = e.payload->>v_idcol);
  end if;
  update public.inbound_events set processing_status = 'pending', next_retry_at = now() where import_batch_id = p_batch and processing_status = 'held';
  perform app.audit('import.started', 'import_batches', p_batch::text, jsonb_build_object('rows', b.row_count, 'filename', b.filename, 'kind', b.kind), b.centre_id, b.district_id);
end $$;
