-- AL-1: one append-only history table. district/centre = where it happened; visibility follows the lead.
create table public.activities (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id),
  district_id uuid, centre_id uuid,
  lead_id uuid not null references public.leads(id),
  student_id uuid references public.students(id),
  deal_id uuid,
  actor_user_id uuid,                        -- NULL = system
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.activities (lead_id, id desc);
create index on public.activities (centre_id, created_at desc);
create index on public.activities (actor_user_id, created_at desc);
create index on public.activities (org_id, type, created_at desc);
create trigger activities_no_update before update or delete on public.activities for each row execute function app.audit_immutable();
create trigger activities_no_truncate before truncate on public.activities for each statement execute function app.audit_immutable();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  district_id uuid, centre_id uuid,
  lead_id uuid not null references public.leads(id),
  student_id uuid references public.students(id),
  type text not null check (type in ('followup','call','whatsapp','send_demo','payment_followup','renewal','custom')),
  title text not null,
  due_at timestamptz not null,
  owner_user_id uuid references public.users(id),
  origin text not null check (origin in ('user','system')),      -- TE-3
  status text not null default 'open' check (status in ('open','done','cancelled')),
  completed_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index on public.tasks (lead_id, status);
create index on public.tasks (owner_user_id, status, due_at);
create index on public.tasks (centre_id, status, due_at);

alter table public.activities enable row level security;
alter table public.tasks enable row level security;
grant select on public.activities, public.tasks to authenticated;      -- writes via app.* only

-- TEN-8 / TR-3: two independent history toggles.
create function app.activity_visible(p_lead uuid, p_centre uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select from public.leads l where l.id = p_lead
    and app.can_see_lead(l.org_id, l.district_id, l.current_centre_id, l.owner_user_id)
    and (app.has_perm('leads.view_prior_activity') or l.assigned_at is null or p_at >= l.assigned_at)
    and (app.has_perm('leads.view_other_centre_activity') or p_centre is not distinct from l.current_centre_id))
$$;
revoke all on function app.activity_visible(uuid, uuid, timestamptz) from public;
grant execute on function app.activity_visible(uuid, uuid, timestamptz) to authenticated;
create policy activities_read on public.activities for select to authenticated using (app.activity_visible(lead_id, centre_id, created_at));
create policy tasks_read on public.tasks for select to authenticated using (app.lead_visible(lead_id));

-- ---------------------------------------------------------------- internals (not granted to anyone)
-- The projection is a pure function of the activity stream, so app.rebuild_projection can regenerate it.
create function app.project_activity(p_lead uuid, p_type text, p_payload jsonb, p_at timestamptz) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.leads set
    last_activity_at = p_at, updated_at = greatest(updated_at, p_at),
    first_touch_at   = case when p_type = 'call_outcome' then coalesce(first_touch_at, p_at) else first_touch_at end,
    last_worked_at   = case when p_type in ('call_outcome','note') then p_at else last_worked_at end,
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
    is_customer      = is_customer or (p_type = 'lifecycle_change' and p_payload->>'to' = 'ENROLLED')
  where id = p_lead
$$;

-- AL-2: activity insert and projection update are one statement pair in the caller's transaction.
create function app.write_activity(p_lead public.leads, p_type text, p_payload jsonb default '{}', p_student uuid default null)
returns bigint language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id bigint; v_at timestamptz := clock_timestamp();
begin
  insert into public.activities (org_id, district_id, centre_id, lead_id, student_id, actor_user_id, type, payload, created_at)
  values (p_lead.org_id, p_lead.district_id, p_lead.current_centre_id, p_lead.id, p_student,
          coalesce((app.claims()->>'real_user_id')::uuid, app.uid()), p_type, coalesce(p_payload, '{}'), v_at)
  returning id into v_id;
  perform app.project_activity(p_lead.id, p_type, p_payload, v_at);
  return v_id;
end $$;

create function app.refresh_next_followup(p_lead uuid) returns void language sql security definer set search_path = public, pg_temp as $$
  update public.leads l set next_followup_at = t.due_at, next_followup_origin = t.origin
  from (select 1) x left join lateral (select due_at, origin from public.tasks
        where lead_id = p_lead and status = 'open' order by due_at limit 1) t on true
  where l.id = p_lead
$$;

create function app.set_lifecycle(p_lead public.leads, p_to public.lifecycle, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if p_lead.lifecycle is distinct from p_to then
    perform app.write_activity(p_lead, 'lifecycle_change', jsonb_build_object('from', p_lead.lifecycle, 'to', p_to, 'reason', p_reason));
  end if;
end $$;

-- Every write function starts here: locks the row, and answers "not found" for leads the caller
-- cannot see, so existence in another centre is never confirmed.
create function app.lead_for_write(p_lead uuid) returns public.leads
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads;
begin
  if app.read_only() then raise exception 'READ_ONLY' using errcode = 'insufficient_privilege'; end if;
  select * into l from public.leads where id = p_lead for update;
  if l.id is null or not app.can_see_lead(l.org_id, l.district_id, l.current_centre_id, l.owner_user_id) then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if l.anonymised_at is not null then raise exception 'LEAD_ERASED' using errcode = 'P0001'; end if;
  return l;
end $$;

revoke all on function app.project_activity(uuid, text, jsonb, timestamptz), app.write_activity(public.leads, text, jsonb, uuid),
  app.refresh_next_followup(uuid), app.set_lifecycle(public.leads, public.lifecycle, text), app.lead_for_write(uuid) from public;

-- ---------------------------------------------------------------- user-facing lead operations
create function app.create_task(p_lead uuid, p_type text, p_title text, p_due timestamptz, p_owner uuid default null, p_student uuid default null)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads := app.lead_for_write(p_lead); v_id uuid; v_owner uuid := coalesce(p_owner, l.owner_user_id, app.uid());
begin
  if not exists (select from public.users u where u.id = v_owner and u.is_active and u.org_id = l.org_id
                 and (u.centre_id is not distinct from l.current_centre_id or u.centre_id is null)) then
    raise exception 'OWNER_NOT_IN_CENTRE' using errcode = 'P0001';
  end if;
  if p_type = 'followup' then   -- TE-3: a user-set follow-up replaces the pending system one
    update public.tasks set status = 'cancelled', completed_at = now() where lead_id = p_lead and status = 'open' and type = 'followup' and origin = 'system';
  end if;
  insert into public.tasks (org_id, district_id, centre_id, lead_id, student_id, type, title, due_at, owner_user_id, origin, created_by)
  values (l.org_id, l.district_id, l.current_centre_id, p_lead, p_student, p_type, p_title, p_due, v_owner, 'user', app.uid()) returning id into v_id;
  perform app.write_activity(l, 'task_created', jsonb_build_object('task_id', v_id, 'type', p_type, 'title', p_title, 'due_at', p_due), p_student);
  perform app.refresh_next_followup(p_lead);
  return v_id;
end $$;

create function app.complete_task(p_task uuid) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare t public.tasks; l public.leads;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null then raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002'; end if;
  l := app.lead_for_write(t.lead_id);
  update public.tasks set status = 'done', completed_at = now() where id = p_task and status = 'open';
  if found then
    perform app.write_activity(l, 'task_completed', jsonb_build_object('task_id', t.id, 'title', t.title), t.student_id);
    perform app.refresh_next_followup(t.lead_id);
  end if;
end $$;

create function app.add_note(p_lead uuid, p_note text) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads := app.lead_for_write(p_lead);
begin
  if coalesce(trim(p_note), '') = '' then raise exception 'NOTE_REQUIRED' using errcode = 'P0001'; end if;
  perform app.write_activity(l, 'note', jsonb_build_object('note', trim(p_note)));
end $$;

-- The disposition engine: the ONLY path that moves lifecycle during prospecting (TE-1, TE-3, TE-4).
create function app.apply_disposition(p_lead uuid, p_disposition uuid, p_note text default null, p_followup_at timestamptz default null)
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
  -- attempts exhausted: neutral outcome, cadence used up, and the user did not choose to keep going
  if d.effect = 'none' and d.sentiment = 'neutral' and p_followup_at is null and v_n >= cardinality(o.cadence_days) then
    v_to := 'DEAD'; v_reason := 'Attempts exhausted';
  end if;
  perform app.set_lifecycle(l, v_to, v_reason);

  -- this attempt satisfies whatever follow-up was pending
  update public.tasks set status = 'done', completed_at = now() where lead_id = p_lead and status = 'open' and type = 'followup'
    and (origin = 'system' or due_at <= now() or p_followup_at is not null or v_to in ('DEAD','ENROLLED'));
  if v_to not in ('DEAD','ENROLLED') then
    v_due := coalesce(p_followup_at, case d.followup
      when 'days' then now() + make_interval(days => d.followup_days)
      when 'cadence' then coalesce(l.first_touch_at, now()) + make_interval(days => o.cadence_days[v_n + 1]) end);
    if v_due is not null and v_due <= now() then v_due := now() + interval '1 day'; end if;
    if v_due is not null and not exists (select from public.tasks where lead_id = p_lead and status = 'open' and type = 'followup') then
      insert into public.tasks (org_id, district_id, centre_id, lead_id, type, title, due_at, owner_user_id, origin, created_by)
      values (l.org_id, l.district_id, l.current_centre_id, p_lead, 'followup', 'Follow up: ' || d.name, v_due,
              coalesce(l.owner_user_id, app.uid()), case when p_followup_at is null then 'system' else 'user' end, app.uid());
    end if;
  end if;
  perform app.refresh_next_followup(p_lead);
  return v_to;
end $$;

create function app.add_student(p_lead uuid, p_name text, p_grade int, p_stream text default null, p_school text default null,
                                p_board text default null, p_subjects text[] default '{}')
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads := app.lead_for_write(p_lead); v_id uuid;
begin
  insert into public.students (org_id, district_id, centre_id, lead_id, name, grade, stream, school, board, subjects)
  values (l.org_id, l.district_id, l.current_centre_id, p_lead, trim(p_name), p_grade, nullif(p_stream, ''), nullif(trim(p_school), ''),
          nullif(trim(p_board), ''), coalesce(p_subjects, '{}')) returning id into v_id;
  perform app.write_activity(l, 'student_added', jsonb_build_object('name', trim(p_name), 'grade', p_grade), v_id);
  return v_id;
end $$;

create function app.update_lead_contact(p_lead uuid, p_name text, p_email text, p_state text, p_city text, p_language text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads := app.lead_for_write(p_lead);
begin
  update public.leads set name = nullif(trim(p_name), ''), email = nullif(lower(trim(p_email)), ''), state = nullif(trim(p_state), ''),
         city = nullif(trim(p_city), ''), language = nullif(trim(p_language), '') where id = p_lead;
  perform app.write_activity(l, 'contact_edited', jsonb_build_object('fields', array['name','email','state','city','language']));
end $$;

create function app.tag_leads(p_leads uuid[], p_tag text) returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; l public.leads; n int := 0; v_tag text := lower(trim(p_tag));
begin
  if v_tag !~ '^[a-z0-9][a-z0-9 _-]{0,39}$' then raise exception 'INVALID' using errcode = 'P0001'; end if;
  foreach v_id in array p_leads loop
    l := app.lead_for_write(v_id);
    if not v_tag = any (l.tags) then
      update public.leads set tags = tags || v_tag where id = v_id;
      perform app.write_activity(l, 'tag_added', jsonb_build_object('tag', v_tag));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- AL-2 rebuild. HQ-only maintenance; proves the projection is derivable from the log.
create function app.rebuild_projection(p_lead uuid) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare a record;
begin
  if not app.has_perm('config.manage') or app.read_only() then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  perform app.lead_for_write(p_lead);
  update public.leads set lifecycle = 'ENQUIRY', closed_reason = null, is_customer = false, first_touch_at = null, last_worked_at = null,
    last_activity_at = null, attempts = 0, total_calls = 0, last_call_at = null, last_note_at = null, last_disposition_id = null,
    last_disposition_at = null, times_re_engaged = 0, last_repeat_enquiry_at = null where id = p_lead;
  for a in select type, payload, created_at from public.activities where lead_id = p_lead order by id loop
    perform app.project_activity(p_lead, a.type, a.payload, a.created_at);
  end loop;
  perform app.refresh_next_followup(p_lead);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'app.create_task(uuid, text, text, timestamptz, uuid, uuid)', 'app.complete_task(uuid)', 'app.add_note(uuid, text)',
    'app.apply_disposition(uuid, uuid, text, timestamptz)', 'app.add_student(uuid, text, int, text, text, text, text[])',
    'app.update_lead_contact(uuid, text, text, text, text, text)', 'app.tag_leads(uuid[], text)', 'app.rebuild_projection(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
