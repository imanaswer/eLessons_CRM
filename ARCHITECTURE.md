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

## Planned, not built (design fixed now so later phases don't fight it)
- **Ingestion gate**: `REVOKE INSERT, UPDATE ON leads FROM authenticated`; the only writer is `app.ingest_lead(jsonb)`. Phone is normalised to E.164 in TypeScript (libphonenumber-js) and a `CHECK` is the backstop.
- **Webhooks**: verify signature → insert `inbound_events` (unique `idempotency_key`) → 200. Worker processes with `FOR UPDATE SKIP LOCKED`, exponential backoff, dead-letter status, replay.
- **Lifecycle**: written only by `app.apply_disposition()`; no column grant lets a user edit it.
- **Parent identity → centre lead → students** as in the brief (s6), so the same phone can be a separate, mutually invisible lead in two centres with an HQ-only `conflicts` row.

## Ambiguities resolved (safest option, configurable, not invented business rules)
| PRD open question | Handling |
|---|---|
| Counsellor sees own or all centre leads | `centres.counsellor_lead_visibility`, default `own` |
| Can centres export | permission `leads.export`, default **off** for centre roles |
| How District Managers log in (PRD silent) | district code in the centre-code field |
| Cross-centre policy, commission rates | config tables in their phase; nothing hardcoded |
