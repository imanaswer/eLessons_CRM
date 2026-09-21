# Roadmap and P0 traceability

## Current implementation (2026-09-21)
Started from an empty repository. Phase 0 is built and tested. Nothing in Phases 1-6 exists: **there are no leads in this system yet.**

## P0 requirements: status
Done = database + backend + authorization + UI + validation + errors + tests + audit, per the brief's s54.

| ID | Requirement | Status |
|---|---|---|
| TEN-1 | Unique district/centre codes; HQ creates and deactivates | **Done** (district deactivate UI not built; centre is) |
| TEN-2 | Login by centre code + username + password; HQ without code | **Done** |
| TEN-3 | org/district/centre on every table + RLS | **Done** for all existing tables; rule in DATABASE.md for new ones |
| TEN-4 | Centre sees leads where `current_centre_id` is its own | Phase 1 |
| TEN-5 | One Centre Admin + individual counsellor accounts | **Done** (partial unique index) |
| TEN-10 | Audit log | **Done** for Phase 0 actions; export/transfer/merge/deletion entries land with those features |
| LT-1…LT-8 | Ingestion gate, E.164, dedupe, conflicts, DNC, bulk upload, consent, rechurn | Phase 1 |
| AL-1…AL-3 | Append-only activities + projection | Phase 1 |
| TE-1…TE-8 | Dispositions, cadence, follow-ups, SLA, rechurn, worked view | Phase 1 (dispositions) / Phase 2 (engine) |
| WS-1,2,3,5-11,14,15 | Lead list, smart/saved views, drawer, actions, tasks, to-do board, PWA, bulk actions | Phase 1-2 |
| AS-1,2,3,5,7 · TR-1,2,3 | Assignment, routing, diagnostics, transfers | Phase 1 (assign/transfer) / Phase 3 (rules) |
| LS-1, LS-3 | Lists | Phase 1 |
| DL-1,2,3,4,6,8,9 | Deals, catalogue, payments | Phase 4 |
| IN-1,2,3 · MT-1…MT-4 | inbound_events, health, Meta per centre | Phase 1 (inbound_events) / Phase 3 |
| RP-1,2,3,6,9,10,11 | Funnel, pivots, leaderboard, exports | Phase 1 (exports) / Phase 2 |
| EL-1,2,4,10 | Referral, enrolment data, abandoned checkout | Phase 3-4 |
| MG-1…MG-4 | Salesmax import | Phase 2 |

P1 built early because it is a security control, not a feature: TEN-6 read-only impersonation, TEN-7 permission matrix (data + enforcement; no editing UI yet).

## Plan
Phases follow the PRD s16 and the brief s53 unchanged. Each phase starts with its checklist and ends with its tables added to the isolation suite.

**Phase 1 build order** (each step shippable): 1) `jobs` + worker skeleton, `inbound_events` · 2) `parent_identities`/`leads`/`lead_phones`/`students`/`dnc`/`consents`/`conflicts` + `app.ingest_lead()` with INSERT revoked · 3) manual add-lead (phone-first) · 4) `activities` + projection + dispositions + call outcome (≤3 taps) · 5) lead list (keyset) + drawer · 6) tasks · 7) assign / transfer with custody chain · 8) CSV/XLSX import · 9) async export with masking · 10) PRD s50 critical security test against real leads.

## Blocked on G-TEC (PRD open questions)
Payment gateway; who controls checkout/LMS; final district/centre list; commission rules; cross-centre policy confirmation; Salesmax export sample; Meta and WhatsApp verification submissions (start now).
