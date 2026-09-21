-- "Repeat enquiry" from the action menu (walk-in or call from a closed lead). Done in SQL because the
-- user may have phone masking on; it still goes through the gate like every other source.
create function app.repeat_enquiry(p_lead uuid) returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads := app.lead_for_write(p_lead); v_event uuid;
begin
  v_event := app.receive_event('manual', l.current_centre_id, 'repeat:' || gen_random_uuid(), jsonb_build_object('repeat_of', p_lead));
  return app.ingest_lead(v_event, jsonb_build_object('phone', l.primary_phone, 'repeat_enquiry', true));
end $$;
revoke all on function app.repeat_enquiry(uuid) from public;
grant execute on function app.repeat_enquiry(uuid) to authenticated;
