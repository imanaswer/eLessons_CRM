-- TR-1/TR-2: custody chain. Visible to HQ and to the district manager(s) involved; never to centres.
create table public.transfers (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id),
  lead_id uuid not null references public.leads(id),
  from_centre_id uuid references public.centres(id), from_district_id uuid,
  to_centre_id uuid not null references public.centres(id), to_district_id uuid not null,
  previous_owner_id uuid references public.users(id),
  new_owner_id uuid references public.users(id),
  actor_user_id uuid not null references public.users(id),
  reason text not null,
  created_at timestamptz not null default now()
);
create index on public.transfers (lead_id, id);
create index on public.transfers (org_id, created_at desc);
create trigger transfers_immutable before update or delete on public.transfers for each row execute function app.audit_immutable();
alter table public.transfers enable row level security;
grant select on public.transfers to authenticated;
create policy transfers_read on public.transfers for select to authenticated using (org_id = app.org_id() and (
  app.role() in ('SUPERADMIN','HQ_ADMIN') or (app.role() = 'DISTRICT_MANAGER' and app.district_id() in (from_district_id, to_district_id))));

create function app.assign_leads(p_leads uuid[], p_owner uuid) returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; l public.leads; u public.users; n int := 0;
begin
  if not app.has_perm('leads.assign') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  select * into u from public.users where id = p_owner and is_active and org_id = app.org_id();
  if u.id is null then raise exception 'OWNER_NOT_IN_CENTRE' using errcode = 'P0001'; end if;
  foreach v_id in array p_leads loop
    l := app.lead_for_write(v_id);
    if u.centre_id is distinct from l.current_centre_id then raise exception 'OWNER_NOT_IN_CENTRE' using errcode = 'P0001'; end if;
    continue when l.owner_user_id = p_owner;
    update public.leads set owner_user_id = p_owner, assigned_at = now(), assign_status = 'assigned' where id = v_id;
    update public.tasks set owner_user_id = p_owner where lead_id = v_id and status = 'open';
    perform app.write_activity(l, 'lead_assigned', jsonb_build_object('owner_user_id', p_owner, 'previous_owner_id', l.owner_user_id));
    n := n + 1;
  end loop;
  perform app.audit('leads.reassigned', 'leads', null, jsonb_build_object('count', n, 'owner_user_id', p_owner, 'lead_ids', to_jsonb(p_leads[1:200])), u.centre_id, u.district_id);
  return n;
end $$;

create function app.transfer_leads(p_leads uuid[], p_to uuid, p_reason text, p_owner uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; l public.leads; c public.centres; v_owner uuid; n int := 0; v_skipped uuid[] := '{}';
begin
  if not app.has_perm('leads.transfer') or app.role() not in ('SUPERADMIN','HQ_ADMIN','DISTRICT_MANAGER') then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  -- a District Manager can only target centres inside the district (can_see), and only move leads they can see
  select * into c from public.centres x where x.id = p_to and x.is_active and app.can_see(x.org_id, x.district_id, x.id);
  if c.id is null then raise exception 'CENTRE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_owner is not null and not exists (select from public.users where id = p_owner and centre_id = p_to and is_active) then
    raise exception 'OWNER_NOT_IN_CENTRE' using errcode = 'P0001';
  end if;
  foreach v_id in array p_leads loop
    l := app.lead_for_write(v_id);
    continue when l.current_centre_id = p_to;
    if exists (select from public.leads x where x.current_centre_id = p_to and x.parent_identity_id = l.parent_identity_id) then
      v_skipped := v_skipped || v_id; continue;        -- target already holds this parent: needs a merge, not a second row
    end if;
    v_owner := coalesce(p_owner, app.pick_owner(p_to));
    insert into public.transfers (org_id, lead_id, from_centre_id, from_district_id, to_centre_id, to_district_id, previous_owner_id, new_owner_id, actor_user_id, reason)
    values (l.org_id, v_id, l.current_centre_id, l.district_id, p_to, c.district_id, l.owner_user_id, v_owner, app.uid(), trim(p_reason));
    perform app.write_activity(l, 'lead_transferred_out', jsonb_build_object('reason', trim(p_reason)));     -- stamped with the OLD centre
    update public.leads set current_centre_id = p_to, district_id = c.district_id, owner_user_id = v_owner, assigned_at = now(),
           assign_status = case when v_owner is null then 'unassigned' else 'assigned' end where id = v_id returning * into l;
    update public.tasks set owner_user_id = v_owner, centre_id = p_to, district_id = c.district_id where lead_id = v_id and status = 'open';
    perform app.write_activity(l, 'lead_transferred_in', jsonb_build_object('reason', trim(p_reason), 'owner_user_id', v_owner));  -- NEW centre; no mention of where it came from
    perform app.refresh_next_followup(v_id);
    n := n + 1;
  end loop;
  perform app.audit('leads.transferred', 'centres', p_to::text, jsonb_build_object('count', n, 'reason', trim(p_reason),
                    'lead_ids', to_jsonb(p_leads[1:200]), 'skipped_duplicate_in_target', to_jsonb(v_skipped)), p_to, c.district_id);
  return jsonb_build_object('transferred', n, 'skipped_duplicate_in_target', to_jsonb(v_skipped));
end $$;

create function app.resolve_conflict(p_conflict uuid, p_resolution text, p_note text default null) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare k public.conflicts; a uuid; b uuid;
begin
  select * into k from public.conflicts where id = p_conflict and org_id = app.org_id() for update;
  if k.id is null or app.read_only() or not app.has_perm('conflicts.resolve') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  if p_resolution not in ('keep_first','move_to_second','share_credit') then raise exception 'INVALID' using errcode = 'P0001'; end if;
  select current_centre_id into a from public.leads where id = k.first_lead_id;
  select current_centre_id into b from public.leads where id = k.new_lead_id;
  -- Records who gets credit. It does not touch either centre's lead: each keeps its own record and history.
  update public.conflicts set status = 'resolved', resolution = p_resolution, resolved_by = app.uid(), resolved_at = now(), note = p_note,
    credited_centre_ids = array_remove(case p_resolution when 'keep_first' then array[a] when 'move_to_second' then array[b] else array[a, b] end, null)
  where id = p_conflict;
  perform app.audit('conflict.resolved', 'conflicts', p_conflict::text, jsonb_build_object('resolution', p_resolution, 'note', p_note));
end $$;

-- PRD s14: erasure = anonymise, keep aggregate counts. Activity rows are immutable, so free-text
-- notes remain in history; they are hidden with the lead from every list because the lead is closed and nameless.
create function app.anonymise_lead(p_lead uuid, p_reason text) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads := app.lead_for_write(p_lead);
begin
  if not app.has_perm('leads.delete') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  perform app.set_lifecycle(l, 'DEAD', 'Erased on request');
  perform app.write_activity(l, 'lead_erased', '{}');
  update public.tasks set status = 'cancelled', completed_at = now() where lead_id = p_lead and status = 'open';
  delete from public.lead_phones where lead_id = p_lead;
  update public.students set name = '[erased]', school = null where lead_id = p_lead;
  update public.leads set name = null, primary_phone = null, email = null, state = null, city = null, parent_identity_id = null,
         custom = '{}', tags = '{}', anonymised_at = now(), next_followup_at = null where id = p_lead;
  perform app.audit('lead.erased', 'leads', p_lead::text, jsonb_build_object('reason', trim(p_reason)), l.current_centre_id, l.district_id);
end $$;

create function app.dnc_add(p_phone text, p_reason text) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if app.read_only() or not app.has_perm('dnc.manage') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  insert into public.dnc (org_id, phone_e164, reason, added_by) values (app.org_id(), p_phone, coalesce(nullif(trim(p_reason), ''), 'Not stated'), app.uid())
  on conflict do nothing;
  perform app.audit('dnc.added', 'dnc', app.mask_phone(p_phone), '{}');
end $$;

create function app.add_to_list(p_leads uuid[], p_list uuid) returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare n int;
begin
  if app.read_only() or not exists (select from public.lists x where x.id = p_list and x.kind = 'static' and app.can_see(x.org_id, x.district_id, x.centre_id)) then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  insert into public.list_members (list_id, lead_id) select p_list, id from unnest(p_leads) id where app.lead_visible(id) on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- exports (RP-9, RP-10)
create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  district_id uuid, centre_id uuid,
  user_id uuid not null references public.users(id),
  filters jsonb not null default '{}',
  mask_phone boolean not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  row_count int, file_path text, error text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.export_jobs (status, requested_at) where status in ('queued','running');
create index on public.export_jobs (user_id, requested_at desc);
alter table public.export_jobs enable row level security;
grant select on public.export_jobs to authenticated;
create policy export_read on public.export_jobs for select to authenticated
  using (org_id = app.org_id() and (user_id = app.uid() or (app.has_perm('audit.view') and app.can_see(org_id, district_id, centre_id))));

create function app.request_export(p_filters jsonb) returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  if app.read_only() or not app.has_perm('leads.export') then raise exception 'EXPORT_DENIED' using errcode = 'insufficient_privilege'; end if;
  insert into public.export_jobs (org_id, district_id, centre_id, user_id, filters, mask_phone)
  values (app.org_id(), app.district_id(), app.centre_id(), app.uid(), coalesce(p_filters, '{}'), not app.has_perm('exports.unmasked_phone'))
  returning id into v_id;
  perform app.audit('export.requested', 'export_jobs', v_id::text, jsonb_build_object('filters', p_filters));
  return v_id;
end $$;

create function app.claim_export() returns public.export_jobs language sql security definer set search_path = public, pg_temp as $$
  update public.export_jobs set status = 'running' where id = (select id from public.export_jobs where status = 'queued'
    order by requested_at limit 1 for update skip locked) returning *
$$;

-- The worker runs the export query AS THE REQUESTER: it installs these claims and drops to `authenticated`,
-- so an export can never contain a row the user could not open on screen. Permission is re-checked at run time.
create function app.claims_for_export(p_job uuid) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('user_id', u.id, 'org_id', u.org_id, 'district_id', u.district_id, 'centre_id', u.centre_id,
                            'role', u.role, 'read_only', false)
  from public.export_jobs j join public.users u on u.id = j.user_id
  where j.id = p_job and u.is_active
$$;

create function app.finish_export(p_job uuid, p_rows int, p_path text, p_error text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.export_jobs;
begin
  update public.export_jobs set status = case when p_error is null then 'done' else 'failed' end, row_count = p_rows, file_path = p_path,
         error = left(p_error, 1000), completed_at = now() where id = p_job returning * into j;
  insert into public.audit_log (org_id, district_id, centre_id, actor_user_id, action, target_type, target_id, metadata)
  values (j.org_id, j.district_id, j.centre_id, j.user_id, case when p_error is null then 'export.completed' else 'export.failed' end,
          'export_jobs', j.id::text, jsonb_build_object('row_count', p_rows, 'filters', j.filters, 'mask_phone', j.mask_phone, 'error', p_error));
end $$;

do $$ declare f text; begin
  foreach f in array array['app.assign_leads(uuid[], uuid)', 'app.transfer_leads(uuid[], uuid, text, uuid)', 'app.resolve_conflict(uuid, text, text)',
    'app.anonymise_lead(uuid, text)', 'app.dnc_add(text, text)', 'app.add_to_list(uuid[], uuid)', 'app.request_export(jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['app.claim_export()', 'app.claims_for_export(uuid)', 'app.finish_export(uuid, int, text, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to elessons_worker', f);
  end loop;
end $$;
