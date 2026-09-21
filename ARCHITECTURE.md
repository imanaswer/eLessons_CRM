# Architecture

## Assessment of the starting point
The repository contained only the PRD. There was no code to preserve and no architectural debt to document. Everything here is new.

## Shape
```
Browser (PWA) ─▶ Next.js App Router (server components + server actions)
                     │  pg pool, login role `elessons_app` (no grants)
                     ▼
               withTenant(): BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims
                     ▼
               PostgreSQL ── RLS policies ── app.can_see(org, district, centre)
                     ▲
        Worker (Phase 1+) as `elessons_worker` (BYPASSRLS) — the only RLS-exempt principal (PRD s13)
```
No microservices, no Redis, no ORM. SQL is the domain language here because the security model lives in SQL.

## Decisions and why
| # | Decision | Reason |
|---|---|---|
| 1 | **RLS keyed on per-request claims**, app connects as a non-owner, non-superuser role | Owners and superusers bypass RLS. If the app were the owner, every policy would be decorative. |
| 2 | **Opaque DB-backed sessions, not JWTs.** Claims are rebuilt from `users`/`centres` on every request by `app.auth_session()` | Disabling a user or centre takes effect on the next request. A JWT would stay valid until expiry. Cost: one indexed lookup per request. |
| 3 | **Own credential layer instead of Supabase Auth** | The PRD identity is `(centre code, username)`, unique per centre, with lockout and forced 2FA for HQ. Supabase Auth identities are email-global. "Supabase Auth where appropriate" — here it is not. Supabase remains the target for Postgres, Storage and Realtime; role names (`anon`, `authenticated`, `service_role`) and the `request.jwt.claims` GUC match Supabase/PostgREST so the migrations run there unchanged. |
| 4 | **Sensitive writes go through `SECURITY DEFINER` functions** (`app.create_user`, `app.deactivate_centre`, …) that re-check scope and permission themselves | `password_hash` is not granted to `authenticated` at all; functions make the audit write atomic with the change. |
| 5 | **Permissions are rows** (`permissions`, `role_permissions`), checked in SQL by `app.has_perm()` | TEN-7. Roles are a fixed enum; what each role may do is data, editable by Superadmin. |
| 6 | **Impersonation is read-only in the database** (`read_only` claim checked by every write policy/function) | A UI-only banner is not a control. |
| 7 | **No DELETE grant on any table** | PRD s17/s39: history is never destroyed. Erasure will be anonymisation (Phase 1). |
| 8 | **Local Postgres instead of the Supabase CLI stack** | This machine has no Docker. Plain SQL migrations keep both paths open. |
| 9 | scrypt via `node:crypto`, `node:test`, no ORM, no UI kit | Fewer dependencies in the security path. Runtime deps: next, react, pg, zod. |

## Lead core (Phase 1)
```
any source ─▶ app.receive_event ─▶ inbound_events (raw, unique idempotency key)
                                        │ manual entry: same transaction      │ everything else: worker
                                        ▼                                     ▼
                     normalize.ts (E.164, country, timezone)  ─▶  app.ingest_lead(event, lead)
   validate → DNC → dedupe in centre → [repeat enquiry / rechurn] | create → owner → consent → activity
            → HQ-only conflict row if the parent exists in another centre → mark event processed
```
| # | Decision | Reason |
|---|---|---|
| 10 | `leads` / `lead_phones` / `parent_identities` have **no privileges** for app roles, not even SELECT | "Nothing writes to leads any other way" is enforced by Postgres, not by convention. Reads go through `lead_list`, which also applies the privacy toggles, so a masked phone cannot be un-masked by querying differently. |
| 11 | `lead_list` is the **single definition** of lead visibility; child tables, write functions and search all ask the view | One rule to audit and to mutation-test. Transfer updates one row and students, tasks and history follow. |
| 12 | Child rows carry org/district/centre as a **stamp of where it happened**; visibility follows the parent lead | Activities are immutable, so they cannot be re-stamped on transfer. The stamp is what lets the new centre be denied the old centre's notes. |
| 13 | Lifecycle is a projection of `lifecycle_change` activities written only by the disposition engine, the gate (rechurn) and erasure | No grant or function lets a user set it. `app.rebuild_projection` regenerates it from the log. |
| 14 | Postgres is the queue: `inbound_events` and `export_jobs` are claimed with `FOR UPDATE SKIP LOCKED`; no generic jobs table | Two claimers don't justify a framework. Add one when a third kind of job appears. |
| 15 | The worker runs exports as the requester (`SET LOCAL ROLE authenticated` + their claims) | An export can never contain a row its requester could not open on screen. |
| 16 | No `security_barrier` on `lead_list` | Measured 1.3 s → 2 ms for HQ page 1. See SECURITY.md "Threat model" for why it protected nothing here. |

**First touch** (brief s9) = the lead with the earliest `created_at` for that parent identity in the org. With `orgs.cross_centre_policy = 'first_touch_wins'` the conflict is recorded as auto-resolved with credit to that centre; with `'hq_decides'` it stays open. Either way both centres keep their own lead and neither learns of the other. Resolving a conflict records credit; it never moves or edits a lead.

## Planned, not built
- **Webhooks** (Phase 3): verify signature → `app.receive_event` → 200. Processing path already exists and is tested.

## Ambiguities resolved (safest option, configurable, not invented business rules)
| PRD open question | Handling |
|---|---|
| Counsellor sees own or all centre leads | `centres.counsellor_lead_visibility`, default `own` |
| Can centres export | permission `leads.export`, default **off** for centre roles |
| How District Managers log in (PRD silent) | district code in the centre-code field |
| Cross-centre policy | `orgs.cross_centre_policy`, default first touch wins |
| "Hide activity before latest assignment" after a transfer (TR-3) | Split into two toggles: `leads.view_prior_activity` (default on for centre roles, so a reassignment inside a centre keeps the history) and `leads.view_other_centre_activity` (default **off** for centre roles, so a transferred lead arrives without the previous centre's notes) |
| HQ Counsellor scope ("org or HQ team") | own leads only until HQ teams exist |
| Does manual re-entry of an existing number count as a repeat enquiry? | No: it opens the existing lead (LT-3). Reopening a closed lead is an explicit "Record repeat enquiry" action. Non-manual sources always count. |
| Commission rates | config table in its phase; nothing hardcoded |
