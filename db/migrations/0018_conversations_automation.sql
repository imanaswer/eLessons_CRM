-- PHASE 5 + 6: WhatsApp conversations, templates, broadcasts, automation engine, renewals, payouts,
-- custom properties, lead merge, 2FA, push subscriptions, dynamic lists.

-- the worker re-opens an event after the gate created the lead for it (payments, WhatsApp)
create function app.reopen_event(p_event uuid) returns void language sql security definer set search_path = public, pg_temp as $$
  update public.inbound_events set processing_status = 'processing' where id = p_event
$$;
revoke all on function app.reopen_event(uuid) from public; grant execute on function app.reopen_event(uuid) to elessons_worker;

-- ---- conversations (CV-1..7). HQ number first; a centre number is a connection of kind 'whatsapp' with a centre_id.
create table public.conversations (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), district_id uuid, centre_id uuid,
  lead_id uuid not null references public.leads(id), connection_id uuid references public.connections(id),
  wa_id text not null,                                    -- parent's WhatsApp number (E.164 digits)
  owner_user_id uuid references public.users(id), origin text not null default 'inbound' check (origin in ('inbound','outbound','broadcast')),
  category text not null default 'service' check (category in ('service','marketing','broadcast')),
  status text not null default 'open' check (status in ('open','awaiting','resolved')),
  starred boolean not null default false, unread int not null default 0,
  last_inbound_at timestamptz, last_outbound_at timestamptz, last_message_at timestamptz, last_by text check (last_by in ('lead','user','system')),
  session_expires_at timestamptz,                         -- 24 h after the last inbound message (CV-2)
  created_at timestamptz not null default now(), unique (lead_id, connection_id)
);
create index on public.conversations (centre_id, status, last_message_at desc); create index on public.conversations (owner_user_id, status);
create index on public.conversations (org_id, last_message_at desc); create index on public.conversations (wa_id);
create table public.messages (
  id bigint generated always as identity primary key, org_id uuid not null, conversation_id uuid not null references public.conversations(id),
  direction text not null check (direction in ('in','out')), kind text not null default 'text' check (kind in ('text','template','image','document','audio','video','interactive','reaction','unknown')),
  body text, template_name text, media_url text, wa_message_id text unique, sent_by uuid references public.users(id), broadcast_id uuid,
  status text not null default 'received' check (status in ('queued','sent','delivered','read','failed','received')), error text,
  created_at timestamptz not null default now(), status_at timestamptz
);
create index on public.messages (conversation_id, id desc); create index on public.messages (broadcast_id) where broadcast_id is not null;
create table public.templates (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), connection_id uuid references public.connections(id),
  name text not null, language text not null default 'en', category text not null default 'MARKETING', body text not null, variables text[] not null default '{}',
  header_media_url text, buttons jsonb not null default '[]', status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','paused')),
  external_id text, created_by uuid references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (org_id, name, language)
);
create table public.snippets (id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), centre_id uuid, shortcut text not null, body text not null, unique (org_id, centre_id, shortcut));
create table public.broadcasts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), district_id uuid, centre_id uuid,
  name text not null, objective text, list_id uuid not null references public.lists(id), template_id uuid not null references public.templates(id), connection_id uuid not null references public.connections(id),
  recipient_limit int, mode text not null default 'existing' check (mode in ('existing','existing_and_new','new_only')),
  status text not null default 'submitted' check (status in ('submitted','running','paused','completed','failed')), scheduled_at timestamptz not null default now(),
  sent_count int not null default 0, delivered_count int not null default 0, read_count int not null default 0, replied_count int not null default 0, failed_count int not null default 0, skipped_count int not null default 0,
  created_by uuid references public.users(id), created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.broadcast_recipients (broadcast_id uuid not null references public.broadcasts(id), lead_id uuid not null references public.leads(id), status text not null default 'queued', message_id bigint, primary key (broadcast_id, lead_id));
create index on public.broadcast_recipients (broadcast_id, status);
alter table public.messages add foreign key (broadcast_id) references public.broadcasts(id);
alter table public.leads add column opted_out_at timestamptz;      -- CV-7 "Stop"

alter table public.conversations enable row level security; alter table public.messages enable row level security; alter table public.templates enable row level security;
alter table public.snippets enable row level security; alter table public.broadcasts enable row level security; alter table public.broadcast_recipients enable row level security;
grant select, update (owner_user_id, status, starred, category) on public.conversations to authenticated;
grant select on public.messages, public.broadcasts, public.broadcast_recipients to authenticated;
grant select, insert, update on public.templates, public.snippets to authenticated;
-- a conversation is visible exactly when its lead is; HQ_COUNSELLORs additionally see the HQ team inbox (unassigned HQ-number conversations)
create policy conv_read on public.conversations for select to authenticated
  using (app.lead_visible(lead_id) or (app.role() = 'HQ_COUNSELLOR' and centre_id is null and org_id = app.org_id()));
create policy conv_upd on public.conversations for update to authenticated using (app.lead_visible(lead_id) and not app.read_only()) with check (true);
create policy msg_read on public.messages for select to authenticated using (exists (select from public.conversations c where c.id = conversation_id));
create policy tpl_read on public.templates for select to authenticated using (org_id = app.org_id());
create policy tpl_ins on public.templates for insert to authenticated with check (org_id = app.org_id() and app.has_perm('broadcasts.manage') and not app.read_only());
create policy tpl_upd on public.templates for update to authenticated using (org_id = app.org_id() and app.has_perm('broadcasts.manage') and not app.read_only()) with check (org_id = app.org_id());
create policy snip_read on public.snippets for select to authenticated using (org_id = app.org_id() and (centre_id is null or centre_id = app.centre_id()));
create policy snip_ins on public.snippets for insert to authenticated with check (org_id = app.org_id() and not app.read_only() and (centre_id is null and app.is_hq() or centre_id = app.centre_id()));
create policy snip_upd on public.snippets for update to authenticated using (org_id = app.org_id() and not app.read_only() and (centre_id is null and app.is_hq() or centre_id = app.centre_id()));
create policy bc_read on public.broadcasts for select to authenticated using (app.can_see(org_id, district_id, centre_id) and app.has_perm('broadcasts.manage'));
create policy bcr_read on public.broadcast_recipients for select to authenticated using (exists (select from public.broadcasts b where b.id = broadcast_id));
create trigger audit_templates after insert or update of status, body on public.templates for each row execute function app.audit_row_change();

-- inbound message: create/attach the conversation; unknown numbers become leads through the gate (CV-3). Worker only.
create function app.record_inbound_message(p_event uuid, p_conn uuid, p_wa_id text, p_wa_message_id text, p_kind text, p_body text, p_media text, p_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.connections; e public.inbound_events; v_phone text := '+' || regexp_replace(p_wa_id, '[^0-9]', '', 'g'); v_lead uuid; l public.leads; conv public.conversations; v_gate jsonb; v_stop boolean;
begin
  if not app.is_worker() then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  select * into e from public.inbound_events where id = p_event for update;
  if e.processing_status = 'processed' then return jsonb_build_object('replayed', true); end if;
  select * into c from public.connections where id = p_conn;
  v_lead := app.match_lead(e.org_id, v_phone, null, c.centre_id);
  if v_lead is null then
    v_gate := app.ingest_lead(p_event, jsonb_build_object('phone', v_phone, 'source', jsonb_build_object('l1', 'WhatsApp', 'l2', c.name), 'consent', jsonb_build_object('status', 'granted', 'source', 'whatsapp_inbound')));
    v_lead := (v_gate->>'lead_id')::uuid;
    if v_lead is null then return v_gate; end if;         -- DNC or invalid: nothing more to do
    perform app.reopen_event(p_event);     -- ingest marked it processed; the message write below re-marks it
  end if;
  select * into l from public.leads where id = v_lead for update;
  insert into public.conversations (org_id, district_id, centre_id, lead_id, connection_id, wa_id, owner_user_id, origin)
  values (l.org_id, l.district_id, l.current_centre_id, l.id, c.id, p_wa_id, l.owner_user_id, 'inbound')
  on conflict (lead_id, connection_id) do update set status = 'open' returning * into conv;
  insert into public.messages (org_id, conversation_id, direction, kind, body, media_url, wa_message_id, status, created_at)
  values (l.org_id, conv.id, 'in', p_kind, p_body, p_media, p_wa_message_id, 'received', p_at) on conflict (wa_message_id) do nothing;
  update public.conversations set unread = unread + 1, last_inbound_at = p_at, last_message_at = p_at, last_by = 'lead', session_expires_at = p_at + interval '24 hours',
         status = case when status = 'resolved' then 'open' else status end where id = conv.id;
  perform app.write_activity(l, 'whatsapp_in', jsonb_build_object('conversation_id', conv.id, 'preview', left(p_body, 120)));
  v_stop := lower(trim(coalesce(p_body, ''))) in ('stop', 'unsubscribe', 'opt out', 'optout');
  if v_stop then
    update public.leads set opted_out_at = now(), consent_status = 'withdrawn' where id = l.id;
    insert into public.consents (org_id, lead_id, status, source, evidence) values (l.org_id, l.id, 'withdrawn', 'whatsapp_stop', jsonb_build_object('message', p_body));
    perform app.write_activity(l, 'consent_changed', jsonb_build_object('status', 'withdrawn', 'source', 'whatsapp_stop'));
  end if;
  if l.owner_user_id is not null then perform app.notify(l.owner_user_id, 'whatsapp_in', 'WhatsApp: ' || coalesce(l.name, p_wa_id), left(p_body, 140), l.id); end if;
  update public.inbound_events set processing_status = 'processed', processed_at = now(), outcome = 'message', lead_id = l.id, locked_at = null, error = null where id = p_event;
  return jsonb_build_object('lead_id', l.id, 'conversation_id', conv.id, 'opted_out', v_stop);
end $$;

-- outbound: DNC + opt-out enforced here, before anything is queued (CV-7). Free text needs an open 24 h session; otherwise a template.
create function app.queue_message(p_lead uuid, p_conn uuid, p_body text, p_template uuid default null, p_vars jsonb default '[]', p_broadcast uuid default null) returns bigint
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads; c public.connections; conv public.conversations; t public.templates; v_id bigint; v_phone text; v_body text := p_body; v_system boolean := app.is_worker();
begin
  if v_system then select * into l from public.leads where id = p_lead for update;
  else l := app.lead_for_write(p_lead); if not app.has_perm('conversations.send') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if; end if;
  if l.id is null then raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into c from public.connections where id = p_conn and kind = 'whatsapp' and status = 'connected' and org_id = l.org_id and (centre_id is null or centre_id = l.current_centre_id);
  if c.id is null then raise exception 'NO_WHATSAPP_CONNECTION' using errcode = 'P0001'; end if;
  select phone_e164 into v_phone from public.lead_phones where lead_id = l.id and is_primary;
  if v_phone is null or l.opted_out_at is not null or l.consent_status in ('denied','withdrawn') or exists (select from public.dnc where org_id = l.org_id and phone_e164 = v_phone) then
    raise exception 'DNC' using errcode = 'P0001';
  end if;
  insert into public.conversations (org_id, district_id, centre_id, lead_id, connection_id, wa_id, owner_user_id, origin, category)
  values (l.org_id, l.district_id, l.current_centre_id, l.id, c.id, ltrim(v_phone, '+'), coalesce(l.owner_user_id, app.uid()), case when p_broadcast is null then 'outbound' else 'broadcast' end, case when p_broadcast is null then 'service' else 'broadcast' end)
  on conflict (lead_id, connection_id) do update set status = 'open' returning * into conv;
  if p_template is not null then
    select * into t from public.templates where id = p_template and org_id = l.org_id and status = 'approved';
    if t.id is null then raise exception 'TEMPLATE_NOT_APPROVED' using errcode = 'P0001'; end if;
    v_body := t.body;
    for i in 1 .. coalesce(jsonb_array_length(p_vars), 0) loop v_body := replace(v_body, '{{' || i || '}}', coalesce(p_vars->>(i - 1), '')); end loop;
  elsif conv.session_expires_at is null or conv.session_expires_at < now() then
    raise exception 'SESSION_EXPIRED' using errcode = 'P0001';
  end if;
  insert into public.messages (org_id, conversation_id, direction, kind, body, template_name, sent_by, broadcast_id, status)
  values (l.org_id, conv.id, 'out', case when p_template is null then 'text' else 'template' end, v_body, t.name, case when v_system then null else app.uid() end, p_broadcast, 'queued') returning id into v_id;
  update public.conversations set last_message_at = now(), last_by = case when v_system then 'system' else 'user' end, unread = 0 where id = conv.id;
  perform app.write_activity(l, 'whatsapp_out', jsonb_build_object('conversation_id', conv.id, 'message_id', v_id, 'template', t.name, 'preview', left(v_body, 120), 'broadcast_id', p_broadcast));
  return v_id;
end $$;

create function app.claim_outbound_messages(p_limit int default 20) returns table (id bigint, body text, kind text, template_name text, language text, wa_id text, phone_number_id text, secret_enc text, connection_id uuid, template_external_id text, header_media_url text)
language sql security definer set search_path = public, pg_temp as $$
  with picked as (select m.id from public.messages m where m.status = 'queued' order by m.id limit p_limit for update skip locked),
       upd as (update public.messages m set status = 'sent', status_at = now() from picked where m.id = picked.id returning m.*)
  select u.id, u.body, u.kind, u.template_name, coalesce(t.language, 'en'), c.wa_id, x.external_id, x.secret_enc, x.id, t.external_id, t.header_media_url
  from upd u join public.conversations c on c.id = u.conversation_id join public.connections x on x.id = c.connection_id
  left join public.templates t on t.org_id = u.org_id and t.name = u.template_name
$$;
create function app.message_result(p_id bigint, p_wa_message_id text, p_error text) returns void language sql security definer set search_path = public, pg_temp as $$
  update public.messages set wa_message_id = coalesce(p_wa_message_id, wa_message_id), status = case when p_error is null then 'sent' else 'failed' end, error = left(p_error, 500), status_at = now() where id = p_id
$$;
-- delivery / read receipts from the WhatsApp status webhook (CV-6)
create function app.message_status(p_wa_message_id text, p_status text, p_at timestamptz) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare m public.messages;
begin
  update public.messages set status = p_status, status_at = p_at where wa_message_id = p_wa_message_id and p_status in ('sent','delivered','read','failed')
    and array_position(array['queued','sent','delivered','read'], status) < coalesce(array_position(array['queued','sent','delivered','read'], p_status), 99) returning * into m;
  if m.broadcast_id is not null then
    update public.broadcasts set delivered_count = delivered_count + (p_status = 'delivered')::int, read_count = read_count + (p_status = 'read')::int, failed_count = failed_count + (p_status = 'failed')::int where id = m.broadcast_id;
  end if;
end $$;

-- ---- broadcasts (CV-5). Worker expands the list, then queue_message enforces DNC per recipient.
create function app.create_broadcast(p_name text, p_objective text, p_list uuid, p_template uuid, p_conn uuid, p_limit int, p_mode text, p_at timestamptz) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare li public.lists; v_id uuid;
begin
  if app.read_only() or not app.has_perm('broadcasts.manage') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  select * into li from public.lists x where x.id = p_list and app.can_see(x.org_id, x.district_id, x.centre_id);
  if li.id is null then raise exception 'INVALID' using errcode = 'P0001'; end if;
  if not exists (select from public.templates where id = p_template and org_id = app.org_id() and status = 'approved') then raise exception 'TEMPLATE_NOT_APPROVED' using errcode = 'P0001'; end if;
  if not exists (select from public.connections x where x.id = p_conn and x.kind = 'whatsapp' and x.status = 'connected' and app.can_see(x.org_id, x.district_id, x.centre_id)) then raise exception 'NO_WHATSAPP_CONNECTION' using errcode = 'P0001'; end if;
  insert into public.broadcasts (org_id, district_id, centre_id, name, objective, list_id, template_id, connection_id, recipient_limit, mode, scheduled_at, created_by)
  values (app.org_id(), li.district_id, li.centre_id, trim(p_name), p_objective, p_list, p_template, p_conn, p_limit, coalesce(p_mode, 'existing'), coalesce(p_at, now()), app.uid()) returning id into v_id;
  perform app.audit('broadcast.created', 'broadcasts', v_id::text, jsonb_build_object('list_id', p_list, 'template_id', p_template, 'limit', p_limit, 'mode', p_mode));
  return v_id;
end $$;
create function app.set_broadcast_status(p_id uuid, p_status text) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare b public.broadcasts;
begin
  select * into b from public.broadcasts where id = p_id;
  if b.id is null or app.read_only() or not app.has_perm('broadcasts.manage') or not app.can_see(b.org_id, b.district_id, b.centre_id) then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  if p_status not in ('paused','running') or b.status in ('completed','failed') then raise exception 'INVALID' using errcode = 'P0001'; end if;
  update public.broadcasts set status = p_status where id = p_id;
end $$;
-- one worker tick: pick due broadcasts, enqueue up to p_batch recipients each. Standing drips (existing_and_new / new_only) keep running.
create function app.run_broadcasts(p_batch int default 50) returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare b public.broadcasts; r record; n int := 0; v_sent int; v_left int;
begin
  for b in select * from public.broadcasts where status in ('submitted','running') and scheduled_at <= now() order by scheduled_at for update skip locked loop
    update public.broadcasts set status = 'running' where id = b.id and status = 'submitted';
    v_sent := 0;
    for r in select m.lead_id from public.list_members m where m.list_id = b.list_id
               and not exists (select from public.broadcast_recipients x where x.broadcast_id = b.id and x.lead_id = m.lead_id)
               and (b.mode <> 'new_only' or m.added_at > b.created_at)
               order by m.added_at limit p_batch loop
      v_left := coalesce(b.recipient_limit, 2147483647) - (select count(*) from public.broadcast_recipients where broadcast_id = b.id and status = 'queued');
      exit when v_left <= 0;
      begin
        insert into public.broadcast_recipients (broadcast_id, lead_id, status, message_id) values (b.id, r.lead_id, 'queued', app.queue_message(r.lead_id, b.connection_id, null, b.template_id, '[]', b.id));
        v_sent := v_sent + 1;
      exception when others then
        insert into public.broadcast_recipients (broadcast_id, lead_id, status) values (b.id, r.lead_id, 'skipped:' || sqlerrm) on conflict do nothing;
        update public.broadcasts set skipped_count = skipped_count + 1 where id = b.id;
      end;
    end loop;
    update public.broadcasts set sent_count = sent_count + v_sent where id = b.id;
    n := n + v_sent;
    if v_sent = 0 and b.mode = 'existing' then update public.broadcasts set status = 'completed', completed_at = now() where id = b.id; end if;
    if b.recipient_limit is not null and (select count(*) from public.broadcast_recipients where broadcast_id = b.id and status = 'queued') >= b.recipient_limit then
      update public.broadcasts set status = 'completed', completed_at = now() where id = b.id; end if;
  end loop;
  return n;
end $$;

-- ---- automation engine (brief s32). Rules are rows; the worker evaluates them from a trigger queue.
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), district_id uuid, centre_id uuid,     -- AU-1 scope
  name text not null, trigger text not null, conditions jsonb not null default '[]', actions jsonb not null default '[]',
  is_active boolean not null default true, quiet_hours boolean not null default true, rate_limit_per_lead_per_day int not null default 3,
  created_by uuid references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.automation_rules (org_id, trigger) where is_active;
create table public.automation_triggers (     -- the queue
  id bigint generated always as identity primary key, org_id uuid not null, trigger text not null, lead_id uuid not null references public.leads(id),
  context jsonb not null default '{}', created_at timestamptz not null default now(), processed_at timestamptz
);
create index on public.automation_triggers (id) where processed_at is null;
create table public.automation_runs (
  id bigint generated always as identity primary key, org_id uuid not null, rule_id uuid not null references public.automation_rules(id), lead_id uuid not null references public.leads(id),
  trigger_id bigint references public.automation_triggers(id), status text not null check (status in ('done','skipped','deferred','failed')), detail jsonb not null default '{}',
  run_at timestamptz not null default now(), unique (rule_id, trigger_id)
);
create index on public.automation_runs (rule_id, run_at desc); create index on public.automation_runs (lead_id, run_at desc);
alter table public.automation_rules enable row level security; alter table public.automation_triggers enable row level security; alter table public.automation_runs enable row level security;
grant select, insert, update on public.automation_rules to authenticated; grant select on public.automation_runs to authenticated;
create policy ar_read on public.automation_rules for select to authenticated using (org_id = app.org_id() and (centre_id is null and district_id is null or app.can_see(org_id, district_id, centre_id)));
create policy ar_ins on public.automation_rules for insert to authenticated with check (org_id = app.org_id() and app.has_perm('automation.manage') and not app.read_only()
  and (app.is_hq() or (app.role() = 'DISTRICT_MANAGER' and district_id = app.district_id() and centre_id is null) or (app.role() = 'CENTRE_ADMIN' and centre_id = app.centre_id())));
-- AU-1: HQ rules cannot be disabled by centres: a centre may only update rows scoped to its own centre
create policy ar_upd on public.automation_rules for update to authenticated using (org_id = app.org_id() and app.has_perm('automation.manage') and not app.read_only()
  and (app.is_hq() or (app.role() = 'DISTRICT_MANAGER' and district_id = app.district_id() and centre_id is null) or (app.role() = 'CENTRE_ADMIN' and centre_id = app.centre_id()))) with check (org_id = app.org_id());
create policy runs_read on public.automation_runs for select to authenticated using (app.lead_visible(lead_id));
create trigger audit_automation_rules after insert or update on public.automation_rules for each row execute function app.audit_row_change();

-- every activity type maps to a trigger name; the queue row is written in the same transaction as the activity
create function app.enqueue_automation() returns trigger language plpgsql as $$
declare t text;
begin
  t := case new.type
    when 'lead_created' then 'lead_created' when 'lead_assigned' then 'lead_assigned' when 'repeat_enquiry' then 'repeat_enquiry' when 'tag_added' then 'tag_applied'
    when 'lifecycle_change' then case when new.payload->>'to' in ('DEAD','ENROLLED') then 'lead_closed' end
    when 'call_outcome' then 'call_outcome' when 'task_created' then 'task_created' when 'task_completed' then 'task_completed'
    when 'deal_stage_change' then case when new.payload->>'from' is null then null when exists (select from public.deals d where d.id = (new.payload->>'deal_id')::uuid and d.status <> 'open') then 'deal_closed' else 'deal_stage_changed' end
    when 'payment' then 'payment_' || (new.payload->>'status')
    when 'site_event' then case new.payload->>'event' when 'demo_completed' then 'demo_completed' when 'checkout_started' then 'checkout_started' when 'checkout_abandoned' then 'checkout_abandoned' end
    when 'whatsapp_in' then 'conversation_started' end;
  if t is not null then insert into public.automation_triggers (org_id, trigger, lead_id, context) values (new.org_id, t, new.lead_id, new.payload || jsonb_build_object('activity_type', new.type, 'centre_id', new.centre_id)); end if;
  return new;
end $$;
create trigger activities_automation after insert on public.activities for each row execute function app.enqueue_automation();
-- task due / payment due are time-based: the worker's scheduler inserts those triggers
create function app.enqueue_due_triggers() returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into public.automation_triggers (org_id, trigger, lead_id, context)
  select t.org_id, 'task_due', t.lead_id, jsonb_build_object('task_id', t.id, 'title', t.title, 'type', t.type) from public.tasks t
   where t.status = 'open' and t.due_at <= now() and not exists (select from public.automation_triggers x where x.trigger = 'task_due' and x.context->>'task_id' = t.id::text);
  get diagnostics n = row_count;
  insert into public.automation_triggers (org_id, trigger, lead_id, context)
  select p.org_id, 'payment_due', p.lead_id, jsonb_build_object('payment_id', p.id, 'amount', p.amount) from public.payments p
   where p.status = 'requested' and p.created_at <= now() - interval '2 days' and not exists (select from public.automation_triggers x where x.trigger = 'payment_due' and x.context->>'payment_id' = p.id::text);
  return n;
end $$;

-- evaluate conditions against the lead + context. Condition: {field, op, value}; fields as in app.lead_field plus lead columns.
create function app.automation_matches(p_conds jsonb, l public.leads, p_ctx jsonb) returns boolean language plpgsql stable as $$
declare k jsonb; v text; ok boolean := true;
begin
  for k in select * from jsonb_array_elements(coalesce(p_conds, '[]')) loop
    v := lower(case k->>'field'
      when 'country' then l.country when 'state' then l.state when 'city' then l.city when 'language' then l.language when 'lifecycle' then l.lifecycle::text
      when 'source' then l.source_l1 when 'page' then l.source_l2 when 'campaign' then l.source_l3 when 'form' then l.source_l4 when 'centre_code' then (select code from public.centres where id = l.current_centre_id)
      when 'district_code' then (select code from public.districts where id = l.district_id) when 'grade' then (select min(grade)::text from public.students where lead_id = l.id)
      when 'deal_stage' then l.deal_stage when 'disposition' then p_ctx->>'disposition' when 'sentiment' then p_ctx->>'sentiment' when 'tag' then p_ctx->>'tag'
      when 'hour' then to_char(now() at time zone l.timezone, 'HH24') when 'attempts' then l.attempts::text when 'consent' then l.consent_status
      else case when (k->>'field') like 'custom.%' then l.custom->>substr(k->>'field', 8) end end);
    ok := ok and case k->>'op'
      when 'eq' then v is not distinct from lower(k->>'value') when 'neq' then v is distinct from lower(k->>'value')
      when 'in' then v in (select lower(x) from jsonb_array_elements_text(case jsonb_typeof(k->'value') when 'array' then k->'value' else '[]' end) x)
      when 'contains' then v like '%' || lower(k->>'value') || '%' when 'gt' then v ~ '^-?[0-9.]+$' and v::numeric > (k->>'value')::numeric when 'lt' then v ~ '^-?[0-9.]+$' and v::numeric < (k->>'value')::numeric
      when 'empty' then v is null when 'not_empty' then v is not null else false end;
    exit when not ok;
  end loop;
  return ok;
end $$;

-- One worker tick. Actions that leave the database (WhatsApp, email, webhook) are queued, not sent here.
create function app.run_automation(p_limit int default 50) returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare t public.automation_triggers; r public.automation_rules; l public.leads; o public.orgs; a jsonb; n int := 0; v_status text; v_detail jsonb; v_wa uuid; v_today int; v_user uuid; v_quiet boolean;
begin
  for t in select * from public.automation_triggers where processed_at is null and created_at <= now() order by id limit p_limit for update skip locked loop
    select * into l from public.leads where id = t.lead_id;
    select * into o from public.orgs where id = t.org_id;
    for r in select * from public.automation_rules x where x.org_id = t.org_id and x.is_active and x.trigger = t.trigger
               and (x.centre_id is null or x.centre_id = l.current_centre_id) and (x.district_id is null or x.district_id = l.district_id) order by (x.centre_id is null) desc, x.created_at loop
      continue when exists (select from public.automation_runs where rule_id = r.id and trigger_id = t.id);          -- idempotent per (rule, trigger)
      v_status := 'done'; v_detail := '[]';
      if l.anonymised_at is not null or not app.automation_matches(r.conditions, l, t.context) then
        insert into public.automation_runs (org_id, rule_id, lead_id, trigger_id, status, detail) values (t.org_id, r.id, l.id, t.id, 'skipped', '{"reason":"conditions not met"}'); continue;
      end if;
      select count(*) into v_today from public.automation_runs where rule_id = r.id and lead_id = l.id and status = 'done' and run_at > now() - interval '1 day';
      if v_today >= r.rate_limit_per_lead_per_day then
        insert into public.automation_runs (org_id, rule_id, lead_id, trigger_id, status, detail) values (t.org_id, r.id, l.id, t.id, 'skipped', '{"reason":"rate limit"}'); continue;
      end if;
      -- AU-4 quiet hours: messaging actions wait for the lead's calling window; other actions run now
      v_quiet := r.quiet_hours and app.next_calling_time(now(), l.timezone, o) > now() + interval '1 minute';
      for a in select * from jsonb_array_elements(r.actions) loop
        begin
          case a->>'type'
            when 'send_whatsapp' then
              if v_quiet then v_status := 'deferred'; v_detail := v_detail || jsonb_build_object('action', 'send_whatsapp', 'deferred_until', app.next_calling_time(now(), l.timezone, o));
              else
                select id into v_wa from public.connections where kind = 'whatsapp' and status = 'connected' and org_id = l.org_id and (centre_id = l.current_centre_id or centre_id is null) order by (centre_id is not null) desc limit 1;
                v_detail := v_detail || jsonb_build_object('action', 'send_whatsapp', 'message_id', app.queue_message(l.id, v_wa, null, (a->>'template_id')::uuid,
                  jsonb_build_array(coalesce(l.name, ''), coalesce((select code from public.centres where id = l.current_centre_id), '')), null));
              end if;
            when 'send_email' then
              if l.email is null then v_detail := v_detail || '{"action":"send_email","skipped":"no email"}';
              else insert into public.webhook_deliveries (org_id, url, event, payload) values (l.org_id, 'mailto:' || l.email, 'email', jsonb_build_object('to', l.email, 'subject', a->>'subject', 'body', replace(coalesce(a->>'body', ''), '{{name}}', coalesce(l.name, ''))));
                   v_detail := v_detail || '{"action":"send_email","queued":true}'; end if;
            when 'create_task' then
              insert into public.tasks (org_id, district_id, centre_id, lead_id, type, title, due_at, owner_user_id, origin)
              values (l.org_id, l.district_id, l.current_centre_id, l.id, coalesce(a->>'task_type', 'custom'), coalesce(a->>'title', r.name), now() + make_interval(mins => coalesce((a->>'due_in_minutes')::int, 60)), l.owner_user_id, 'system');
              perform app.refresh_next_followup(l.id); v_detail := v_detail || '{"action":"create_task"}';
            when 'add_tag' then
              if a->>'tag' is not null and not lower(a->>'tag') = any (l.tags) then update public.leads set tags = tags || lower(a->>'tag') where id = l.id; perform app.write_activity(l, 'tag_added', jsonb_build_object('tag', lower(a->>'tag'), 'by', 'automation')); end if;
              v_detail := v_detail || '{"action":"add_tag"}';
            when 'add_to_list' then
              insert into public.list_members (list_id, lead_id) select (a->>'list_id')::uuid, l.id where exists (select from public.lists where id = (a->>'list_id')::uuid and org_id = l.org_id) on conflict do nothing;
              v_detail := v_detail || '{"action":"add_to_list"}';
            when 'assign', 'change_owner' then
              select id into v_user from public.users where id = (a->>'user_id')::uuid and is_active and centre_id is not distinct from l.current_centre_id;
              if v_user is not null then update public.leads set owner_user_id = v_user, assigned_at = now(), assign_status = 'assigned' where id = l.id; update public.tasks set owner_user_id = v_user where lead_id = l.id and status = 'open';
                perform app.write_activity(l, 'lead_assigned', jsonb_build_object('owner_user_id', v_user, 'by', 'automation:' || r.name)); end if;
              v_detail := v_detail || jsonb_build_object('action', 'assign', 'user_id', v_user);
            when 'webhook' then
              insert into public.webhook_deliveries (org_id, url, event, payload) values (l.org_id, a->>'url', t.trigger, jsonb_build_object('lead_id', l.id, 'trigger', t.trigger, 'context', t.context, 'rule', r.name));
              v_detail := v_detail || '{"action":"webhook","queued":true}';
            when 'notify_user' then
              perform app.notify(coalesce((a->>'user_id')::uuid, l.owner_user_id), 'automation', coalesce(a->>'title', r.name), coalesce(a->>'body', ''), l.id); v_detail := v_detail || '{"action":"notify_user"}';
            else v_detail := v_detail || jsonb_build_object('action', a->>'type', 'error', 'unknown action');
          end case;
        exception when others then v_status := 'failed'; v_detail := v_detail || jsonb_build_object('action', a->>'type', 'error', sqlerrm);
        end;
      end loop;
      insert into public.automation_runs (org_id, rule_id, lead_id, trigger_id, status, detail) values (t.org_id, r.id, l.id, t.id, v_status, v_detail);
      if v_status <> 'deferred' then perform app.write_activity(l, 'automation', jsonb_build_object('rule', r.name, 'rule_id', r.id, 'status', v_status, 'trigger', t.trigger)); end if;   -- AU-3
      n := n + 1;
    end loop;
    -- deferred runs are re-tried by re-queueing the trigger at the next calling window
    if exists (select from public.automation_runs x where x.trigger_id = t.id and x.status = 'deferred') then
      delete from public.automation_runs where trigger_id = t.id and status = 'deferred';
      insert into public.automation_triggers (org_id, trigger, lead_id, context, created_at) values (t.org_id, t.trigger, t.lead_id, t.context, app.next_calling_time(now(), l.timezone, o));
    end if;
    update public.automation_triggers set processed_at = now() where id = t.id;
  end loop;
  return n;
end $$;
create or replace function app.run_automation_due(p_limit int default 50) returns int language sql security definer set search_path = public, app, pg_temp as $$ select app.run_automation(p_limit) $$;

-- ---- renewals (EL-5): worker, daily
create function app.run_renewals() returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e record; l public.leads; o public.orgs; v_deal uuid; n int := 0;
begin
  for e in select en.*, s.grade as sgrade from public.enrolments en join public.students s on s.id = en.student_id join public.orgs o2 on o2.id = en.org_id
             where en.renewal_deal_id is null and en.access_end_date is not null and en.access_end_date <= current_date + o2.renewal_lead_days and coalesce(s.grade, 0) < 12
             for update of en skip locked loop
    select * into l from public.leads where id = e.lead_id for update;
    continue when l.anonymised_at is not null;
    -- original owner; if gone, the centre's admin
    if l.owner_user_id is null or not exists (select from public.users where id = l.owner_user_id and is_active) then
      update public.leads set owner_user_id = app.pick_owner(l.current_centre_id) where id = l.id returning * into l;
    end if;
    v_deal := app.open_deal(l, e.student_id, 'renewal', 'RENEWAL-' || coalesce(l.name, 'lead') || ' Grade ' || (e.sgrade + 1));
    update public.enrolments set renewal_deal_id = v_deal where id = e.id;
    perform app.set_lifecycle(l, 'ENQUIRY', null);        -- PRD s5: Enrolled -> Enquiry on renewal
    insert into public.tasks (org_id, district_id, centre_id, lead_id, student_id, type, title, due_at, owner_user_id, origin)
    values (l.org_id, l.district_id, l.current_centre_id, l.id, e.student_id, 'renewal', 'Renewal: access ends ' || e.access_end_date, now(), l.owner_user_id, 'system');
    perform app.refresh_next_followup(l.id);
    perform app.notify(l.owner_user_id, 'renewal', 'Renewal due: ' || coalesce(l.name, 'a parent'), 'Access ends ' || e.access_end_date, l.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---- payouts (EL-8, brief s31). Rate is a row, never a constant.
create table public.payout_rules (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), centre_id uuid references public.centres(id),   -- NULL = org default
  kind text not null default 'percent' check (kind in ('percent','fixed')), rate numeric(8,4) not null check (rate >= 0), currency char(3),
  valid_from date not null default current_date, valid_to date, created_by uuid references public.users(id), created_at timestamptz not null default now()
);
alter table public.payout_rules enable row level security;
grant select, insert, update on public.payout_rules to authenticated;
create policy pr_read on public.payout_rules for select to authenticated using (org_id = app.org_id() and (app.is_hq() or centre_id = app.centre_id() or centre_id is null));
create policy pr_ins on public.payout_rules for insert to authenticated with check (org_id = app.org_id() and app.role() = 'SUPERADMIN' and not app.read_only());
create policy pr_upd on public.payout_rules for update to authenticated using (org_id = app.org_id() and app.role() = 'SUPERADMIN' and not app.read_only()) with check (org_id = app.org_id());
create trigger audit_payout_rules after insert or update on public.payout_rules for each row execute function app.audit_row_change();
create view public.payout_report with (security_invoker = true) as
  select en.org_id, en.centre_id, c.code as centre_code, date_trunc('month', en.enrolled_at)::date as month, en.currency, count(*)::int as enrolments, sum(en.revenue) as revenue,
         r.kind as rule_kind, r.rate, case r.kind when 'percent' then round(sum(en.revenue) * r.rate / 100, 2) when 'fixed' then count(*) * r.rate end as commission
  from public.enrolments en join public.centres c on c.id = en.centre_id
  left join lateral (select * from public.payout_rules p where p.org_id = en.org_id and (p.centre_id = en.centre_id or p.centre_id is null) and p.valid_from <= en.enrolled_at::date and (p.valid_to is null or p.valid_to >= en.enrolled_at::date)
                     order by (p.centre_id is not null) desc, p.valid_from desc limit 1) r on true
  where app.has_perm('reports.payouts') and app.can_see(en.org_id, en.district_id, en.centre_id)
  group by 1, 2, 3, 4, 5, 8, 9;
grant select on public.payout_report to authenticated;

-- ---- custom properties (LT-9): definitions are data; values live in leads.custom / students.custom / deals.custom
create table public.property_definitions (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), entity text not null check (entity in ('lead','student','deal','user','payment')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'), label text not null, type text not null check (type in ('text','number','date','option','multi_option','phone')),
  options text[] not null default '{}', parent_key text, sort int not null default 0, is_active boolean not null default true, unique (org_id, entity, key)
);
alter table public.students add column custom jsonb not null default '{}'; alter table public.deals add column custom jsonb not null default '{}';
alter table public.property_definitions enable row level security;
grant select, insert, update on public.property_definitions to authenticated;
create policy pd_read on public.property_definitions for select to authenticated using (org_id = app.org_id());
create policy pd_ins on public.property_definitions for insert to authenticated with check (org_id = app.org_id() and app.has_perm('config.manage') and not app.read_only());
create policy pd_upd on public.property_definitions for update to authenticated using (org_id = app.org_id() and app.has_perm('config.manage') and not app.read_only()) with check (org_id = app.org_id());
create index on public.leads using gin (custom);
create function app.set_custom(p_lead uuid, p_values jsonb) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads := app.lead_for_write(p_lead); k text; v jsonb; d public.property_definitions; clean jsonb := '{}';
begin
  for k, v in select * from jsonb_each(p_values) loop
    select * into d from public.property_definitions where org_id = l.org_id and entity = 'lead' and key = k and is_active;
    continue when d.id is null;
    if d.type = 'number' and jsonb_typeof(v) = 'string' and (v#>>'{}') ~ '^-?[0-9.]+$' then v := to_jsonb((v#>>'{}')::numeric); end if;
    if d.type = 'option' and not (v#>>'{}') = any (d.options) then continue; end if;
    clean := clean || jsonb_build_object(k, v);
  end loop;
  update public.leads set custom = custom || clean where id = p_lead;
  perform app.write_activity(l, 'contact_edited', jsonb_build_object('fields', (select array_agg(x) from jsonb_object_keys(clean) x)));
end $$;

-- ---- merge (LT-10): both timelines kept; the loser points at the winner and disappears from lists
create function app.merge_leads(p_winner uuid, p_loser uuid) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare w public.leads := app.lead_for_write(p_winner); x public.leads := app.lead_for_write(p_loser);
begin
  if not app.has_perm('leads.merge') or app.role() not in ('SUPERADMIN','HQ_ADMIN','CENTRE_ADMIN') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  if w.current_centre_id is distinct from x.current_centre_id then raise exception 'MERGE_ACROSS_CENTRES' using errcode = 'P0001'; end if;
  if w.id = x.id then raise exception 'INVALID' using errcode = 'P0001'; end if;
  update public.lead_phones set lead_id = w.id where lead_id = x.id and phone_e164 not in (select phone_e164 from public.lead_phones where lead_id = w.id);
  delete from public.lead_phones where lead_id = x.id;
  update public.students set lead_id = w.id where lead_id = x.id; update public.tasks set lead_id = w.id where lead_id = x.id and status = 'open';
  update public.deals set lead_id = w.id where lead_id = x.id; update public.payments set lead_id = w.id where lead_id = x.id; update public.enrolments set lead_id = w.id where lead_id = x.id;
  update public.list_members set lead_id = w.id where lead_id = x.id and list_id not in (select list_id from public.list_members where lead_id = w.id); delete from public.list_members where lead_id = x.id;
  update public.leads set name = coalesce(name, x.name), email = coalesce(email, x.email), city = coalesce(city, x.city), state = coalesce(state, x.state), tags = coalesce((select array_agg(distinct t) from unnest(tags || x.tags) t), '{}'),
         custom = x.custom || custom, times_re_engaged = times_re_engaged + x.times_re_engaged, total_paid = total_paid + x.total_paid, is_customer = is_customer or x.is_customer where id = w.id;
  update public.leads set merged_into_id = w.id, parent_identity_id = null, next_followup_at = null where id = x.id;
  update public.tasks set status = 'cancelled', completed_at = now() where lead_id = x.id and status = 'open';
  perform app.write_activity(w, 'merged', jsonb_build_object('from_lead_id', x.id, 'from_name', x.name, 'from_phone', x.primary_phone));
  perform app.write_activity(x, 'merged', jsonb_build_object('into_lead_id', w.id));
  perform app.refresh_next_followup(w.id);
  perform app.audit('leads.merged', 'leads', w.id::text, jsonb_build_object('loser', x.id), w.current_centre_id, w.district_id);
end $$;
-- activities of the loser are shown on the winner's timeline
create or replace function app.activity_visible(p_lead uuid, p_centre uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select from public.lead_list v where (v.id = p_lead or v.id = (select merged_into_id from public.leads where id = p_lead))
    and (app.has_perm('leads.view_prior_activity') or v.assigned_at is null or p_at >= v.assigned_at)
    and (app.has_perm('leads.view_other_centre_activity') or p_centre is not distinct from v.current_centre_id))
$$;

-- ---- 2FA (TEN-9) and push (WS-14)
alter table public.users add column totp_confirmed_at timestamptz;
alter table public.orgs add column require_2fa_roles public.app_role[] not null default '{SUPERADMIN,HQ_ADMIN}';
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id), endpoint text not null unique, keys jsonb not null,
  user_agent text, created_at timestamptz not null default now(), failed_at timestamptz
);
alter table public.push_subscriptions enable row level security;
grant select, insert, delete on public.push_subscriptions to authenticated;
create policy ps_own on public.push_subscriptions for all to authenticated using (user_id = app.uid()) with check (user_id = app.uid() and not app.read_only());
create function app.claim_pushes(p_limit int default 50) returns table (id bigint, title text, body text, lead_id uuid, endpoint text, keys jsonb, sub_id uuid) language sql security definer set search_path = public, pg_temp as $$
  with picked as (select n.id from public.notifications n where n.pushed_at is null and n.created_at > now() - interval '1 day' order by n.id limit p_limit for update skip locked),
       upd as (update public.notifications n set pushed_at = now() from picked where n.id = picked.id returning n.*)
  select u.id, u.title, u.body, u.lead_id, s.endpoint, s.keys, s.id from upd u join public.push_subscriptions s on s.user_id = u.user_id and s.failed_at is null
$$;
create function app.push_failed(p_sub uuid) returns void language sql security definer set search_path = public, pg_temp as $$ update public.push_subscriptions set failed_at = now() where id = p_sub $$;

-- 2FA functions run as elessons_app (pre-auth) like the other auth_* functions
create function app.auth_totp_secret(p_user uuid) returns table (secret_enc text, confirmed boolean) language sql stable security definer set search_path = public, pg_temp as $$
  select totp_secret_enc, totp_confirmed_at is not null from public.users where id = p_user
$$;
create function app.auth_set_totp(p_user uuid, p_secret_enc text, p_confirmed boolean) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare u public.users;
begin
  update public.users set totp_secret_enc = p_secret_enc, totp_enabled = p_confirmed, totp_confirmed_at = case when p_confirmed then now() end where id = p_user returning * into u;
  insert into public.audit_log (org_id, district_id, centre_id, actor_user_id, action, target_type, target_id) values (u.org_id, u.district_id, u.centre_id, u.id, case when p_confirmed then 'auth.2fa_enabled' else 'auth.2fa_setup_started' end, 'users', u.id::text);
end $$;
alter table public.sessions add column totp_verified boolean not null default false;
create function app.auth_mark_totp(p_token_hash text) returns void language sql security definer set search_path = public, pg_temp as $$ update public.sessions set totp_verified = true where token_hash = p_token_hash $$;
-- auth_session now reports whether 2FA is still required for this session
create or replace function app.auth_session(p_token_hash text) returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare s public.sessions; u public.users; c public.centres; o public.orgs; v jsonb;
begin
  select * into s from public.sessions where token_hash = p_token_hash and revoked_at is null and expires_at > now();
  if s.id is null then return null; end if;
  select * into u from public.users where id = s.user_id and is_active;
  if u.id is null then return null; end if;
  if u.centre_id is not null and not exists (select from public.centres where id = u.centre_id and is_active) then return null; end if;
  if u.district_id is not null and not exists (select from public.districts where id = u.district_id and is_active) then return null; end if;
  update public.sessions set last_seen_at = now() where id = s.id and last_seen_at < now() - interval '5 minutes';
  select * into o from public.orgs where id = u.org_id;
  if s.impersonate_centre_id is not null then
    if u.role not in ('SUPERADMIN','HQ_ADMIN') then return null; end if;
    select * into c from public.centres where id = s.impersonate_centre_id and org_id = u.org_id;
    if c.id is null then return null; end if;
    v := jsonb_build_object('user_id', u.id, 'real_user_id', u.id, 'org_id', u.org_id, 'district_id', c.district_id, 'centre_id', c.id, 'role', 'CENTRE_ADMIN', 'read_only', true,
      'display_name', u.display_name, 'impersonating_centre_code', c.code, 'must_change_password', false);
  else
    v := jsonb_build_object('user_id', u.id, 'org_id', u.org_id, 'district_id', u.district_id, 'centre_id', u.centre_id, 'role', u.role, 'read_only', false, 'display_name', u.display_name,
      'must_change_password', u.must_change_password);
  end if;
  return v || jsonb_build_object('totp_required', (u.role = any (o.require_2fa_roles)) and not s.totp_verified, 'totp_enabled', u.totp_enabled);
end $$;

-- ---- dynamic lists (LS-2): a saved filter; membership is computed by the worker so broadcasts and counts have rows
alter table public.lists add column filters jsonb, add column refreshed_at timestamptz;
create function app.create_list(p_name text, p_description text, p_kind text, p_filters jsonb, p_scope text) returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; v_centre uuid; v_district uuid;
begin
  if app.read_only() then raise exception 'READ_ONLY' using errcode = 'insufficient_privilege'; end if;
  if p_scope = 'centre' or app.role() in ('CENTRE_ADMIN','COUNSELLOR') then v_centre := app.centre_id(); v_district := app.district_id();
  elsif p_scope = 'district' or app.role() = 'DISTRICT_MANAGER' then v_district := app.district_id(); end if;
  if v_centre is null and v_district is null and not app.is_hq() then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  insert into public.lists (org_id, district_id, centre_id, name, description, kind, filters, owner_user_id) values (app.org_id(), v_district, v_centre, trim(p_name), p_description, coalesce(p_kind, 'static'), p_filters, app.uid()) returning id into v_id;
  return v_id;
end $$;
create function app.set_list_members(p_list uuid, p_leads uuid[]) returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  delete from public.list_members where list_id = p_list and not (lead_id = any (p_leads));
  insert into public.list_members (list_id, lead_id) select p_list, x from unnest(p_leads) x on conflict do nothing;
  get diagnostics n = row_count;
  update public.lists set refreshed_at = now() where id = p_list; return n;
end $$;
create function app.claims_for_user(p_user uuid) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('user_id', u.id, 'org_id', u.org_id, 'district_id', u.district_id, 'centre_id', u.centre_id, 'role', u.role, 'read_only', false) from public.users u where u.id = p_user and u.is_active
$$;

do $$ declare f text; begin
  foreach f in array array['app.queue_message(uuid, uuid, text, uuid, jsonb, uuid)', 'app.create_broadcast(text, text, uuid, uuid, uuid, int, text, timestamptz)', 'app.set_broadcast_status(uuid, text)',
    'app.set_custom(uuid, jsonb)', 'app.merge_leads(uuid, uuid)', 'app.create_list(text, text, text, jsonb, text)'] loop
    execute format('revoke all on function %s from public', f); execute format('grant execute on function %s to authenticated', f); end loop;
  execute 'grant execute on function app.queue_message(uuid, uuid, text, uuid, jsonb, uuid) to elessons_worker';
  foreach f in array array['app.record_inbound_message(uuid, uuid, text, text, text, text, text, timestamptz)', 'app.claim_outbound_messages(int)', 'app.message_result(bigint, text, text)', 'app.message_status(text, text, timestamptz)',
    'app.run_broadcasts(int)', 'app.enqueue_due_triggers()', 'app.run_automation(int)', 'app.run_automation_due(int)', 'app.run_renewals()', 'app.claim_pushes(int)', 'app.push_failed(uuid)',
    'app.set_list_members(uuid, uuid[])', 'app.claims_for_user(uuid)'] loop
    execute format('revoke all on function %s from public', f); execute format('grant execute on function %s to elessons_worker', f); end loop;
  foreach f in array array['app.auth_totp_secret(uuid)', 'app.auth_set_totp(uuid, text, boolean)', 'app.auth_mark_totp(text)'] loop
    execute format('revoke all on function %s from public', f); execute format('grant execute on function %s to elessons_app', f); end loop;
  foreach f in array array['app.automation_matches(jsonb, public.leads, jsonb)', 'app.enqueue_automation()'] loop execute format('revoke all on function %s from public', f); end loop;
end $$;

