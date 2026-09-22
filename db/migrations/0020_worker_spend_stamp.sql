-- syncSpend stamps config->spend_synced_at after every attempt, but the worker role only had SELECT on
-- connections, so both the success and the failure path threw "permission denied" and the connection was
-- retried every minute forever. Column-level grant: the worker may write config, nothing else.
grant update (config) on public.connections to elessons_worker;
