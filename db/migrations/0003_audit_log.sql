-- Immutable audit trail (TEN-10, PRD s14: retained 2 years).
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id),
  district_id uuid,
  centre_id uuid,
  -- no FK on actor/target: an audit write must never fail on a reference
  actor_user_id uuid,
  impersonating boolean not null default false,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}',
  ip inet,
  created_at timestamptz not null default now()
);
create index on public.audit_log (org_id, created_at desc);
create index on public.audit_log (centre_id, created_at desc);
create index on public.audit_log (actor_user_id, created_at desc);
create index on public.audit_log (action, created_at desc);

create function app.audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only' using errcode = 'insufficient_privilege';
end $$;
create trigger audit_no_update before update or delete on public.audit_log
  for each row execute function app.audit_immutable();
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_immutable();

alter table public.audit_log enable row level security;
grant select on public.audit_log to authenticated;  -- inserts only via app.audit()

-- Single writer. Actor and scope come from claims, never from the caller's arguments.
create function app.audit(p_action text, p_target_type text, p_target_id text,
                          p_metadata jsonb default '{}', p_centre uuid default null,
                          p_district uuid default null)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  insert into public.audit_log (org_id, district_id, centre_id, actor_user_id, impersonating,
                                action, target_type, target_id, metadata, ip)
  values (app.org_id(),
          coalesce(p_district, app.district_id()),
          coalesce(p_centre, app.centre_id()),
          coalesce((app.claims()->>'real_user_id')::uuid, app.uid()),
          app.read_only(), p_action, p_target_type, p_target_id,
          coalesce(p_metadata, '{}'), nullif(app.claims()->>'ip', '')::inet);
end $$;
revoke all on function app.audit(text, text, text, jsonb, uuid, uuid) from public;
grant execute on function app.audit(text, text, text, jsonb, uuid, uuid) to authenticated;

-- Row-change audit for tenancy/config tables: fires regardless of which code path wrote.
create function app.audit_row_change() returns trigger language plpgsql
security definer set search_path = public, app, pg_temp as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  o uuid := coalesce((r->>'org_id')::uuid, app.org_id());
begin
  if o is null then return coalesce(new, old); end if;  -- seed/migration context, no tenant
  insert into public.audit_log (org_id, district_id, centre_id, actor_user_id, impersonating,
                                action, target_type, target_id, metadata, ip)
  values (o,
          case when tg_table_name = 'districts' then (r->>'id')::uuid else (r->>'district_id')::uuid end,
          case when tg_table_name = 'centres' then (r->>'id')::uuid else (r->>'centre_id')::uuid end,
          coalesce((app.claims()->>'real_user_id')::uuid, app.uid()),
          app.read_only(),
          tg_table_name || '.' || lower(tg_op), tg_table_name, r->>'id',
          case when tg_op = 'UPDATE'
               then jsonb_build_object('before', to_jsonb(old) - 'password_hash' - 'totp_secret_enc',
                                       'after', to_jsonb(new) - 'password_hash' - 'totp_secret_enc')
               else jsonb_build_object('row', r - 'password_hash' - 'totp_secret_enc') end,
          nullif(app.claims()->>'ip', '')::inet);
  return coalesce(new, old);
end $$;

create trigger audit_districts after insert or update on public.districts
  for each row execute function app.audit_row_change();
create trigger audit_centres after insert or update on public.centres
  for each row execute function app.audit_row_change();
