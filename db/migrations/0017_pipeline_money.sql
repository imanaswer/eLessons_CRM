-- PHASE 4: catalogue, deals, payments, enrolments, campaign spend, Conversions API queue, outbound webhooks.

create table public.catalogue_items (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id),
  name text not null, grade int check (grade between 8 and 12), plan text not null check (plan in ('all_subjects','single_subject')),
  stream text check (stream in ('PCMB','PCMC','Commerce')), subject text, mentorship boolean not null default false,
  website_params jsonb not null default '{}',           -- DL-6: how this item is addressed on elessons.net
  is_active boolean not null default true, created_at timestamptz not null default now(),
  check (stream is null or grade in (11, 12)), check ((plan = 'single_subject') = (subject is not null))
);
create table public.prices (     -- no price is ever hardcoded: rows only (brief s28)
  id uuid primary key default gen_random_uuid(), item_id uuid not null references public.catalogue_items(id),
  currency char(3) not null, region text not null default '', amount numeric(12,2) not null check (amount >= 0), is_active boolean not null default true,
  unique (item_id, currency, region)
);
create table public.deal_stages (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), name text not null, sort int not null,
  is_won boolean not null default false, is_lost boolean not null default false, is_active boolean not null default true,
  unique (org_id, name), check (not (is_won and is_lost))
);
create function app.seed_default_deal_stages(p_org uuid) returns void language sql as $$
  insert into public.deal_stages (org_id, name, sort, is_won, is_lost) values
    (p_org,'Qualified Lead',1,false,false),(p_org,'Counselling Done',2,false,false),(p_org,'Demo Shared',3,false,false),
    (p_org,'Plan Discussion',4,false,false),(p_org,'Enrollment Done',5,true,false),(p_org,'Deal Lost',6,false,true) on conflict do nothing
$$;
revoke all on function app.seed_default_deal_stages(uuid) from public;
select app.seed_default_deal_stages(id) from public.orgs;

alter table public.catalogue_items enable row level security; alter table public.prices enable row level security; alter table public.deal_stages enable row level security;
grant select, insert, update on public.catalogue_items, public.prices, public.deal_stages to authenticated;
create policy cat_read on public.catalogue_items for select to authenticated using (org_id = app.org_id());
create policy cat_ins on public.catalogue_items for insert to authenticated with check (org_id = app.org_id() and app.has_perm('catalogue.manage') and not app.read_only());
create policy cat_upd on public.catalogue_items for update to authenticated using (org_id = app.org_id() and app.has_perm('catalogue.manage') and not app.read_only()) with check (org_id = app.org_id());
create policy price_read on public.prices for select to authenticated using (exists (select from public.catalogue_items i where i.id = item_id));
create policy price_ins on public.prices for insert to authenticated with check (app.has_perm('catalogue.manage') and not app.read_only() and exists (select from public.catalogue_items i where i.id = item_id));
create policy price_upd on public.prices for update to authenticated using (app.has_perm('catalogue.manage') and not app.read_only() and exists (select from public.catalogue_items i where i.id = item_id));
create policy stage_read on public.deal_stages for select to authenticated using (org_id = app.org_id());
create policy stage_ins on public.deal_stages for insert to authenticated with check (org_id = app.org_id() and app.has_perm('config.manage') and not app.read_only());
create policy stage_upd on public.deal_stages for update to authenticated using (org_id = app.org_id() and app.has_perm('config.manage') and not app.read_only()) with check (org_id = app.org_id());
create trigger audit_prices after insert or update on public.prices for each row execute function app.audit_row_change();
create trigger audit_deal_stages after insert or update on public.deal_stages for each row execute function app.audit_row_change();

-- ---- deals (DL-1..4). Same pattern as leads: no table grants; read through deal_list; write through functions.
create table public.deals (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), district_id uuid, centre_id uuid,
  lead_id uuid not null references public.leads(id), student_id uuid references public.students(id),
  name text not null, kind text not null default 'new' check (kind in ('new','renewal')),
  amount numeric(12,2) not null default 0, currency char(3) not null default 'INR',
  stage_id uuid not null references public.deal_stages(id), previous_stage_id uuid references public.deal_stages(id), last_moved_at timestamptz not null default now(),
  last_note text, expected_close date, owner_user_id uuid references public.users(id), source_l1 text, source_l2 text,
  status text not null default 'open' check (status in ('open','won','lost')), lost_reason text,
  created_at timestamptz not null default now(), closed_at timestamptz,
  check (status <> 'lost' or lost_reason is not null)
);
create index on public.deals (lead_id); create index on public.deals (centre_id, status, stage_id); create index on public.deals (org_id, status, stage_id);
create index on public.deals (district_id, status); create index on public.deals (owner_user_id, status); create index on public.deals (student_id);
create table public.deal_items (
  id uuid primary key default gen_random_uuid(), deal_id uuid not null references public.deals(id), catalogue_item_id uuid references public.catalogue_items(id),
  price_id uuid references public.prices(id), description text not null, quantity int not null default 1 check (quantity > 0), unit_amount numeric(12,2) not null, amount numeric(12,2) not null
);
create index on public.deal_items (deal_id);
alter table public.deals enable row level security; alter table public.deal_items enable row level security;

create view public.deal_list with (security_barrier = false) as
  select d.*, st.name as stage, st.sort as stage_sort, st.is_won, st.is_lost
  from public.deals d join public.deal_stages st on st.id = d.stage_id
  where d.org_id = (select app.org_id())
    and ( (select app.role()) in ('SUPERADMIN','HQ_ADMIN')
       or ((select app.role()) = 'HQ_COUNSELLOR'    and d.owner_user_id = (select app.uid()))
       or ((select app.role()) = 'DISTRICT_MANAGER' and d.district_id = (select app.district_id()))
       or ((select app.role()) = 'CENTRE_ADMIN'     and d.centre_id = (select app.centre_id()))
       or ((select app.role()) = 'COUNSELLOR'       and d.centre_id = (select app.centre_id())
            and (d.owner_user_id = (select app.uid()) or (select app.centre_shows_all()))) );
grant select on public.deal_list to authenticated;
grant select on public.deal_items to authenticated;
create policy deal_items_read on public.deal_items for select to authenticated using (exists (select from public.deal_list v where v.id = deal_id));

-- custody follows the lead: a transfer / reassignment / pull-back moves its open deals with it
create function app.lead_custody_cascade() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.deals set centre_id = new.current_centre_id, district_id = new.district_id, owner_user_id = new.owner_user_id
   where lead_id = new.id and status = 'open';
  return new;
end $$;
create trigger leads_custody_cascade after update of current_centre_id, owner_user_id on public.leads for each row
  when (old.current_centre_id is distinct from new.current_centre_id or old.owner_user_id is distinct from new.owner_user_id) execute function app.lead_custody_cascade();

create function app.open_deal(l public.leads, p_student uuid, p_kind text, p_name text default null) returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; v_stage public.deal_stages;
begin
  select * into v_stage from public.deal_stages where org_id = l.org_id and is_active and not is_won and not is_lost order by sort limit 1;
  insert into public.deals (org_id, district_id, centre_id, lead_id, student_id, name, kind, stage_id, owner_user_id, source_l1, source_l2)
  values (l.org_id, l.district_id, l.current_centre_id, l.id, coalesce(p_student, (select id from public.students where lead_id = l.id order by created_at limit 1)),
          coalesce(p_name, 'DEAL-' || coalesce(l.name, 'lead') || ' ' || to_char(now(), 'YYYY-MM-DD')), p_kind, v_stage.id, l.owner_user_id, l.source_l1, l.source_l2)
  returning id into v_id;
  perform app.write_activity(l, 'deal_created', jsonb_build_object('deal_id', v_id, 'kind', p_kind));
  perform app.write_activity(l, 'deal_stage_change', jsonb_build_object('deal_id', v_id, 'from', null, 'to', v_stage.name));
  return v_id;
end $$;

create function app.close_deal(d public.deals, l public.leads, p_stage public.deal_stages, p_reason text, p_note text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_prev text;
begin
  select name into v_prev from public.deal_stages where id = d.stage_id;
  update public.deals set previous_stage_id = stage_id, stage_id = p_stage.id, last_moved_at = now(), last_note = coalesce(nullif(trim(p_note), ''), last_note),
         status = case when p_stage.is_won then 'won' when p_stage.is_lost then 'lost' else 'open' end,
         lost_reason = case when p_stage.is_lost then trim(p_reason) end, closed_at = case when p_stage.is_won or p_stage.is_lost then now() end where id = d.id;
  perform app.write_activity(l, 'deal_stage_change', jsonb_build_object('deal_id', d.id, 'from', v_prev, 'to', p_stage.name, 'reason', nullif(trim(p_reason), ''), 'note', nullif(trim(p_note), '')));
end $$;

create function app.create_deal(p_lead uuid, p_student uuid default null, p_items jsonb default '[]', p_expected_close date default null) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads := app.lead_for_write(p_lead); v_id uuid;
begin
  if not app.has_perm('deals.manage') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  if p_student is not null and not exists (select from public.students where id = p_student and lead_id = p_lead) then raise exception 'INVALID' using errcode = 'P0001'; end if;
  v_id := app.open_deal(l, p_student, 'new');
  update public.deals set expected_close = p_expected_close where id = v_id;
  perform app.set_deal_items(v_id, p_items);
  return v_id;
end $$;

-- line items always come from the catalogue price rows; the client sends price ids, never amounts
create function app.set_deal_items(p_deal uuid, p_items jsonb) returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare d public.deals; it jsonb; pr record; v_cur text;
begin
  select * into d from public.deals where id = p_deal;
  if d.id is null then raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.lead_for_write(d.lead_id);
  if not app.has_perm('deals.manage') or d.status <> 'open' then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  delete from public.deal_items where deal_id = p_deal;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    select p.id, p.amount, p.currency, i.id as item_id, i.name into pr from public.prices p join public.catalogue_items i on i.id = p.item_id
     where p.id = (it->>'price_id')::uuid and i.org_id = d.org_id and p.is_active and i.is_active;
    if pr.id is null then raise exception 'INVALID' using errcode = 'P0001'; end if;
    if v_cur is not null and v_cur <> pr.currency then raise exception 'MIXED_CURRENCY' using errcode = 'P0001'; end if;
    v_cur := pr.currency;
    insert into public.deal_items (deal_id, catalogue_item_id, price_id, description, quantity, unit_amount, amount)
    values (p_deal, pr.item_id, pr.id, pr.name, greatest(coalesce((it->>'qty')::int, 1), 1), pr.amount, pr.amount * greatest(coalesce((it->>'qty')::int, 1), 1));
  end loop;
  update public.deals set amount = coalesce((select sum(amount) from public.deal_items where deal_id = p_deal), 0), currency = coalesce(v_cur, currency) where id = p_deal;
end $$;

create function app.move_deal(p_deal uuid, p_stage uuid, p_lost_reason text default null, p_note text default null) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare d public.deals; l public.leads; st public.deal_stages;
begin
  select * into d from public.deals where id = p_deal for update;
  if d.id is null then raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002'; end if;
  l := app.lead_for_write(d.lead_id);
  if not app.has_perm('deals.manage') then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  select * into st from public.deal_stages where id = p_stage and org_id = d.org_id and is_active;
  if st.id is null then raise exception 'INVALID' using errcode = 'P0001'; end if;
  if d.status <> 'open' then raise exception 'DEAL_CLOSED' using errcode = 'P0001'; end if;
  if st.is_lost and coalesce(trim(p_lost_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;   -- DL-3
  perform app.close_deal(d, l, st, p_lost_reason, p_note);
  if st.is_won then perform app.set_lifecycle(l, 'ENROLLED', null);
  elsif st.is_lost and l.lifecycle = 'INTERESTED' and not exists (select from public.deals where lead_id = l.id and status = 'open') then
    perform app.set_lifecycle(l, 'DEAD', 'Deal lost');                  -- PRD s5 state diagram
    update public.tasks set status = 'cancelled', completed_at = now() where lead_id = l.id and status = 'open';
    perform app.refresh_next_followup(l.id);
  end if;
end $$;

-- disposition side effects (DL-1; "Enrolled: close deal as Won")
create or replace function app.on_disposition(l public.leads, d public.dispositions, p_to public.lifecycle) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_deal public.deals; v_won public.deal_stages;
begin
  if d.creates_deal and not exists (select from public.deals where lead_id = l.id and status = 'open') then perform app.open_deal(l, null, 'new'); end if;
  if d.effect = 'to_enrolled' then
    select * into v_won from public.deal_stages where org_id = l.org_id and is_won and is_active order by sort limit 1;
    for v_deal in select * from public.deals where lead_id = l.id and status = 'open' loop perform app.close_deal(v_deal, l, v_won, null, 'Marked enrolled by call outcome'); end loop;
  end if;
end $$;

-- ---- payments + enrolments (DL-8, DL-9, EL-4)
create table public.payments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), district_id uuid, centre_id uuid,
  lead_id uuid not null references public.leads(id), deal_id uuid references public.deals(id), student_id uuid references public.students(id),
  status text not null check (status in ('requested','received','partial','failed')), amount numeric(12,2) not null default 0, currency char(3) not null default 'INR',
  gateway text, channel text not null, external_id text not null, paid_at timestamptz, event_id uuid references public.inbound_events(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (org_id, external_id)
);
create index on public.payments (lead_id); create index on public.payments (centre_id, status, created_at desc); create index on public.payments (org_id, status, created_at desc); create index on public.payments (paid_at);
create table public.enrolments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), district_id uuid, centre_id uuid,   -- centre_id = credited centre
  lead_id uuid not null references public.leads(id), student_id uuid references public.students(id), deal_id uuid references public.deals(id),
  payment_id uuid not null unique references public.payments(id), grade int, academic_year text, access_end_date date,
  revenue numeric(12,2) not null, currency char(3) not null, enrolled_at timestamptz not null default now(), renewal_deal_id uuid references public.deals(id)
);
create index on public.enrolments (centre_id, enrolled_at); create index on public.enrolments (access_end_date) where renewal_deal_id is null; create index on public.enrolments (lead_id);
alter table public.payments enable row level security; alter table public.enrolments enable row level security;
grant select on public.payments, public.enrolments to authenticated;
-- ponytail: per-row lead lookup; fine for the paginated collections view. Give these a scope view like deal_list if a report scans them.
create policy payments_read on public.payments for select to authenticated using (app.lead_visible(lead_id));
create policy enrol_read on public.enrolments for select to authenticated using (app.lead_visible(lead_id));

-- Worker only. Idempotent per (external payment id, status). p: {status, amount, currency, external_id, gateway, channel, paid_at, deal_id,
--   student_name, grade, academic_year, access_end_date}
create function app.record_payment(p_event uuid, p_lead uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.inbound_events; l public.leads; pay public.payments; d public.deals; v_won public.deal_stages; v_student uuid; v_end date; v_status text := p->>'status';
begin
  if not app.is_worker() then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  select * into e from public.inbound_events where id = p_event for update;
  if e.processing_status = 'processed' then return jsonb_build_object('replayed', true, 'lead_id', e.lead_id); end if;
  if v_status not in ('requested','received','partial','failed') or nullif(p->>'external_id', '') is null then raise exception 'INVALID_PAYMENT_EVENT' using errcode = 'P0001'; end if;
  select * into l from public.leads where id = p_lead and org_id = e.org_id for update;
  if l.id is null then raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002'; end if;

  select * into pay from public.payments where org_id = e.org_id and external_id = p->>'external_id' for update;
  if pay.id is not null and pay.status = v_status then           -- the gateway AND the LMS both reported it: second one is a no-op
    update public.inbound_events set processing_status = 'processed', processed_at = now(), outcome = 'payment', lead_id = l.id, locked_at = null, error = null where id = e.id;
    return jsonb_build_object('duplicate', true, 'lead_id', l.id, 'payment_id', pay.id);
  end if;
  select * into d from public.deals where lead_id = l.id and status = 'open' and (id = nullif(p->>'deal_id', '')::uuid or nullif(p->>'deal_id', '') is null) order by created_at desc limit 1;
  if pay.id is null then
    insert into public.payments (org_id, district_id, centre_id, lead_id, deal_id, status, amount, currency, gateway, channel, external_id, paid_at, event_id)
    values (l.org_id, l.district_id, l.current_centre_id, l.id, d.id, v_status, coalesce((p->>'amount')::numeric, 0), coalesce(nullif(p->>'currency', ''), 'INR'), p->>'gateway',
            coalesce(p->>'channel', e.channel), p->>'external_id', case when v_status in ('received','partial') then coalesce((p->>'paid_at')::timestamptz, now()) end, e.id) returning * into pay;
  else
    update public.payments set status = v_status, amount = coalesce((p->>'amount')::numeric, amount), updated_at = now(),
           paid_at = case when v_status in ('received','partial') then coalesce((p->>'paid_at')::timestamptz, now()) else paid_at end where id = pay.id returning * into pay;
  end if;
  perform app.write_activity(l, 'payment', jsonb_build_object('payment_id', pay.id, 'status', v_status, 'amount', pay.amount, 'currency', pay.currency, 'gateway', pay.gateway));

  if v_status = 'failed' and l.owner_user_id is not null then
    insert into public.tasks (org_id, district_id, centre_id, lead_id, type, title, due_at, owner_user_id, origin)
    values (l.org_id, l.district_id, l.current_centre_id, l.id, 'payment_followup', 'Payment failed: help the parent complete it', now(), l.owner_user_id, 'system');
    perform app.refresh_next_followup(l.id);
  elsif v_status = 'received' then
    if d.id is null then d.id := app.open_deal(l, null, 'new'); select * into d from public.deals where id = d.id; end if;
    update public.deals set amount = case when amount = 0 then pay.amount else amount end, currency = pay.currency where id = d.id;
    update public.payments set deal_id = d.id where id = pay.id;
    select * into v_won from public.deal_stages where org_id = l.org_id and is_won and is_active order by sort limit 1;
    perform app.close_deal(d, l, v_won, null, 'Payment received');
    perform app.set_lifecycle(l, 'ENROLLED', null);
    update public.tasks set status = 'done', completed_at = now() where lead_id = l.id and status = 'open' and type in ('followup','payment_followup','call');
    perform app.refresh_next_followup(l.id);
    -- the student this payment is for: the deal's, else by name, else created from the payload
    v_student := coalesce(d.student_id, (select id from public.students where lead_id = l.id and lower(name) = lower(trim(p->>'student_name')) limit 1));
    if v_student is null and nullif(trim(p->>'student_name'), '') is not null then
      insert into public.students (org_id, district_id, centre_id, lead_id, name, grade) values (l.org_id, l.district_id, l.current_centre_id, l.id, trim(p->>'student_name'),
        case when (p->>'grade') ~ '^(8|9|10|11|12)$' then (p->>'grade')::int end) returning id into v_student;
    end if;
    v_student := coalesce(v_student, (select id from public.students where lead_id = l.id order by created_at limit 1));
    -- PLACEHOLDER rule when the checkout does not send access_end_date: 31 March after payment (Indian academic year). See NEEDED.md.
    v_end := coalesce((p->>'access_end_date')::date, make_date(extract(year from now())::int + case when extract(month from now()) > 3 then 1 else 0 end, 3, 31));
    if v_student is not null then
      update public.students set access_end_date = v_end, academic_year = coalesce(nullif(p->>'academic_year', ''), academic_year),
             grade = coalesce(case when (p->>'grade') ~ '^(8|9|10|11|12)$' then (p->>'grade')::int end, grade) where id = v_student;
    end if;
    insert into public.enrolments (org_id, district_id, centre_id, lead_id, student_id, deal_id, payment_id, grade, academic_year, access_end_date, revenue, currency)
    values (l.org_id, l.district_id, l.current_centre_id, l.id, v_student, d.id, pay.id, (select grade from public.students where id = v_student), nullif(p->>'academic_year', ''), v_end, pay.amount, pay.currency)
    on conflict (payment_id) do nothing;
    perform app.notify(l.owner_user_id, 'payment_received', 'Payment received: ' || coalesce(l.name, 'a parent'), pay.currency || ' ' || pay.amount, l.id);
  end if;
  update public.inbound_events set processing_status = 'processed', processed_at = now(), outcome = 'payment', lead_id = l.id, locked_at = null, error = null where id = e.id;
  return jsonb_build_object('lead_id', l.id, 'payment_id', pay.id, 'status', v_status);
end $$;

-- DL-7: a payment request raised by a user; the link itself is built by the app from CHECKOUT_BASE_URL
create function app.request_payment(p_deal uuid) returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare d public.deals; l public.leads; v_id uuid;
begin
  select * into d from public.deals where id = p_deal;
  if d.id is null then raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002'; end if;
  l := app.lead_for_write(d.lead_id);
  if not app.has_perm('deals.manage') or d.status <> 'open' then raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege'; end if;
  insert into public.payments (org_id, district_id, centre_id, lead_id, deal_id, student_id, status, amount, currency, channel, external_id)
  values (d.org_id, d.district_id, d.centre_id, d.lead_id, d.id, d.student_id, 'requested', d.amount, d.currency, 'crm_link', 'req_' || replace(gen_random_uuid()::text, '-', '')) returning id into v_id;
  perform app.write_activity(l, 'payment', jsonb_build_object('payment_id', v_id, 'status', 'requested', 'amount', d.amount, 'currency', d.currency));
  return v_id;
end $$;

-- ---- campaign spend (RP-5). Attribution key is (centre, campaign id): one centre's spend is never joined to another's leads.
create table public.campaign_spend (
  org_id uuid not null references public.orgs(id), district_id uuid, centre_id uuid, connection_id uuid not null references public.connections(id),
  day date not null, campaign_id text not null, campaign_name text, ad_id text not null default '', ad_name text,
  spend numeric(12,2) not null, currency char(3) not null, impressions int not null default 0, clicks int not null default 0,
  primary key (connection_id, day, campaign_id, ad_id)
);
create index on public.campaign_spend (org_id, day); create index on public.campaign_spend (centre_id, day);
alter table public.campaign_spend enable row level security;
grant select on public.campaign_spend to authenticated;
create policy spend_read on public.campaign_spend for select to authenticated
  using (app.can_see(org_id, district_id, centre_id) and app.role() in ('SUPERADMIN','HQ_ADMIN','DISTRICT_MANAGER','CENTRE_ADMIN'));
create function app.upsert_spend(p_conn uuid, p_rows jsonb) returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.connections; n int;
begin
  select * into c from public.connections where id = p_conn;
  insert into public.campaign_spend (org_id, district_id, centre_id, connection_id, day, campaign_id, campaign_name, ad_id, ad_name, spend, currency, impressions, clicks)
  select c.org_id, c.district_id, c.centre_id, c.id, (r->>'date_start')::date, r->>'campaign_id', r->>'campaign_name', coalesce(r->>'ad_id', ''), r->>'ad_name',
         coalesce((r->>'spend')::numeric, 0), coalesce(r->>'account_currency', 'INR'), coalesce((r->>'impressions')::int, 0), coalesce((r->>'clicks')::int, 0)
  from jsonb_array_elements(p_rows) r
  on conflict (connection_id, day, campaign_id, ad_id) do update set spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks, campaign_name = excluded.campaign_name, ad_name = excluded.ad_name;
  get diagnostics n = row_count; return n;
end $$;

-- ---- Meta Conversions API queue (brief s23): idempotent per lead, event and enquiry cycle
create table public.conversion_events (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), district_id uuid, centre_id uuid,
  lead_id uuid not null references public.leads(id), connection_id uuid references public.connections(id),
  event_name text not null check (event_name in ('Interested','Enrolled')), event_key text not null unique,
  status text not null default 'pending' check (status in ('pending','sent','failed','dead','skipped')),
  attempts int not null default 0, next_retry_at timestamptz not null default now(), last_error text, sent_at timestamptz, created_at timestamptz not null default now()
);
create index on public.conversion_events (next_retry_at) where status in ('pending','failed');
alter table public.conversion_events enable row level security;
grant select on public.conversion_events to authenticated;
create policy conv_read on public.conversion_events for select to authenticated
  using (app.can_see(org_id, district_id, centre_id) and app.role() in ('SUPERADMIN','HQ_ADMIN','DISTRICT_MANAGER','CENTRE_ADMIN'));

create or replace function app.set_lifecycle(p_lead public.leads, p_to public.lifecycle, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.connections;
begin
  if p_lead.lifecycle is not distinct from p_to then return; end if;
  perform app.write_activity(p_lead, 'lifecycle_change', jsonb_build_object('from', p_lead.lifecycle, 'to', p_to, 'reason', p_reason));
  if p_to in ('INTERESTED','ENROLLED') and p_lead.page_id is not null then       -- only leads that came from a Meta page report back to Meta
    select * into c from public.connections where kind = 'meta_page' and external_id = p_lead.page_id and status <> 'disabled';
    insert into public.conversion_events (org_id, district_id, centre_id, lead_id, connection_id, event_name, event_key, status, last_error)
    values (p_lead.org_id, p_lead.district_id, p_lead.current_centre_id, p_lead.id, c.id, initcap(p_to::text),
            p_lead.id || ':' || p_to || ':' || extract(epoch from p_lead.enquiry_at)::bigint,
            case when c.id is null or nullif(c.config->>'pixel_id', '') is null then 'skipped' else 'pending' end,
            case when c.id is null then 'Page is not connected' when nullif(c.config->>'pixel_id', '') is null then 'No dataset (pixel) id configured for this page' end)
    on conflict (event_key) do nothing;
  end if;
end $$;

create function app.claim_conversions(p_limit int default 20) returns table (id uuid, event_name text, event_key text, created_at timestamptz, pixel_id text, secret_enc text, connection_id uuid,
  phone_hash text, email_hash text, revenue numeric, currency text) language sql security definer set search_path = public, pg_temp as $$
  with picked as (select ce.id from public.conversion_events ce where ce.status in ('pending','failed') and ce.next_retry_at <= now() order by ce.created_at limit p_limit for update skip locked),
       upd as (update public.conversion_events ce set attempts = ce.attempts + 1, next_retry_at = now() + interval '10 minutes' from picked where ce.id = picked.id returning ce.*)
  select u.id, u.event_name, u.event_key, u.created_at, c.config->>'pixel_id', c.secret_enc, c.id, i.phone_hash, i.email_hash, l.total_paid, 'INR'
  from upd u join public.connections c on c.id = u.connection_id join public.leads l on l.id = u.lead_id join public.parent_identities i on i.id = l.parent_identity_id
$$;
create function app.finish_conversion(p_id uuid, p_error text) returns void language sql security definer set search_path = public, pg_temp as $$
  update public.conversion_events set status = case when p_error is null then 'sent' when attempts >= 6 then 'dead' else 'failed' end, last_error = left(p_error, 500),
         sent_at = case when p_error is null then now() end, next_retry_at = now() + make_interval(mins => (power(2, attempts))::int) where id = p_id
$$;

-- ---- outbound deliveries: HQ webhook subscriptions and the automation "call webhook" action share one retried queue
create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), connection_id uuid references public.connections(id),
  url text not null, event text not null, payload jsonb not null, status text not null default 'pending' check (status in ('pending','sent','failed','dead')),
  attempts int not null default 0, next_retry_at timestamptz not null default now(), last_error text, created_at timestamptz not null default now(), sent_at timestamptz
);
create index on public.webhook_deliveries (next_retry_at) where status in ('pending','failed');
alter table public.webhook_deliveries enable row level security;
grant select on public.webhook_deliveries to authenticated;
create policy wd_read on public.webhook_deliveries for select to authenticated using (org_id = app.org_id() and app.role() in ('SUPERADMIN','HQ_ADMIN'));
create function app.claim_deliveries(p_limit int default 20) returns table (id uuid, url text, event text, payload jsonb, secret_enc text) language sql security definer set search_path = public, pg_temp as $$
  with picked as (select d.id from public.webhook_deliveries d where d.status in ('pending','failed') and d.next_retry_at <= now() order by d.created_at limit p_limit for update skip locked),
       upd as (update public.webhook_deliveries d set attempts = d.attempts + 1, next_retry_at = now() + interval '10 minutes' from picked where d.id = picked.id returning d.*)
  select u.id, u.url, u.event, u.payload, c.secret_enc from upd u left join public.connections c on c.id = u.connection_id
$$;
create function app.finish_delivery(p_id uuid, p_error text) returns void language sql security definer set search_path = public, pg_temp as $$
  update public.webhook_deliveries set status = case when p_error is null then 'sent' when attempts >= 6 then 'dead' else 'failed' end, last_error = left(p_error, 500),
         sent_at = case when p_error is null then now() end, next_retry_at = now() + make_interval(mins => (power(2, attempts))::int) where id = p_id
$$;

do $$ declare f text; begin
  foreach f in array array['app.open_deal(public.leads, uuid, text, text)', 'app.close_deal(public.deals, public.leads, public.deal_stages, text, text)', 'app.on_disposition(public.leads, public.dispositions, public.lifecycle)'] loop
    execute format('revoke all on function %s from public', f); end loop;
  foreach f in array array['app.create_deal(uuid, uuid, jsonb, date)', 'app.set_deal_items(uuid, jsonb)', 'app.move_deal(uuid, uuid, text, text)', 'app.request_payment(uuid)'] loop
    execute format('revoke all on function %s from public', f); execute format('grant execute on function %s to authenticated', f); end loop;
  foreach f in array array['app.record_payment(uuid, uuid, jsonb)', 'app.upsert_spend(uuid, jsonb)', 'app.claim_conversions(int)', 'app.finish_conversion(uuid, text)', 'app.claim_deliveries(int)', 'app.finish_delivery(uuid, text)'] loop
    execute format('revoke all on function %s from public', f); execute format('grant execute on function %s to elessons_worker', f); end loop;
end $$;
