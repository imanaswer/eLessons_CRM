# Roadmap and P0 traceability

## Current implementation (2026-09-22)
Started from an empty repository on 2026-09-21. All six phases are built and tested locally (89 tests). PHASE-1.md records the lead core in detail; the table below is the per-requirement status for everything.

**Built against mocks, not verified live:** Meta OAuth / Lead Ads / Marketing API / Conversions API, WhatsApp Cloud API, payment gateway adapters, web push. Each needs its credential (NEEDED.md §1-3) and a first live run.
**Not built:** the P2 list in NEEDED.md §7. **Not looked at in a browser:** every screen was verified over HTTP per role; visual layout and 360 px behaviour are unchecked.

## P0 requirements: status
Done = database + backend + authorization + UI + validation + errors + tests + audit, per the brief's s54.

| ID | Requirement | Status |
|---|---|---|
| TEN-1 | Unique district/centre codes; HQ creates and deactivates | **Done** (district deactivate UI not built; centre is) |
| TEN-2 | Login by centre code + username + password; HQ without code | **Done** |
| TEN-3 | org/district/centre on every table + RLS | **Done** for all existing tables; rule in DATABASE.md for new ones |
| TEN-4 | Centre sees leads where `current_centre_id` is its own | **Done** |
| TEN-5 | One Centre Admin + individual counsellor accounts | **Done** (partial unique index) |
| TEN-10 | Audit log | **Done**: logins, exports, transfers, reassignments, erasure, permission changes, impersonation. Merge is P1, not built |
| LT-1…LT-8 | Ingestion gate, E.164, dedupe, conflicts, DNC, bulk upload, consent, rechurn | **Done** |
| AL-1…AL-3 | Append-only activities + projection | **Done** (Phase 1 subset of projection fields; per-channel fields arrive with their channels) |
| TE-1…TE-4, TE-7, TE-8 | Dispositions (with editing screen), cadence, follow-ups, exhaustion, rechurn, worked view | **Done** |
| TE-5, TE-6 | Calling-hours clamp, SLA alerts, HQ pull-back | **Done** |
| WS-1,2,5-10,15 | Lead list, smart views, drawer, actions, typed tasks, bulk actions | **Done** with gaps listed in PHASE-1.md |
| WS-3, WS-4, WS-11, WS-13, WS-14 | Saved views, query builder, to-do board, engagements, PWA + push | **Done** (push needs VAPID keys) |
| AS-1, AS-7 · TR-1,2,3 | Centre-owned routing, quick assign, transfers | **Done** |
| AS-2..6 | HQ distribution rules, coverage, diagnose tool, workload panel | **Done** |
| LS-1..5 | Static, dynamic (query), upload/page/form lists, flags, memberships | **Done** |
| DL-1..4, DL-6..10 | Deals, kanban, catalogue, payment link, payment events, direct purchase | **Done**; DL-5 and DL-11 not built |
| IN-1 | inbound_events, replay | **Done** |
| IN-2, IN-3 · MT-1…MT-5 | Health panels, Meta per centre, forms → lists, token expiry, spend/CPL | **Done against a mocked Graph API**; live run pending approvals |
| RP-9, RP-10 | Async audited exports, masking | **Done** |
| RP-1..7, RP-11 | Funnel with 11 pivots, leaderboard, activity, campaign, work pipeline, drill-down | **Done** (RP-8 custom dashboards not built) |
| EL-1..5, EL-8..10 | Referral + coupon + QR, enrolments, renewals, payouts, demo priority, abandoned checkout | **Done**; EL-6, EL-7 not built |
| MG-1…MG-3 | Salesmax import with reconciliation | **Done** against guessed column names; needs the sample export (NEEDED.md §5) |

Also done: TEN-6 impersonation, TEN-7 permission matrix with editing screen, TEN-9 TOTP 2FA, LT-9 custom properties, LT-10 merge, CV-1..7 conversations/templates/broadcasts, AU-1..4 automation, TR-4 conflict queue.

| P1/P2 not built | |
|---|---|
| CV-8 centre WhatsApp numbers | data model supports it (connection with centre_id); no UI flow yet |
| AI-1..5, DL-5, DL-11, WS-12, TE-9, TE-10, EL-6, EL-7, RP-8, telephony, Android app, Instagram/Messenger, other capture connectors | see NEEDED.md §7 |

## Plan
The build phases are complete. What remains is in this order:
1. Fill NEEDED.md; configure credentials in a staging environment.
2. First live run of Meta OAuth → page → form sync → leadgen webhook with one sandbox page; then WhatsApp with the HQ number; then the payment gateway in test mode. Fix whatever the real APIs do differently from the mock.
3. Visual pass on every screen at desktop and 360 px, then a real Centre Admin and Counsellor walk through the Definition of Done list (brief s58).
4. Salesmax sample export → confirm mapping → dry run with reconciliation → parallel run.
5. Deploy: Postgres with the three roles, web app, worker, backups, monitoring. `pnpm test` in CI.

## Blocked on G-TEC (PRD open questions)
Payment gateway; who controls checkout/LMS; final district/centre list; commission rules; cross-centre policy confirmation; Salesmax export sample; Meta and WhatsApp verification submissions (start now).
