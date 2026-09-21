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

## Rules for every future tenant table
1. `org_id`, `district_id`, `centre_id` `NOT NULL` (leads use `current_centre_id` for visibility + immutable `origin_centre_id`).
2. `ENABLE ROW LEVEL SECURITY`. Tables scoped by their own columns: policy = `app.can_see(org_id, district_id, centre_id)`. Tables that hang off a lead: policy = `app.lead_visible(lead_id)`. Writes: `and not app.read_only()`, or a definer function that calls `app.lead_for_write()` first.
3. Grant only what is needed to `authenticated`. Never `DELETE`.
4. Index `centre_id`, `district_id`, `org_id` and every filter/sort column in PRD s43. Lists use keyset pagination.
5. Add the table to `tests/isolation.test.ts` in the same commit.

## Migration plan
| Phase | Migrations |
|---|---|
| 2 | `cadences` (today: `orgs.cadence_days`), `lifecycle_labels`, `saved_views`, SLA columns/jobs, reporting views, Salesmax staging tables |
| 3 | `sources` (four-level tree; today `leads.source_l1..l4`), `connections` (encrypted token columns), `field_mappings`, `distribution_rules`, `referral_codes` |
| 4 | `catalogue_items`, `prices`, `deals`, `deal_items`, `deal_stages`, `payments`, `enrolments`, `campaign_spend` |
| 5 | `conversations`, `messages`, `templates`, `broadcasts`, `automation_rules`, `automation_runs` |
| 6 | `payout_rules`, custom properties, teams |

## Scale notes (measured, see PHASE-1.md)
- Scope predicates must be plain comparisons against `(select app.x())` InitPlans. A `CASE` or a per-row function call in a scope rule disables every index (this cost 40 s at 1M rows before 0013).
- Lists order by `(created_at desc, id desc)` and page by keyset; the cursor is built in SQL as text so microseconds survive.
- `buildLeadQuery` repeats the caller's own centre/district as a constant. It is a planner hint only; forging it returns nothing (tested).
- Known ceilings, marked `ponytail:` in code: search returns the newest 5,000 matches; `activities` / `tasks` policies do one PK lookup per row, fine for a drawer, to be revisited for the cross-lead Engagements view (P1).
