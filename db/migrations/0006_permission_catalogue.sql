-- Reference data: the permission keys the code checks. Which role gets which key is
-- per-org data in role_permissions (seeded by app.seed_default_role_permissions, editable by Superadmin).
insert into public.permissions (key, grp, description) values
  ('centres.manage',      'administration',  'Create, edit and deactivate districts and centres'),
  ('centres.impersonate', 'administration',  'View the app as a centre (read-only)'),
  ('users.manage',        'administration',  'Create, disable and reset users within own scope'),
  ('audit.view',          'administration',  'Read the audit log within own scope'),
  ('leads.export',        'data_operations', 'Export leads'),
  ('leads.bulk_select',   'data_operations', 'Select all leads for bulk actions'),
  ('leads.assign',        'assignment',      'Assign and reassign leads'),
  ('leads.transfer',      'assignment',      'Transfer leads between centres'),
  ('leads.view_phone',    'privacy',         'See unmasked phone numbers'),
  ('leads.view_source',   'privacy',         'See lead source'),
  ('leads.view_prior_activity', 'privacy',   'See activity from before the latest assignment'),
  ('leads.view_other_owners',   'visibility','See leads owned by other users in scope');

create function app.seed_default_role_permissions(p_org uuid) returns void language sql as $$
  insert into public.role_permissions (org_id, role, permission_key, allowed)
  select p_org, r.role, p.key,
    case r.role
      when 'HQ_ADMIN' then true
      when 'HQ_COUNSELLOR' then p.key in ('leads.view_phone','leads.view_source','leads.view_prior_activity')
      when 'DISTRICT_MANAGER' then p.key not in ('centres.manage','centres.impersonate','users.manage')
      when 'CENTRE_ADMIN' then p.key in ('users.manage','audit.view','leads.assign','leads.view_phone','leads.view_source','leads.view_other_owners','leads.bulk_select')
      when 'COUNSELLOR' then p.key in ('leads.view_phone','leads.view_source')
      else true end
  from public.permissions p
  cross join (select unnest(enum_range(null::public.app_role)) as role) r
  on conflict do nothing
$$;
revoke all on function app.seed_default_role_permissions(uuid) from public;
