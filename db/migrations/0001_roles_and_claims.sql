-- Roles + claim helpers. Role names match Supabase so the same migrations run
-- on a hosted Supabase Postgres and on plain local Postgres.
-- Shared cluster roles are created only if absent and never altered.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  -- Web app login role. NOT superuser, NOT bypassrls, NOT table owner: every tenant
  -- query runs as `authenticated` (SET LOCAL ROLE) with per-request claims.
  if not exists (select from pg_roles where rolname = 'elessons_app') then
    create role elessons_app login noinherit nobypassrls;
  end if;
  -- Background worker: the only principal allowed to bypass RLS (PRD s13).
  if not exists (select from pg_roles where rolname = 'elessons_worker') then
    create role elessons_worker login bypassrls;
  end if;
end $$;

grant authenticated to elessons_app;

create schema if not exists app;
grant usage on schema app to authenticated, elessons_app, elessons_worker;

create type public.app_role as enum
  ('SUPERADMIN','HQ_ADMIN','HQ_COUNSELLOR','DISTRICT_MANAGER','CENTRE_ADMIN','COUNSELLOR');

-- Claims are set per request by the server (`SET LOCAL request.jwt.claims`), built
-- fresh from the sessions table on every request, so a disabled user or centre
-- loses access immediately (no stale-token window).
create function app.claims() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function app.uid() returns uuid language sql stable as $$ select (app.claims()->>'user_id')::uuid $$;
create function app.org_id() returns uuid language sql stable as $$ select (app.claims()->>'org_id')::uuid $$;
create function app.district_id() returns uuid language sql stable as $$ select (app.claims()->>'district_id')::uuid $$;
create function app.centre_id() returns uuid language sql stable as $$ select (app.claims()->>'centre_id')::uuid $$;
create function app.role() returns text language sql stable as $$ select app.claims()->>'role' $$;
create function app.is_hq() returns boolean language sql stable as $$
  select coalesce(app.role() in ('SUPERADMIN','HQ_ADMIN','HQ_COUNSELLOR'), false)
$$;
-- "View as centre" impersonation is read-only at the database, not just the UI.
create function app.read_only() returns boolean language sql stable as $$
  select coalesce((app.claims()->>'read_only')::boolean, false)
$$;

-- The one scope predicate every tenant table's policy reuses.
-- NULL claims compare to NULL -> false: default deny.
create function app.can_see(row_org uuid, row_district uuid, row_centre uuid)
returns boolean language sql stable as $$
  select coalesce(
    row_org = app.org_id() and (
      app.is_hq()
      or (app.role() = 'DISTRICT_MANAGER' and row_district = app.district_id())
      or (app.role() in ('CENTRE_ADMIN','COUNSELLOR') and row_centre = app.centre_id())
    ), false)
$$;
