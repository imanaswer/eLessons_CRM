-- PHASE 2: calling hours, SLA clock, notifications, saved views, lifecycle labels, HQ pull-back,
-- plus every projection column later phases write, so the projection function is rewritten once.

alter table public.orgs
  add column calling_start time not null default '09:00',            -- TE-5. PLACEHOLDER values: see NEEDED.md
  add column calling_end   time not null default '20:00',
  add column working_days  int[] not null default '{1,2,3,4,5,6}',   -- ISO dow, 1 = Monday
  add column sla_first_touch_minutes int not null default 15,        -- TE-6
  add column sla_untouched_hours int not null default 24,
  add column referral_window_days int not null default 30,           -- EL-3
  add column renewal_lead_days int not null default 60,              -- EL-5
  add constraint calling_window check (calling_end > calling_start);

alter table public.leads
  add column closed_at timestamptz, add column priority int not null default 0,
  add column deal_stage text, add column became_opportunity_at timestamptz,
  add column last_payment_status text, add column last_payment_amount numeric(12,2), add column total_paid numeric(12,2) not null default 0,
  add column last_whatsapp_at timestamptz, add column last_email_at timestamptz,
  add column enquiry_at timestamptz not null default now(),          -- start of the current enquiry cycle (creation or rechurn)
  add column sla_due_at timestamptz, add column sla_15_breached_at timestamptz, add column sla_24_breached_at timestamptz,
  add column page_id text, add column form_id text, add column campaign_id text, add column ad_id text,   -- exact Meta ids (brief s20)
  add column merged_into_id uuid references public.leads(id);
update public.leads set enquiry_at = coalesce(last_repeat_enquiry_at, created_at);
create index on public.leads (sla_due_at) where lifecycle = 'ENQUIRY' and attempts = 0 and sla_15_breached_at is null;
create index on public.leads (enquiry_at) where lifecycle = 'ENQUIRY' and attempts = 0 and sla_24_breached_at is null;
create index on public.leads (org_id, sla_24_breached_at) where sla_24_breached_at is not null and attempts = 0;
create index on public.leads (campaign_id) where campaign_id is not null;
create index on public.leads (ad_id) where ad_id is not null;
create index on public.leads (form_id) where form_id is not null;
create index on public.leads (last_payment_status) where last_payment_status is not null;
create index on public.leads (deal_stage) where deal_stage is not null;
create index on public.leads (org_id, closed_at desc) where closed_at is not null;

-- ---- calling hours (TE-5) and working-minute arithmetic (TE-6)
create function app.next_calling_time(p_at timestamptz, p_tz text, o public.orgs) returns timestamptz language plpgsql stable as $$
declare v_local timestamp := p_at at time zone p_tz; i int := 0;
begin
  loop
    if extract(isodow from v_local)::int = any (o.working_days) then
      if v_local::time < o.calling_start then return (v_local::date + o.calling_start) at time zone p_tz; end if;
      if v_local::time < o.calling_end then return v_local at time zone p_tz; end if;
    end if;
    v_local := (v_local::date + 1) + o.calling_start; i := i + 1;
    exit when i > 14;
  end loop;
  return p_at;
end $$;

create function app.add_working_minutes(p_at timestamptz, p_minutes int, p_tz text, o public.orgs) returns timestamptz language plpgsql stable as $$
declare t timestamptz := app.next_calling_time(p_at, p_tz, o); v_left interval := make_interval(mins => p_minutes); v_end timestamptz; i int := 0;
begin
  loop
    v_end := ((t at time zone p_tz)::date + o.calling_end) at time zone p_tz;
    if v_end - t >= v_left then return t + v_left; end if;
    v_left := v_left - (v_end - t);
    t := app.next_calling_time(v_end + interval '1 second', p_tz, o); i := i + 1;
    exit when i > 60;
  end loop;
  return t;
end $$;

create function app.lead_sla_clock() returns trigger language plpgsql as $$
declare o public.orgs;
begin
  if tg_op = 'INSERT' or (new.lifecycle = 'ENQUIRY' and old.lifecycle in ('DEAD','ENROLLED')) then
    select * into o from public.orgs where id = new.org_id;
    new.enquiry_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    new.sla_due_at := app.add_working_minutes(new.enquiry_at, o.sla_first_touch_minutes, new.timezone, o);
    new.sla_15_breached_at := null; new.sla_24_breached_at := null;
  end if;
  return new;
end $$;
create trigger leads_sla_clock before insert or update of lifecycle on public.leads for each row execute function app.lead_sla_clock();

-- ---- notifications (SLA alerts now; new-lead, automation "notify user" and push later)
create table public.notifications (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id),
  user_id uuid not null references public.users(id),
  kind text not null, title text not null, body text,
  lead_id uuid references public.leads(id),
  created_at timestamptz not null default now(), read_at timestamptz, pushed_at timestamptz
);
create index on public.notifications (user_id, id desc);
create index on public.notifications (id) where pushed_at is null;
alter table public.notifications enable row level security;
grant select, update (read_at) on public.notifications to authenticated;
create policy notif_read on public.notifications for select to authenticated using (user_id = app.uid());
create policy notif_mark on public.notifications for update to authenticated using (user_id = app.uid() and not app.read_only()) with check (user_id = app.uid());

create function app.notify(p_user uuid, p_kind text, p_title text, p_body text, p_lead uuid) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (org_id, user_id, kind, title, body, lead_id)
  select u.org_id, u.id, p_kind, p_title, p_body, p_lead from public.users u where u.id = p_user and u.is_active
$$;
revoke all on function app.notify(uuid, text, text, text, uuid) from public;

-- Worker, every minute. Idempotent: each breach is stamped once.
create function app.run_sla() returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l record; n15 int := 0; n24 int;
begin
  for l in update public.leads set sla_15_breached_at = now()
           where lifecycle = 'ENQUIRY' and attempts = 0 and sla_15_breached_at is null and sla_due_at <= now() and anonymised_at is null
           returning id, name, owner_user_id, current_centre_id loop
    n15 := n15 + 1;
    perform app.notify(l.owner_user_id, 'sla_15', 'New lead waiting: ' || coalesce(l.name, 'unnamed parent'), 'Not contacted within the first-response target.', l.id);
    perform app.notify(u.id, 'sla_15', 'Untouched lead: ' || coalesce(l.name, 'unnamed parent'), 'Owner has not made first contact within the target.', l.id)
      from public.users u where u.centre_id = l.current_centre_id and u.role = 'CENTRE_ADMIN' and u.is_active and u.id is distinct from l.owner_user_id;
  end loop;
  update public.leads x set sla_24_breached_at = now() from public.orgs o      -- alias must not be `l`: that is the loop record
   where o.id = x.org_id and x.lifecycle = 'ENQUIRY' and x.attempts = 0 and x.sla_24_breached_at is null and x.anonymised_at is null
     and x.enquiry_at <= now() - make_interval(hours => o.sla_untouched_hours);
  get diagnostics n24 = row_count;
  return jsonb_build_object('breach_15', n15, 'breach_24', n24);
end $$;
revoke all on function app.run_sla() from public;
grant execute on function app.run_sla() to elessons_worker;

-- ---- projection, final shape (AL-2). Later phases only emit the activity types handled here.
create or replace function app.project_activity(p_lead uuid, p_type text, p_payload jsonb, p_at timestamptz) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.leads set
    last_activity_at = p_at, updated_at = greatest(updated_at, p_at),
    first_touch_at   = case when p_type = 'call_outcome' then coalesce(first_touch_at, p_at) else first_touch_at end,
    last_worked_at   = case when p_type in ('call_outcome','note','whatsapp_out','email_out') then p_at else last_worked_at end,
    attempts         = case p_type when 'call_outcome' then attempts + 1 when 'repeat_enquiry' then 0 else attempts end,
    total_calls      = total_calls + (p_type = 'call_outcome')::int,
    last_call_at     = case when p_type = 'call_outcome' then p_at else last_call_at end,
    last_note_at     = case when p_type = 'note' then p_at else last_note_at end,
    last_disposition_id = case when p_type = 'call_outcome' then (p_payload->>'disposition_id')::uuid else last_disposition_id end,
    last_disposition_at = case when p_type = 'call_outcome' then p_at else last_disposition_at end,
    times_re_engaged = times_re_engaged + (p_type = 'repeat_enquiry')::int,
    last_repeat_enquiry_at = case when p_type = 'repeat_enquiry' then p_at else last_repeat_enquiry_at end,
    lifecycle        = case when p_type = 'lifecycle_change' then (p_payload->>'to')::public.lifecycle else lifecycle end,
    closed_reason    = case when p_type = 'lifecycle_change' then p_payload->>'reason' else closed_reason end,
    closed_at        = case when p_type = 'lifecycle_change' then case when p_payload->>'to' in ('DEAD','ENROLLED') then p_at end else closed_at end,
    is_customer      = is_customer or (p_type = 'lifecycle_change' and p_payload->>'to' = 'ENROLLED'),
    deal_stage       = case when p_type = 'deal_stage_change' then p_payload->>'to' else deal_stage end,
    became_opportunity_at = case when p_type = 'deal_created' then coalesce(became_opportunity_at, p_at) else became_opportunity_at end,
    last_payment_status = case when p_type = 'payment' then p_payload->>'status' else last_payment_status end,
    last_payment_amount = case when p_type = 'payment' then (p_payload->>'amount')::numeric else last_payment_amount end,
    total_paid       = total_paid + case when p_type = 'payment' and p_payload->>'status' in ('received','partial') then coalesce((p_payload->>'amount')::numeric, 0) else 0 end,
    last_whatsapp_at = case when p_type in ('whatsapp_in','whatsapp_out') then p_at else last_whatsapp_at end,
    last_email_at    = case when p_type = 'email_out' then p_at else last_email_at end,
    priority         = priority + case when p_type = 'site_event' and p_payload->>'event' = 'demo_completed' then 1 else 0 end      -- EL-9
  where id = p_lead
$$;

create or replace function app.rebuild_projection(p_lead uuid) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare a record;
begin
  if not app.has_perm('config.manage') or app.read_only() then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  perform app.lead_for_write(p_lead);
  update public.leads set lifecycle = 'ENQUIRY', closed_reason = null, closed_at = null, is_customer = false, first_touch_at = null, last_worked_at = null,
    last_activity_at = null, attempts = 0, total_calls = 0, last_call_at = null, last_note_at = null, last_disposition_id = null,
    last_disposition_at = null, times_re_engaged = 0, last_repeat_enquiry_at = null, deal_stage = null, became_opportunity_at = null,
    last_payment_status = null, last_payment_amount = null, total_paid = 0, last_whatsapp_at = null, last_email_at = null, priority = 0 where id = p_lead;
  for a in select type, payload, created_at from public.activities where lead_id = p_lead order by id loop
    perform app.project_activity(p_lead, a.type, a.payload, a.created_at);
  end loop;
  perform app.refresh_next_followup(p_lead);
end $$;

-- ---- lead_list: same scope rule as 0013, new columns appended
create or replace view public.lead_list with (security_barrier = false) as
  select l.id, l.org_id, l.district_id, l.current_centre_id, l.origin_centre_id, l.owner_user_id, l.assigned_at, l.assign_status,
         l.name,
         case when (select app.has_perm('leads.view_phone')) then l.primary_phone else app.mask_phone(l.primary_phone) end as primary_phone,
         case when (select app.has_perm('leads.view_phone')) then l.email end as email,
         l.country, l.state, l.city, l.timezone, l.language, l.lifecycle, l.closed_reason, l.is_customer,
         l.consent_status, l.consent_at,
         case when (select app.has_perm('leads.view_source')) then l.source_l1 end as source_l1,
         case when (select app.has_perm('leads.view_source')) then l.source_l2 end as source_l2,
         case when (select app.has_perm('leads.view_source')) then l.source_l3 end as source_l3,
         case when (select app.has_perm('leads.view_source')) then l.source_l4 end as source_l4,
         l.added_by, l.import_batch_id, l.tags, l.custom,
         l.first_touch_at, l.last_worked_at, l.last_activity_at, l.attempts, l.total_calls, l.last_call_at, l.last_note_at,
         l.last_disposition_id, l.last_disposition_at, l.next_followup_at, l.next_followup_origin,
         l.times_re_engaged, l.last_repeat_enquiry_at, l.anonymised_at, l.created_at, l.updated_at,
         l.closed_at, l.priority, l.deal_stage, l.became_opportunity_at, l.last_payment_status, l.last_payment_amount, l.total_paid,
         l.last_whatsapp_at, l.last_email_at, l.enquiry_at, l.sla_due_at, l.sla_15_breached_at, l.sla_24_breached_at,
         case when (select app.has_perm('leads.view_source')) then l.campaign_id end as campaign_id,
         case when (select app.has_perm('leads.view_source')) then l.ad_id end as ad_id,
         case when (select app.has_perm('leads.view_source')) then l.form_id end as form_id,
         case when (select app.has_perm('leads.view_source')) then l.page_id end as page_id,
         l.referral_code, l.merged_into_id
  from public.leads l
  where l.org_id = (select app.org_id())
    and ( (select app.role()) in ('SUPERADMIN','HQ_ADMIN')
       or ((select app.role()) = 'HQ_COUNSELLOR'    and l.owner_user_id = (select app.uid()))
       or ((select app.role()) = 'DISTRICT_MANAGER' and l.district_id = (select app.district_id()))
       or ((select app.role()) = 'CENTRE_ADMIN'     and l.current_centre_id = (select app.centre_id()))
       or ((select app.role()) = 'COUNSELLOR'       and l.current_centre_id = (select app.centre_id())
            and (l.owner_user_id = (select app.uid()) or (select app.centre_shows_all()))) );

-- ---- system-set follow-ups respect calling hours in the LEAD's timezone (TE-5). Body otherwise as in 0009.
create or replace function app.apply_disposition(p_lead uuid, p_disposition uuid, p_note text default null, p_followup_at timestamptz default null)
returns public.lifecycle language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  l public.leads := app.lead_for_write(p_lead);
  d public.dispositions; o public.orgs; v_to public.lifecycle; v_reason text; v_due timestamptz; v_n int;
begin
  select * into d from public.dispositions where id = p_disposition and org_id = l.org_id and is_active;
  if d.id is null then raise exception 'DISPOSITION_NOT_FOUND' using errcode = 'P0002'; end if;
  if l.lifecycle in ('DEAD','ENROLLED') then raise exception 'LEAD_CLOSED' using errcode = 'P0001'; end if;
  if d.note_required and coalesce(trim(p_note), '') = '' then raise exception 'NOTE_REQUIRED' using errcode = 'P0001'; end if;
  if d.followup = 'user' and p_followup_at is null then raise exception 'FOLLOWUP_REQUIRED' using errcode = 'P0001'; end if;
  if p_followup_at <= now() then raise exception 'FOLLOWUP_IN_PAST' using errcode = 'P0001'; end if;
  select * into o from public.orgs where id = l.org_id;

  perform app.write_activity(l, 'call_outcome', jsonb_build_object('disposition_id', d.id, 'disposition', d.name,
                             'sentiment', d.sentiment, 'note', nullif(trim(p_note), '')));
  v_n := l.attempts + 1;
  if d.add_tag is not null and not d.add_tag = any (l.tags) then
    update public.leads set tags = tags || d.add_tag where id = p_lead;
  end if;
  v_to := case d.effect when 'to_interested' then 'INTERESTED' when 'to_dead' then 'DEAD' when 'to_enrolled' then 'ENROLLED'
          else case when l.lifecycle = 'ENQUIRY' then 'PROSPECT' else l.lifecycle end end;
  v_reason := case when d.effect = 'to_dead' then d.name end;
  if d.effect = 'none' and d.sentiment = 'neutral' and p_followup_at is null and v_n >= cardinality(o.cadence_days) then
    v_to := 'DEAD'; v_reason := 'Attempts exhausted';
  end if;
  perform app.set_lifecycle(l, v_to, v_reason);
  perform app.on_disposition(l, d, v_to);          -- deals hook; no-op until 0016

  update public.tasks set status = 'done', completed_at = now() where lead_id = p_lead and status = 'open' and type = 'followup'
    and (origin = 'system' or due_at <= now() or p_followup_at is not null or v_to in ('DEAD','ENROLLED'));
  if v_to not in ('DEAD','ENROLLED') then
    v_due := case d.followup
      when 'days' then now() + make_interval(days => d.followup_days)
      when 'cadence' then coalesce(l.first_touch_at, now()) + make_interval(days => o.cadence_days[v_n + 1]) end;
    if v_due is not null and v_due <= now() then v_due := now() + interval '1 day'; end if;
    v_due := coalesce(p_followup_at, app.next_calling_time(v_due, l.timezone, o));     -- the user's choice is never moved
    if v_due is not null and not exists (select from public.tasks where lead_id = p_lead and status = 'open' and type = 'followup') then
      insert into public.tasks (org_id, district_id, centre_id, lead_id, type, title, due_at, owner_user_id, origin, created_by)
      values (l.org_id, l.district_id, l.current_centre_id, p_lead, 'followup', 'Follow up: ' || d.name, v_due,
              coalesce(l.owner_user_id, app.uid()), case when p_followup_at is null then 'system' else 'user' end, app.uid());
    end if;
  end if;
  perform app.refresh_next_followup(p_lead);
  return v_to;
end $$;
create function app.on_disposition(l public.leads, d public.dispositions, p_to public.lifecycle) returns void language sql as $$ select $$;
revoke all on function app.on_disposition(public.leads, public.dispositions, public.lifecycle) from public;

-- ---- HQ pull-back (TE-6): back to the HQ pool, unassigned, custody recorded
alter table public.transfers alter column to_centre_id drop not null, alter column to_district_id drop not null;
create function app.pull_back_leads(p_leads uuid[], p_reason text) returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; l public.leads; n int := 0;
begin
  if not app.has_perm('leads.transfer') or app.role() not in ('SUPERADMIN','HQ_ADMIN') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  foreach v_id in array p_leads loop
    l := app.lead_for_write(v_id);
    continue when l.current_centre_id is null;
    if exists (select from public.leads x where x.current_centre_id is null and x.org_id = l.org_id and x.parent_identity_id = l.parent_identity_id) then continue; end if;
    insert into public.transfers (org_id, lead_id, from_centre_id, from_district_id, previous_owner_id, actor_user_id, reason)
    values (l.org_id, v_id, l.current_centre_id, l.district_id, l.owner_user_id, app.uid(), trim(p_reason));
    perform app.write_activity(l, 'lead_transferred_out', jsonb_build_object('reason', trim(p_reason)));
    update public.leads set current_centre_id = null, district_id = null, owner_user_id = null, assigned_at = null, assign_status = 'unassigned' where id = v_id;
    update public.tasks set status = 'cancelled', completed_at = now() where lead_id = v_id and status = 'open';
    perform app.refresh_next_followup(v_id);
    n := n + 1;
  end loop;
  perform app.audit('leads.pulled_back', 'leads', null, jsonb_build_object('count', n, 'reason', trim(p_reason), 'lead_ids', to_jsonb(p_leads[1:200])));
  return n;
end $$;
revoke all on function app.pull_back_leads(uuid[], text) from public;
grant execute on function app.pull_back_leads(uuid[], text) to authenticated;
-- HQ assigning out of the pool: assign_leads requires owner.centre = lead.centre, so routing a pooled lead is a transfer.

-- ---- saved views (WS-3) and lifecycle labels
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  user_id uuid not null references public.users(id),
  shared_centre_id uuid references public.centres(id),     -- NULL = private
  name text not null check (length(trim(name)) between 1 and 60),
  filters jsonb not null, columns text[],
  created_at timestamptz not null default now()
);
create index on public.saved_views (user_id);
create index on public.saved_views (shared_centre_id) where shared_centre_id is not null;
alter table public.saved_views enable row level security;
grant select, insert, delete on public.saved_views to authenticated;
create policy sv_read on public.saved_views for select to authenticated using (org_id = app.org_id() and (user_id = app.uid() or shared_centre_id = app.centre_id()));
create policy sv_insert on public.saved_views for insert to authenticated
  with check (org_id = app.org_id() and user_id = app.uid() and not app.read_only() and (shared_centre_id is null or shared_centre_id = app.centre_id()));
create policy sv_delete on public.saved_views for delete to authenticated using (user_id = app.uid() and not app.read_only());

create table public.lifecycle_labels (
  org_id uuid not null references public.orgs(id), state public.lifecycle not null, label text not null check (length(trim(label)) between 1 and 30),
  primary key (org_id, state)
);
alter table public.lifecycle_labels enable row level security;
grant select, insert, update on public.lifecycle_labels to authenticated;
create policy ll_read on public.lifecycle_labels for select to authenticated using (org_id = app.org_id());
create policy ll_insert on public.lifecycle_labels for insert to authenticated with check (org_id = app.org_id() and app.has_perm('config.manage') and not app.read_only());
create policy ll_update on public.lifecycle_labels for update to authenticated using (org_id = app.org_id() and app.has_perm('config.manage') and not app.read_only()) with check (org_id = app.org_id());
create trigger audit_lifecycle_labels after insert or update on public.lifecycle_labels for each row execute function app.audit_row_change();

-- org-level lead configuration, edited from Admin > Lead configuration
create function app.update_lead_config(p jsonb) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if app.read_only() or not app.has_perm('config.manage') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  update public.orgs set
    cadence_days = coalesce((select array_agg(x::int order by ord) from jsonb_array_elements_text(p->'cadence_days') with ordinality t(x, ord)), cadence_days),
    calling_start = coalesce((p->>'calling_start')::time, calling_start), calling_end = coalesce((p->>'calling_end')::time, calling_end),
    working_days = coalesce((select array_agg(x::int) from jsonb_array_elements_text(p->'working_days') x), working_days),
    sla_first_touch_minutes = coalesce((p->>'sla_first_touch_minutes')::int, sla_first_touch_minutes),
    sla_untouched_hours = coalesce((p->>'sla_untouched_hours')::int, sla_untouched_hours),
    cross_centre_policy = coalesce(p->>'cross_centre_policy', cross_centre_policy),
    referral_window_days = coalesce((p->>'referral_window_days')::int, referral_window_days),
    renewal_lead_days = coalesce((p->>'renewal_lead_days')::int, renewal_lead_days)
  where id = app.org_id();
  perform app.audit('config.lead_settings_changed', 'orgs', app.org_id()::text, p);
end $$;
revoke all on function app.update_lead_config(jsonb) from public;
grant execute on function app.update_lead_config(jsonb) to authenticated;
-- orgs columns are readable by every tenant user (org_read policy); nothing secret lives there.

-- Activity metrics are scoped by WHERE THE WORK HAPPENED (the activity's own stamp), not by who holds the
-- lead today, so a centre's numbers don't change when HQ transfers a lead away. Plain predicates: index-friendly.
create view public.activity_scope with (security_barrier = false) as
  select a.id, a.org_id, a.district_id, a.centre_id, a.lead_id, a.actor_user_id, a.type, a.created_at,
         a.payload->>'sentiment' as sentiment, a.payload->>'disposition' as disposition
  from public.activities a
  where a.org_id = (select app.org_id())
    and ( (select app.role()) in ('SUPERADMIN','HQ_ADMIN')
       or ((select app.role()) = 'DISTRICT_MANAGER' and a.district_id = (select app.district_id()))
       or ((select app.role()) = 'CENTRE_ADMIN' and a.centre_id = (select app.centre_id()))
       or ((select app.role()) in ('COUNSELLOR','HQ_COUNSELLOR') and a.actor_user_id = (select app.uid())) );
grant select on public.activity_scope to authenticated;
-- deliberately exposes no payload text (notes), only counts-friendly columns
