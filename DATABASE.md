# Database

Migrations: `db/migrations/NNNN_*.sql`, plain SQL, applied in order by `scripts/migrate.ts` (one transaction each, tracked in `schema_migrations`). Never edit an applied migration; add a new one.

## Applied (Phase 0)
| File | Contents |
|---|---|
| 0001 | DB roles, `app` schema, claim helpers, `app.can_see()` |
| 0002 | `orgs`, `districts`, `centres` (+ per-centre config columns) |
| 0003 | `audit_log` (append-only triggers), `app.audit()`, row-change audit trigger |
| 0004 | `users`, `sessions`, `permissions`, `role_permissions`, `app.has_perm()`, user/centre management functions, write policies |
| 0005 | `app.auth_*` functions (executable by `elessons_app` only) |
| 0006 | permission catalogue + default role matrix |

## Rules for every future tenant table
1. `org_id`, `district_id`, `centre_id` `NOT NULL` (leads use `current_centre_id` for visibility + immutable `origin_centre_id`).
2. `ENABLE ROW LEVEL SECURITY`; `SELECT` policy = `app.can_see(org_id, district_id, centre_id)`; write policies add `and not app.read_only()`.
3. Grant only what is needed to `authenticated`. Never `DELETE`.
4. Index `centre_id`, `district_id`, `org_id` and every filter/sort column in PRD s43. Lists use keyset pagination.
5. Add the table to `tests/isolation.test.ts` in the same commit.

## Migration plan
| Phase | Migrations |
|---|---|
| 1 | `parent_identities`, `leads` (+projection columns), `lead_phones`, `students`, `activities` (append-only, same trigger pattern as audit_log), `dispositions`, `tasks`, `sources`, `lists`, `list_members`, `transfers`, `conflicts`, `dnc`, `consents`, `inbound_events`, `jobs`, `import_batches`, `export_jobs`, `app.ingest_lead()`, `app.apply_disposition()`, `app.transfer_leads()` |
| 2 | `cadences`, `lifecycle_labels`, `saved_views`, SLA columns/jobs, reporting views, Salesmax staging tables |
| 3 | `connections` (encrypted token columns), `field_mappings`, `distribution_rules`, `referral_codes` |
| 4 | `catalogue_items`, `prices`, `deals`, `deal_items`, `deal_stages`, `payments`, `enrolments`, `campaign_spend` |
| 5 | `conversations`, `messages`, `templates`, `broadcasts`, `automation_rules`, `automation_runs` |
| 6 | `payout_rules`, custom properties, teams |

## Scale notes (5M leads)
Policies compare columns to claim-derived constants (`STABLE` functions, evaluated once per query), so they use the `centre_id` indexes; no per-row subqueries. `leads` will carry the projection (AL-2) updated in the activity-write transaction.
