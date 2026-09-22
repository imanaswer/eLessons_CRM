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

| 0007 | policy knobs on `orgs`/`centres`, 9 new permissions, `lifecycle` enum, `dispositions` + seeds |
| 0008 | `parent_identities`, `leads` (+projection, 18 indexes), `lead_phones`, `students`, `consents`, `dnc`, `conflicts`, `lists`, `list_members`, read views |
| 0009 | `activities` (append-only), `tasks`, projection, disposition engine, lead write functions |
| 0010 | `import_batches`, `inbound_events`, the ingestion gate, claim / fail / replay, import functions |
| 0011 | `transfers`, assign / transfer / conflict resolution / erasure / DNC, `export_jobs` |
| 0012 | repeat enquiry through the gate |
| 0013 | lead scope rewritten for index use after measuring at 1M rows |
| 0014 | calling hours, SLA clock + `run_sla`, `notifications`, projection v2, `saved_views`, `lifecycle_labels`, pull-back, `activity_scope` |
| 0015 | `permission_defaults`, `connections`, `connection_forms`, `field_mappings`, `receive_external_event`, `sources`, `distribution_rules` + `route_lead`/`coverage`, `referral_codes`/`referral_touches` |
| 0016 | ingestion gate v2 (routing, referral, Meta ids, migration channel), `match_lead`, `record_site_event`, Salesmax import batches |
| 0017 | `catalogue_items`, `prices`, `deal_stages`, `deals`, `deal_items`, `payments`, `enrolments`, `campaign_spend`, `conversion_events`, `webhook_deliveries` |
| 0018 | `conversations`, `messages`, `templates`, `snippets`, `broadcasts`, automation (`rules`, `triggers`, `runs`, `run_automation`), renewals, `payout_rules` + `payout_report`, `property_definitions`, merge, 2FA columns, `push_subscriptions`, dynamic lists |
| 0019 | payment gateway secret lookup for the webhook |

## Rules for every future tenant table
1. `org_id`, `district_id`, `centre_id` `NOT NULL` (leads use `current_centre_id` for visibility + immutable `origin_centre_id`).
2. `ENABLE ROW LEVEL SECURITY`. Tables scoped by their own columns: policy = `app.can_see(org_id, district_id, centre_id)`. Tables that hang off a lead: policy = `app.lead_visible(lead_id)`. Writes: `and not app.read_only()`, or a definer function that calls `app.lead_for_write()` first.
3. Grant only what is needed to `authenticated`. Never `DELETE`.
4. Index `centre_id`, `district_id`, `org_id` and every filter/sort column in PRD s43. Lists use keyset pagination.
5. Add the table to `tests/isolation.test.ts` in the same commit.

## Queues in Postgres (all `FOR UPDATE SKIP LOCKED`)
`inbound_events` (every channel) · `export_jobs` · `messages` (status queued) · `conversion_events` · `webhook_deliveries` · `automation_triggers` · `broadcasts`/`broadcast_recipients` · `notifications` (push). Scheduled: `run_sla` + `enqueue_due_triggers` + dynamic list refresh + spend sync every minute; `run_renewals` daily.

## Scale notes (measured, see PHASE-1.md)
- Scope predicates must be plain comparisons against `(select app.x())` InitPlans. A `CASE` or a per-row function call in a scope rule disables every index (this cost 40 s at 1M rows before 0013).
- Lists order by `(created_at desc, id desc)` and page by keyset; the cursor is built in SQL as text so microseconds survive.
- `buildLeadQuery` repeats the caller's own centre/district as a constant. It is a planner hint only; forging it returns nothing (tested).
- Known ceilings, marked `ponytail:` in code: search returns the newest 5,000 matches; `activities` / `tasks` / `payments` / `enrolments` policies do one PK lookup per row (the Engagements view and reports use `activity_scope` instead); dynamic lists cap at 50,000 members; the automation engine processes 50 triggers per tick.
- Phases 2-6 tables have not been load-tested at scale; only the lead list was measured at 1M rows.
