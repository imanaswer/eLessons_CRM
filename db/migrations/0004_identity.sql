create table public.users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  district_id uuid references public.districts(id),
  centre_id uuid references public.centres(id),
  username text not null check (username = lower(username) and username ~ '^[a-z0-9._-]{3,40}$'),
  display_name text not null,
  email text,
  phone text,
  role public.app_role not null,
  password_hash text not null,
  must_change_password boolean not null default true,
  totp_secret_enc text,                       -- TEN-9 (P1): column reserved, flow not built yet
  totp_enabled boolean not null default false,
  is_active boolean not null default true,
  failed_logins int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a user's scope columns must match their role
  constraint users_scope_matches_role check (
    (role in ('SUPERADMIN','HQ_ADMIN','HQ_COUNSELLOR') and district_id is null and centre_id is null)
    or (role = 'DISTRICT_MANAGER' and district_id is not null and centre_id is null)
    or (role in ('CENTRE_ADMIN','COUNSELLOR') and district_id is not null and centre_id is not null)
  )
);
-- username is unique inside its login scope (centre, district or HQ)
create unique index users_login_scope on public.users (coalesce(centre_id, district_id, org_id), username);
-- TEN-5: one active Centre Admin per centre
create unique index users_one_centre_admin on public.users (centre_id) where role = 'CENTRE_ADMIN' and is_active;
create index on public.users (org_id);
create index on public.users (district_id);
create index on public.users (centre_id);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  token_hash text not null unique,            -- sha256 of the cookie value; raw token never stored
  ip inet,
  user_agent text,
  impersonate_centre_id uuid references public.centres(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index on public.sessions (user_id) where revoked_at is null;

-- Permission matrix is data (TEN-7). Groups follow the PRD.
create table public.permissions (
  key text primary key,
  grp text not null check (grp in ('administration','data_operations','assignment','communication','visibility','privacy')),
  description text not null
);
create table public.role_permissions (
  org_id uuid not null references public.orgs(id),
  role public.app_role not null,
  permission_key text not null references public.permissions(key),
  allowed boolean not null,
  primary key (org_id, role, permission_key)
);

create function app.has_perm(p_key text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.role() = 'SUPERADMIN' or coalesce((
    select allowed from public.role_permissions
    where org_id = app.org_id() and role = app.role()::public.app_role and permission_key = p_key), false)
$$;
revoke all on function app.has_perm(text) from public;
grant execute on function app.has_perm(text) to authenticated;

alter table public.users enable row level security;
alter table public.sessions enable row level security;        -- no policies, no grants: definer functions only
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

-- Column grant: password_hash / totp secret / lockout state are never selectable by the app's tenant role.
grant select (id, org_id, district_id, centre_id, username, display_name, email, phone, role,
              must_change_password, totp_enabled, is_active, last_login_at, created_by, created_at, updated_at)
  on public.users to authenticated;
grant select on public.permissions to authenticated;
grant select, insert, update on public.role_permissions to authenticated;

create policy users_read on public.users for select to authenticated
  using (app.can_see(org_id, district_id, centre_id));
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_perm_read on public.role_permissions for select to authenticated using (org_id = app.org_id());
create policy role_perm_insert on public.role_permissions for insert to authenticated
  with check (org_id = app.org_id() and app.role() = 'SUPERADMIN' and not app.read_only());
create policy role_perm_update on public.role_permissions for update to authenticated
  using (org_id = app.org_id() and app.role() = 'SUPERADMIN' and not app.read_only())
  with check (org_id = app.org_id());

-- Tenancy writes (deferred from 0002)
create policy district_insert on public.districts for insert to authenticated
  with check (org_id = app.org_id() and app.is_hq() and app.has_perm('centres.manage') and not app.read_only());
create policy district_update on public.districts for update to authenticated
  using (org_id = app.org_id() and app.is_hq() and app.has_perm('centres.manage') and not app.read_only())
  with check (org_id = app.org_id());
create policy centre_insert on public.centres for insert to authenticated
  with check (org_id = app.org_id() and app.is_hq() and app.has_perm('centres.manage') and not app.read_only());
create policy centre_update on public.centres for update to authenticated
  using (org_id = app.org_id() and app.is_hq() and app.has_perm('centres.manage') and not app.read_only())
  with check (org_id = app.org_id());

create policy audit_read on public.audit_log for select to authenticated
  using (app.has_perm('audit.view') and app.can_see(org_id, district_id, centre_id));

create trigger audit_users after insert or update of role, is_active, centre_id, district_id, username, display_name
  on public.users for each row execute function app.audit_row_change();
create trigger audit_role_permissions after insert or update on public.role_permissions
  for each row execute function app.audit_row_change();

-- ---------- user management (definer: password_hash is not writable by `authenticated`) ----------
-- Scope rule: HQ manages anyone in the org; a Centre Admin manages only COUNSELLORs of their own centre.
create function app.can_manage_user(t_org uuid, t_centre uuid, t_role public.app_role) returns boolean
language sql stable as $$
  select not app.read_only() and app.has_perm('users.manage') and t_org = app.org_id() and (
    app.role() = 'SUPERADMIN'
    or (app.role() = 'HQ_ADMIN' and t_role <> 'SUPERADMIN')
    or (app.role() = 'CENTRE_ADMIN' and t_role = 'COUNSELLOR' and t_centre = app.centre_id()))
$$;

create function app.create_user(p_username text, p_display_name text, p_role public.app_role,
                                p_password_hash text, p_centre uuid default null, p_district uuid default null,
                                p_email text default null, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_district uuid := p_district; v_id uuid;
begin
  if p_centre is not null then
    select district_id into v_district from public.centres where id = p_centre and org_id = app.org_id() and is_active;
    if v_district is null then raise exception 'CENTRE_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  if p_centre is null and p_district is not null
     and not exists (select from public.districts where id = p_district and org_id = app.org_id() and is_active) then
    raise exception 'DISTRICT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not app.can_manage_user(app.org_id(), p_centre, p_role) then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  insert into public.users (org_id, district_id, centre_id, username, display_name, role, password_hash, email, phone, created_by)
  values (app.org_id(), v_district, p_centre, lower(p_username), p_display_name, p_role, p_password_hash, p_email, p_phone, app.uid())
  returning id into v_id;
  return v_id;
end $$;

create function app.set_user_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare u public.users;
begin
  select * into u from public.users where id = p_user;
  if u.id is null or not app.can_manage_user(u.org_id, u.centre_id, u.role) or u.id = app.uid() then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  update public.users set is_active = p_active, updated_at = now() where id = p_user;
  if not p_active then
    update public.sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  end if;
end $$;

create function app.set_user_password(p_user uuid, p_password_hash text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare u public.users; v_self boolean;
begin
  select * into u from public.users where id = p_user;
  v_self := u.id = app.uid() and not app.read_only();
  if u.id is null or not (v_self or app.can_manage_user(u.org_id, u.centre_id, u.role)) then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  update public.users set password_hash = p_password_hash, must_change_password = not v_self,
         failed_logins = 0, locked_until = null, updated_at = now() where id = p_user;
  -- a reset by someone else kills the target's sessions
  if not v_self then update public.sessions set revoked_at = now() where user_id = p_user and revoked_at is null; end if;
  perform app.audit('user.password_' || case when v_self then 'changed' else 'reset' end, 'users', p_user::text, '{}', u.centre_id, u.district_id);
end $$;

-- Centre deactivation (PRD s17). Steps for integrations and active-lead transfer are
-- added to this function when those tables exist (Phase 1 / Phase 3). Nothing is deleted.
create function app.deactivate_centre(p_centre uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.centres;
begin
  select * into c from public.centres where id = p_centre and org_id = app.org_id();
  if c.id is null or not (app.is_hq() and app.has_perm('centres.manage')) or app.read_only() then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  update public.centres set is_active = false, accepts_inbound = false, deactivated_at = now(), updated_at = now() where id = p_centre;
  update public.users set is_active = false, updated_at = now() where centre_id = p_centre and is_active;
  update public.sessions s set revoked_at = now() from public.users u
    where s.user_id = u.id and u.centre_id = p_centre and s.revoked_at is null;
  perform app.audit('centre.deactivated', 'centres', p_centre::text, jsonb_build_object('reason', p_reason), p_centre, c.district_id);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'app.can_manage_user(uuid, uuid, public.app_role)',
    'app.create_user(text, text, public.app_role, text, uuid, uuid, text, text)',
    'app.set_user_active(uuid, boolean)', 'app.set_user_password(uuid, text)',
    'app.deactivate_centre(uuid, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
