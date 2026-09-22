# Testing

`pnpm test` resets `elessons_test`, applies all migrations, seeds, and runs `tests/**/*.test.ts` with `node:test`. Run it on every deploy (PRD s14).

The suite connects as `elessons_app`, not the owner, and its first test asserts that. It covers: Centre B vs Centre A (get, search, filter, list, update, delete, insert, user management, privilege escalation, secrets, other centres' audit rows, no-claims), positive access for Centre Admin / District Manager / HQ, centre-code login, lockout, logout, instant revocation on user disable and centre deactivation, read-only impersonation with audited start/end, and audit immutability.

Mutation check performed once by hand: replacing `app.can_see` with `select true` makes 7 tests fail.

`tests/leads.test.ts` (Phase 1, 36 tests): the PRD s50 critical test on real leads (GET, SEARCH, FILTER, UPDATE, DELETE, EXPORT, every write function, forged scope hints; then HQ succeeds), the gate (normalisation, idempotency, 5-way concurrent race, DNC, conflicts under both policies), counsellor own/all, privacy toggles, the disposition engine, projection rebuild, retry → dead-letter → replay with a simulated outage, crashed-worker reclaim, HQ pool, assignment, transfers and custody, bulk import report, erasure, CSV parsing.

Mutation checks performed by hand (repeat after touching a scope rule): `app.can_see` → `select true` fails 7 tests; removing the role predicates from `lead_list` fails 6.

`tests/engine.test.ts` (Phase 2, 10 tests): calling hours and working-minute arithmetic in the lead's timezone, SLA breaches and alerts, pull-back, rechurn restarting the clock, saved views, funnel = drill-down, query builder incl. hostile input, activity scope.

`tests/integrations.test.ts` (Phases 3-6, 25 tests) against a **mocked Graph API**: page connect/token isolation, forms → lists, leadgen end-to-end with 4-level source and Meta ids, expired token → Reconnect, unmapped page → dead-letter, routing rules + preview + coverage + fallback, referral first-wins, site events (abandoned checkout task, demo priority), deals/catalogue/stages/lost reason, gateway payment → won/enrolled/enrolment + duplicate no-op + failed task, direct purchase, CAPI hashed-only payloads, WhatsApp inbound → lead, STOP opt-out, session window, templates, broadcasts with DNC skip, automation (conditions, actions, rate limit, quiet hours, dead-letter webhook), renewals, payouts, merge, custom properties, dynamic lists, 2FA claims.

HTTP smoke (manual, `scratchpad/smoke5.ts`, `smoke6.ts`): 43 routes × 5 roles with no server errors and no other centre's code on a centre page; every webhook endpoint's challenge, signature, key, idempotency and size-limit behaviour.

Not automated: browser/UI tests, 360 px layout, XLSX through the upload action (the reader call was verified once against a hand-built workbook), load tests (one manual run recorded in PHASE-1.md).
