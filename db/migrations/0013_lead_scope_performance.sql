-- Measured at 1M leads: list = 4.8 s (centre) / 40 s (HQ). Cause: app.can_see_lead() is a CASE over
-- per-row function calls, so no index applies, and has_perm() ran for every row below the LIMIT.
-- Fix: the scope rule becomes plain predicates over InitPlans (each `(select app.x())` runs ONCE per
-- query), and public.lead_list becomes the SINGLE definition of lead visibility: every other check
-- (child tables, write functions, search) asks the view instead of re-implementing the rule.
--
-- security_barrier is REMOVED on purpose. A barrier view is an optimisation fence: ORDER BY + LIMIT cannot
-- reach the (org|centre, created_at) indexes through it (measured: HQ page 1 = 1.3 s with, 2 ms without).
-- What a barrier defends against is a caller running hostile SQL (leaky functions / error-based probing)
-- as the tenant role. In this architecture the tenant role's identity IS a session GUC set by the app
-- server, so anyone able to run arbitrary SQL as `authenticated` could already set HQ claims; the barrier
-- adds no protection. The real control is: no SQL is ever built from user input (src/lib/leads-query.ts
-- whitelists every filter and binds every value). See SECURITY.md "Threat model".
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
         l.times_re_engaged, l.last_repeat_enquiry_at, l.anonymised_at, l.created_at, l.updated_at
  from public.leads l
  where l.org_id = (select app.org_id())          -- NULL claims => NULL => no rows (default deny)
    and ( (select app.role()) in ('SUPERADMIN','HQ_ADMIN')
       or ((select app.role()) = 'HQ_COUNSELLOR'    and l.owner_user_id = (select app.uid()))     -- HQ teams not modelled yet: own leads only
       or ((select app.role()) = 'DISTRICT_MANAGER' and l.district_id = (select app.district_id()))
       or ((select app.role()) = 'CENTRE_ADMIN'     and l.current_centre_id = (select app.centre_id()))
       or ((select app.role()) = 'COUNSELLOR'       and l.current_centre_id = (select app.centre_id())
            and (l.owner_user_id = (select app.uid()) or (select app.centre_shows_all()))) );

create or replace view public.lead_phone_list with (security_barrier = false) as
  select p.lead_id, p.is_primary,
         case when (select app.has_perm('leads.view_phone')) then p.phone_e164 else app.mask_phone(p.phone_e164) end as phone_e164
  from public.lead_phones p
  where exists (select from public.lead_list v where v.id = p.lead_id);

-- Direct access to the base table is now denied outright (RLS enabled + no policy), not merely scoped.
drop policy leads_read on public.leads;

create or replace function app.lead_visible(p_lead uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select from public.lead_list v where v.id = p_lead)
$$;

create or replace function app.activity_visible(p_lead uuid, p_centre uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select from public.lead_list v where v.id = p_lead
    and (app.has_perm('leads.view_prior_activity') or v.assigned_at is null or p_at >= v.assigned_at)
    and (app.has_perm('leads.view_other_centre_activity') or p_centre is not distinct from v.current_centre_id))
$$;

create or replace function app.lead_for_write(p_lead uuid) returns public.leads
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads;
begin
  if app.read_only() then raise exception 'READ_ONLY' using errcode = 'insufficient_privilege'; end if;
  select * into l from public.leads where id = p_lead for update;
  if l.id is null or not exists (select from public.lead_list v where v.id = p_lead) then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if l.anonymised_at is not null then raise exception 'LEAD_ERASED' using errcode = 'P0001'; end if;
  return l;
end $$;

-- Search runs against the base-table trigram indexes (name and phone are not plain columns of the view
-- once masking applies), then keeps only ids the caller can see. Returned as an array so the list query probes the PK.
-- ponytail: newest 5000 matches. At HQ a very common name can exceed that; narrow with a centre/date filter.
drop function app.search_lead_ids_by_phone(text);
create function app.search_lead_ids(p_q text) returns uuid[]
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_digits text := regexp_replace(p_q, '[^0-9]', '', 'g'); v_ids uuid[];
begin
  if length(v_digits) >= 4 and p_q ~ '^[0-9 +()-]+$' then
    if not app.has_perm('leads.view_phone') then return '{}'; end if;      -- no probing masked numbers digit by digit
    select array_agg(x.lead_id) into v_ids from (
      select p.lead_id from public.lead_phones p where p.phone_e164 like '%' || v_digits || '%'
        and exists (select from public.lead_list v where v.id = p.lead_id) limit 5000) x;
  elsif length(trim(p_q)) >= 3 then
    select array_agg(x.id) into v_ids from (
      select l.id from public.leads l where l.name ilike '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
        and exists (select from public.lead_list v where v.id = l.id) order by l.created_at desc limit 5000) x;
  end if;
  return coalesce(v_ids, '{}');
end $$;
revoke all on function app.search_lead_ids(text) from public;
grant execute on function app.search_lead_ids(text) to authenticated;

drop function app.can_see_lead(uuid, uuid, uuid, uuid);
