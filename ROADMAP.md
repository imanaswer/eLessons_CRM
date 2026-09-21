# Roadmap and P0 traceability

## Current implementation (2026-09-21)
Started from an empty repository. Phases 0 and 1 are built and tested (54 tests). A centre can enter, work, follow up and close leads; HQ can see, search, reassign, transfer, resolve conflicts, export and audit. Phases 2-6 are not started: no reports or dashboards beyond counts, no Meta or any other connector, no deals or payments, no WhatsApp. See PHASE-1.md for the itemised record.

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
| TE-1…TE-4, TE-7, TE-8 | Dispositions, cadence, follow-ups, exhaustion, rechurn, worked view | **Done**, except a dispositions editing screen |
| TE-5, TE-6 | Calling-hours clamp, SLA alerts | Phase 2 |
| WS-1,2,5-10,15 | Lead list, smart views, drawer, actions, typed tasks, bulk actions | **Done** with gaps listed in PHASE-1.md |
| WS-3, WS-11, WS-14 | Saved views, to-do board, push notifications | Phase 2 |
| AS-1, AS-7 · TR-1,2,3 | Centre-owned routing, quick assign, transfers | **Done** |
| AS-2, AS-3, AS-5 | HQ distribution rules, coverage diagnostics | Phase 3 |
| LS-1, LS-3 | Lists | **Done** for static lists and upload lists; page/form lists with Meta (Phase 3); no list management screen yet |
| DL-1,2,3,4,6,8,9 | Deals, catalogue, payments | Phase 4 |
| IN-1 | inbound_events, replay | **Done** |
| IN-2, IN-3 · MT-1…MT-4 | Health panels, Meta per centre | Phase 3 |
| RP-9, RP-10 | Async audited exports, masking | **Done** |
| RP-1,2,3,6,11 | Funnel, pivots, leaderboard, work pipeline | Phase 2 |
| EL-1,2,4,10 | Referral, enrolment data, abandoned checkout | Phase 3-4 |
| MG-1…MG-4 | Salesmax import | Phase 2 |

P1 built early because it is a security control, not a feature: TEN-6 read-only impersonation, TEN-7 permission matrix (data + enforcement; no editing UI yet).

## Plan
Phases follow the PRD s16 and the brief s53 unchanged. Each phase starts with its checklist and ends with its tables added to the isolation suite.

**Phase 2 build order** (each step shippable): 1) calling-hours clamp + SLA clock (15 working minutes, 24 h) with owner/Centre Admin alerts · 2) to-do board · 3) saved views, configurable columns · 4) lifecycle labels + dispositions + cadence admin screens · 5) funnel report with pivots and drill-down to the lead list · 6) centre leaderboard, work pipeline widget, HQ and centre dashboards · 7) Salesmax import through the gate with reconciliation report (needs the export sample).

## Blocked on G-TEC (PRD open questions)
Payment gateway; who controls checkout/LMS; final district/centre list; commission rules; cross-centre policy confirmation; Salesmax export sample; Meta and WhatsApp verification submissions (start now).
