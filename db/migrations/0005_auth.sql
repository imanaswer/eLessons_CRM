-- Pre-auth and session functions. Executable ONLY by the web app's login role, before it
-- drops to `authenticated`. Tenant SQL can never call these.

-- p_code: centre code, district code, or NULL/'' for HQ users (TEN-2).
create function app.auth_lookup(p_code text, p_username text)
returns table (user_id uuid, password_hash text, locked_until timestamptz, totp_enabled boolean)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select u.id, u.password_hash, u.locked_until, u.totp_enabled
  from public.users u
  left join public.centres c on c.id = u.centre_id
  left join public.districts d on d.id = u.district_id
  where u.username = lower(trim(p_username)) and u.is_active
    and case
      when coalesce(trim(p_code), '') = '' then u.district_id is null
      else (c.code = upper(trim(p_code)) and c.is_active)
        or (u.centre_id is null and d.code = upper(trim(p_code)) and d.is_active)
    end
$$;

create function app.auth_record_failure(p_user uuid, p_ip inet)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare u public.users; o public.orgs;
begin
  update public.users set failed_logins = failed_logins + 1 where id = p_user returning * into u;
  select * into o from public.orgs where id = u.org_id;
  if u.failed_logins >= o.max_failed_logins then
    update public.users set locked_until = now() + make_interval(mins => o.lockout_minutes), failed_logins = 0 where id = p_user;
  end if;
  insert into public.audit_log (org_id, district_id, centre_id, actor_user_id, action, target_type, target_id, metadata, ip)
  values (u.org_id, u.district_id, u.centre_id, u.id, 'auth.login_failed', 'users', u.id::text,
          jsonb_build_object('locked', u.failed_logins >= o.max_failed_logins), p_ip);
end $$;

create function app.auth_create_session(p_user uuid, p_token_hash text, p_ip inet, p_user_agent text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare u public.users;
begin
  update public.users set failed_logins = 0, locked_until = null, last_login_at = now() where id = p_user returning * into u;
  insert into public.sessions (user_id, token_hash, ip, user_agent, expires_at)
  select p_user, p_token_hash, p_ip, p_user_agent, now() + make_interval(hours => o.session_hours)
  from public.orgs o where o.id = u.org_id;
  insert into public.audit_log (org_id, district_id, centre_id, actor_user_id, action, target_type, target_id, ip)
  values (u.org_id, u.district_id, u.centre_id, u.id, 'auth.login', 'users', u.id::text, p_ip);
end $$;

-- Called on EVERY request. Returns the claims to install, or NULL. Because it re-reads
-- users/centres each time, disabling a user or centre takes effect on the next request.
create function app.auth_session(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare s public.sessions; u public.users; c public.centres;
begin
  select * into s from public.sessions where token_hash = p_token_hash and revoked_at is null and expires_at > now();
  if s.id is null then return null; end if;
  select * into u from public.users where id = s.user_id and is_active;
  if u.id is null then return null; end if;
  if u.centre_id is not null and not exists (select from public.centres where id = u.centre_id and is_active) then return null; end if;
  if u.district_id is not null and not exists (select from public.districts where id = u.district_id and is_active) then return null; end if;
  update public.sessions set last_seen_at = now() where id = s.id and last_seen_at < now() - interval '5 minutes';

  if s.impersonate_centre_id is not null then
    -- TEN-6: HQ "view as centre" = that centre's admin view, read-only, real actor preserved
    if u.role not in ('SUPERADMIN','HQ_ADMIN') then return null; end if;
    select * into c from public.centres where id = s.impersonate_centre_id and org_id = u.org_id;
    if c.id is null then return null; end if;
    return jsonb_build_object('user_id', u.id, 'real_user_id', u.id, 'org_id', u.org_id,
      'district_id', c.district_id, 'centre_id', c.id, 'role', 'CENTRE_ADMIN', 'read_only', true,
      'display_name', u.display_name, 'impersonating_centre_code', c.code, 'must_change_password', false);
  end if;
  return jsonb_build_object('user_id', u.id, 'org_id', u.org_id, 'district_id', u.district_id,
    'centre_id', u.centre_id, 'role', u.role, 'read_only', false, 'display_name', u.display_name,
    'must_change_password', u.must_change_password);
end $$;

create function app.auth_revoke_session(p_token_hash text, p_ip inet)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare s public.sessions; u public.users;
begin
  update public.sessions set revoked_at = now() where token_hash = p_token_hash and revoked_at is null returning * into s;
  if s.id is null then return; end if;
  select * into u from public.users where id = s.user_id;
  insert into public.audit_log (org_id, district_id, centre_id, actor_user_id, action, target_type, target_id, ip)
  values (u.org_id, u.district_id, u.centre_id, u.id, 'auth.logout', 'users', u.id::text, p_ip);
end $$;

-- p_centre NULL = stop impersonating. Start and end are both audited (PRD s40).
create function app.auth_set_impersonation(p_token_hash text, p_centre uuid, p_ip inet)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare s public.sessions; u public.users; c public.centres; v_prev uuid;
begin
  select * into s from public.sessions where token_hash = p_token_hash and revoked_at is null and expires_at > now();
  select * into u from public.users where id = s.user_id and is_active;
  if u.id is null or u.role not in ('SUPERADMIN','HQ_ADMIN') then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  if u.role <> 'SUPERADMIN' and not exists (select from public.role_permissions
      where org_id = u.org_id and role = u.role and permission_key = 'centres.impersonate' and allowed) then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  v_prev := s.impersonate_centre_id;
  if p_centre is not null then
    select * into c from public.centres where id = p_centre and org_id = u.org_id;
    if c.id is null then raise exception 'CENTRE_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  update public.sessions set impersonate_centre_id = p_centre where id = s.id;
  insert into public.audit_log (org_id, district_id, centre_id, actor_user_id, impersonating, action, target_type, target_id, ip)
  values (u.org_id, c.district_id, coalesce(p_centre, v_prev), u.id, p_centre is not null,
          case when p_centre is null then 'impersonation.ended' else 'impersonation.started' end,
          'centres', coalesce(p_centre, v_prev)::text, p_ip);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'app.auth_lookup(text, text)', 'app.auth_record_failure(uuid, inet)',
    'app.auth_create_session(uuid, text, inet, text)', 'app.auth_session(text)',
    'app.auth_revoke_session(text, inet)', 'app.auth_set_impersonation(text, uuid, inet)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to elessons_app', f);
  end loop;
end $$;
