-- The payment webhook must find the gateway's signing secret before any session exists (same rule as app.auth_*).
create function app.payment_connection(p_gateway text) returns table (id uuid, external_id text, secret_enc text)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.external_id, c.secret_enc from public.connections c
  where c.kind = 'payment' and c.status <> 'disabled' and coalesce(c.config->>'gateway', 'generic') = p_gateway limit 1
$$;
revoke all on function app.payment_connection(text) from public;
grant execute on function app.payment_connection(text) to elessons_app;
